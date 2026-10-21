// The granular module: sand, gravel, pebbles, soil and flour in piles, castles, trays, funnels, hourglasses and stream tables.
// A port of machines/mod_granular.py, line by line (same names, same order, same numbers); plain ES module, no dependencies beyond web/sim.
// web/sim/modules/index.js registers it (register_all, as a catalog file's) after the catalog files; its `plugin` export is the AI's view of it
// (goal kinds, digest, knobs, prompt lines, placement rules, change words: web/sim/plugins.js).
// Sources: see the Python file's docstring and tooling/src/sim/granular.ts ([WENTWORTH22], [CRC], [FREEZE79], [ETB-REPOSE], [ETB-BULK],
// [BEVERLOO61], [ZURIGUEL05], [UEHARA03], [WP06], [FISCHENICH01], [EMRIVER], [HOURGLASS]).
// (a module file takes everything from the framework object register_all gets: web/sim/items.js FRAMEWORK, its `py` = pymath.js)
let register, ItemType, Prop, Readout, add_look, D2R, register_goal_kind, register_build_hook, CATEGORIES
let pyRound, pymin, pymax, fmtF, truthy, sin, cos
let F = null

export const MODULE = "granular"
const CATEGORY = "Sand & soil"

export function register_all(g) {
	;({ register, ItemType, Prop, Readout, add_look, D2R, register_goal_kind, register_build_hook, CATEGORIES } = g)
	;({ pyRound, pymin, pymax, fmtF, truthy, sin, cos } = g.py)
	F = g
	if (!CATEGORIES.includes(CATEGORY)) CATEGORIES.push(CATEGORY)
	_looks()
	_types()
	_goals()
	register_build_hook(_pours)
	register_build_hook(_holders)
}

// ---------------------------------------------------------------- the grains (tooling/src/sim/granular.ts GRAINS: the same numbers)
// name -> [median grain m, grain density kg/m³, porosity, repose deg dry, its tan, repose deg soaked, its tan, look]
export const GRAINS = {
	sand: [0.0004, 2650.0, 0.4, 34.0, 0.674509, 25.0, 0.466308, "sand"],
	"fine sand": [0.00018, 2650.0, 0.42, 32.0, 0.624869, 22.0, 0.404026, "fine sand"],
	"coarse sand": [0.001, 2650.0, 0.38, 35.0, 0.700208, 28.0, 0.531709, "coarse sand"],
	gravel: [0.006, 2650.0, 0.38, 38.0, 0.781286, 34.0, 0.674509, "gravel"],
	pebbles: [0.02, 2650.0, 0.38, 40.0, 0.8391, 38.0, 0.781286, "pebbles"],
	soil: [0.00005, 2600.0, 0.5, 35.0, 0.700208, 20.0, 0.36397, "soil"],
	flour: [0.00005, 1450.0, 0.59, 45.0, 1.0, 45.0, 1.0, "flour"],
	// the kitchen grains (2026-10-20): granulated sugar, table salt, long-grain rice
	sugar: [0.0005, 1587.0, 0.4959, 35.0, 0.700208, 25.0, 0.466308, "sugar"],
	salt: [0.0004, 2165.0, 0.4457, 32.0, 0.624869, 25.0, 0.466308, "salt"],
	rice: [0.0028, 1450.0, 0.469, 32.0, 0.624869, 28.0, 0.531709, "rice"]
}
export const GRAIN_NAMES = Object.keys(GRAINS)
export const WETNESS = ["dry", "damp", "soaked"]
const RHO_WATER = 998.2
const DAMP_WATER = 0.08
export const TINTS = { natural: null, red: "#c8443a", blue: "#3f7fd0", green: "#4fa35a", yellow: "#e8c13a", purple: "#8a5cc0", white: "#f2f0ea", black: "#2c2a28", pink: "#e889a8", orange: "#e8823a" }
export const TINT_NAMES = Object.keys(TINTS)
export const PLANTS = { none: null, "lower half": [0.5, 1.0], "upper half": [0.0, 0.5], all: [0.0, 1.0] }
const PLANT_TAU = 15.0

/** kg/m³ of a packed bed of these grains (with its water when damp or soaked): tooling/src/sim/granular.ts bulkDensity. */
export function bulk(grain, wet) {
	const [, rho, por] = GRAINS[grain]
	const water = wet === "damp" ? RHO_WATER * pymin(DAMP_WATER, por) : wet === "soaked" ? RHO_WATER * por : 0.0
	return rho * (1 - por) + water
}

/** tan of the lowest slope the grains may end at (soaked if they are, else dry). */
export const tan_low = (grain, wet) => (wet === "soaked" ? GRAINS[grain][6] : GRAINS[grain][4])

/** a^(1/3) by Newton's method from a fixed start, + − × ÷ only (machines/mod_granular.py cbrt, the same bits), for a > 0. */
export function cbrt(a) {
	if (!(a > 0)) return 0.0
	let x = 1.0
	while (x * x * x > a) x = x / 2
	while (x * x * x < a) x = x * 2
	for (let k = 0; k < 60; k++) x = (2 * x + a / (x * x)) / 3
	return x
}

const _r = (v, n = 6) => pyRound(v, n)
const PI = 3.141592653589793

function _upright(c) {
	c.ca = 1.0
	c.sa = 0.0
	c.a = 0.0
}

/** A display-only slab (collides with nothing): what the view draws the item's sand on, and what picks it. */
function _ghost(c, part, w, h, depth, lx = 0.0, ly = 0.0, look = "sand", words = null, extra = {}) {
	return c.slab(part, w, h, depth, lx, ly, { kind: "static", material: c.mat({ base: "hollow plastic", overrides: {} }), look, words, ghost: true, stand: "self", ...extra })
}

/** A bed's column size for a region `reach` wide either side: about 36 columns across, 3 mm to 2 cm. */
const _cell = (reach, lo = 0.003, hi = 0.02) => _r(pymin(hi, pymax(lo, reach / 18)), 4)

function _region(c, part, x0, x1, z0, z1, base, top, cell, grain, wet, role, deposit, walls = null, exclude = null) {
	const fields = { x0: _r(x0), x1: _r(x1), z0: _r(z0), z1: _r(z1), base: _r(base), top: _r(top), cell, grain, wet, role, deposit }
	if (walls && walls.length) fields.walls = walls
	if (exclude && exclude.length) fields.exclude = exclude
	return c.process("sand-region", part, fields)
}

// ---------------------------------------------------------------- looks
function _looks() {
	add_look("sand", { fill: "#d9b97c", shade: "#a88a52", roughness: 0.95, metalness: 0.0, clearcoat: 0.0, grain: true })
	add_look("fine sand", { fill: "#e6d3a3", shade: "#b9a473", roughness: 0.95, metalness: 0.0, clearcoat: 0.0, grain: true })
	add_look("coarse sand", { fill: "#c8a26a", shade: "#97774a", roughness: 0.95, metalness: 0.0, clearcoat: 0.0, grain: true })
	add_look("gravel", { fill: "#9b948a", shade: "#6f6961", roughness: 0.9, metalness: 0.0, clearcoat: 0.0, grain: true })
	add_look("pebbles", { fill: "#8a8178", shade: "#625b53", roughness: 0.85, metalness: 0.0, clearcoat: 0.0, grain: true })
	add_look("soil", { fill: "#6e5136", shade: "#4b3622", roughness: 0.95, metalness: 0.0, clearcoat: 0.0, grain: true })
	add_look("flour", { fill: "#f3eee2", shade: "#cfc8b6", roughness: 0.98, metalness: 0.0, clearcoat: 0.0 })
	add_look("sugar", { fill: "#f7f5ee", shade: "#d6d1c3", roughness: 0.55, metalness: 0.0, clearcoat: 0.3, grain: true })
	add_look("salt", { fill: "#f4f4f2", shade: "#d2d2cf", roughness: 0.6, metalness: 0.0, clearcoat: 0.2, grain: true })
	add_look("rice", { fill: "#f1ebdc", shade: "#cfc6b0", roughness: 0.7, metalness: 0.0, clearcoat: 0.1, grain: true })
	add_look("timer glass", { fill: "#e6f0f4", shade: "#b9c8cf", roughness: 0.05, metalness: 0.0, clearcoat: 1.0, transmission: 0.92, ior: 1.5, thickness: 0.002 })
	add_look("stream tray", { fill: "#4f8fd8", shade: "#2f6bb0", roughness: 0.4, metalness: 0.0, clearcoat: 0.2 })
}

// grains that running water dissolves (2026-10-20): not offered where water runs over the bed (a stream table)
const SOLUBLE = ["sugar", "salt"]

const _grain_props = (def = "sand", wet = "dry", water = false) => [
	new Prop("grain", "Grains", def, {
		kind: "choice", choices: GRAIN_NAMES.filter((g) => !(water && SOLUBLE.includes(g))),
		help: "sand 0.4 mm; fine sand 0.18 mm; coarse sand 1 mm; gravel 6 mm; pebbles 2 cm; soil (silt loam); flour (a powder); " + (water ? "rice (long grains); not sugar or salt: running water dissolves them" : "sugar 0.5 mm; salt 0.4 mm; rice (long grains)")
	}),
	new Prop("wetness", "Wetness", wet, { kind: "choice", choices: WETNESS, help: "dry: flows and heaps at its angle of repose; damp: sticks (a sandcastle stands); soaked: slumps flat (its pores full of water)" })
]
const _tint = () => new Prop("sand_color", "Sand colour", "natural", { kind: "choice", choices: TINT_NAMES, help: "Coloured sand (only how it looks; the catalog-wide colour paints the item)" })

// ---------------------------------------------------------------- sand pile: a heap or a castle
function build_pile(c, P) {
	_upright(c)
	const grain = P.grain
	const wet = P.wetness
	const shape = P.shape
	const x = c.ox
	const y = c.oy
	const rho = bulk(grain, wet)
	const t_dry = GRAINS[grain][4]
	const t_low = tan_low(grain, wet)
	let reach, deposit, top, gw, gh
	if (shape === "castle") {
		const r = P.width / 2
		const H = P.height
		const vol = PI * r * r * H
		const spread = cbrt((3 * vol) / (PI * t_low))
		reach = pymax(r, spread) * 1.4 + 0.03
		deposit = { shape: "castle", x: _r(x), z: 0.0, radius: _r(r), height: _r(H) }
		top = y + H * 1.3 + 0.05
		gw = 2 * r
		gh = H
		P.sand_kg = _r(vol * rho, 4)
	} else {
		const vol = P.sand_kg / rho
		const R = cbrt((3 * vol) / (PI * t_dry))
		const spread = cbrt((3 * vol) / (PI * t_low))
		reach = spread * 1.4 + 0.03
		deposit = { shape: "cone", x: _r(x), z: 0.0, mass: _r(P.sand_kg) }
		top = y + R * t_dry * 1.6 + 0.05
		gw = 2 * R
		gh = pymax(0.002, R * t_dry)
	}
	_ghost(c, "sand", gw, gh, gw, 0.0, gh / 2, GRAINS[grain][7], `a ${shape === "castle" ? "sandcastle" : "heap"} of ${wet} ${grain}`)
	_region(c, "sand", x - reach, x + reach, -reach, reach, y - 0.05, top, _cell(reach), grain, wet, "pile", deposit)
}

// ---------------------------------------------------------------- sand tray: a box of sand or flour
function build_tray(c, P) {
	_upright(c)
	const L = P.length
	const W = P.width
	const wall = P.wall
	const depth = P.sand_depth
	const t = 0.012
	const x = c.ox
	const y = c.oy
	const m = c.mat({ base: "varnished hardwood", overrides: {} })
	const kw = { kind: "static", material: m, look: "wood" }
	c.slab("floor", L + 2 * t, t, W, 0.0, t / 2, { words: "the sand tray's floor", ...kw })
	c.slab("wall-left", t, wall, W, -L / 2 - t / 2, t + wall / 2, { words: "the sand tray's end wall", ...kw })
	c.slab("wall-right", t, wall, W, L / 2 + t / 2, t + wall / 2, { words: "the sand tray's end wall", ...kw })
	const grain = P.grain
	const wet = P.wetness
	const fill = pymin(depth, wall)
	_ghost(c, "sand", L, pymax(0.002, fill), W - 2 * t, 0.0, t + pymax(0.002, fill) / 2, GRAINS[grain][7], `the tray's ${grain}`)
	const z = W / 2 - t
	const walls = [
		{ x0: _r(x - L / 2 - t), x1: _r(x + L / 2 + t), z0: _r(z), z1: _r(W / 2 + 0.02), top: _r(y + t + wall) },
		{ x0: _r(x - L / 2 - t), x1: _r(x + L / 2 + t), z0: _r(-W / 2 - 0.02), z1: _r(-z), top: _r(y + t + wall) }
	]
	_region(c, "sand", x - L / 2, x + L / 2, -z, z, y - 0.02, y + t + wall + 0.02, _r(pymin(0.008, pymax(0.003, pymax(L, W) / 120)), 4), grain, wet, "tray", { shape: "layer", depth: _r(fill) }, walls)
}

// ---------------------------------------------------------------- funnel of sand on a ring stand
function build_funnel(c, P) {
	_upright(c)
	const x = c.ox
	const y = c.oy
	const grain = P.grain
	const wet = P.wetness
	const R = P.funnel_cm / 200
	let r_out = P.outlet_mm / 2000
	if (r_out > R * 0.8) r_out = R * 0.8
	const spout = y + P.height
	const tw = 1.732051 // tan 60°: a kitchen funnel's wall
	const rim = spout + (R - r_out) * tw
	const gid = _ghost(c, "funnel", 2 * R, rim - spout, 2 * R, 0.0, P.height + (rim - spout) / 2, "plastic", "a funnel")
	// (its ring stand's foot, beside the heap: what it stands on, for the editor and the AI's placing; the funnel's model draws the stand)
	const fid = _ghost(c, "foot", 0.14, 0.012, 0.1, -(R + 0.06), 0.006, "steel", "the ring stand's foot")
	const rho = bulk(grain, wet)
	const vol = P.sand_kg / rho
	const spread = cbrt((3 * vol) / (PI * tan_low(grain, wet)))
	const reach = spread * 1.4 + 0.04
	_region(c, "landing", x - reach, x + reach, -reach, reach, y - 0.05, spout - 0.004, _cell(reach), grain, wet, "landing", { shape: "none" }, null, [gid, fid])
	c.process("sand-vessel", "funnel", {
		cx: _r(x), base: _r(spout), shape: "cone", R: _r(R), rOut: _r(r_out), wall: 60.0, top: _r(rim),
		cell: _r(pymax(0.0015, R / 12), 5), grain, wet, mass: _r(P.sand_kg), role: "funnel",
		outlet: { diameter: _r(2 * r_out), delay: _r(P.delay) }
	})
}

// ---------------------------------------------------------------- hourglass (sand timer)
function build_hourglass(c, P) {
	_upright(c)
	const x = c.ox
	const y = c.oy
	const R = P.bulb_cm / 200
	const neck = P.neck_mm / 1000
	const plate = 0.012
	const bulb_h = 2.2 * R
	const y_neck = y + plate + bulb_h
	const top_y = y_neck + bulb_h
	const m = c.mat({ base: "varnished hardwood", overrides: {} })
	const w = 2 * R + 0.03
	c.slab("base", w, plate, w, 0.0, plate / 2, { kind: "static", material: m, look: "wood", words: "the timer's wooden base" })
	c.slab("cap", w, plate, w, 0.0, top_y - y + plate / 2, { kind: "static", material: m, look: "wood", words: "the timer's wooden top" })
	_ghost(c, "glass", 2 * R, top_y - y - plate, 2 * R, 0.0, plate + (top_y - y - plate) / 2, "timer glass", "the timer's glass bulbs")
	const grain = P.grain
	const cell = _r(pymax(0.0012, R / 10), 5)
	c.process("sand-vessel", "top", {
		cx: _r(x), base: _r(y_neck), shape: "cone", R: _r(R), rOut: _r(neck / 2), wall: 55.0, top: _r(top_y - 0.002),
		cell, grain, wet: "dry", mass: _r(P.sand_kg), role: "hourglass-top", outlet: { diameter: _r(neck), delay: _r(P.delay) }
	})
	c.process("sand-vessel", "bottom", {
		cx: _r(x), base: _r(y + plate), shape: "bowl", R: _r(R), rOut: 0.0, wall: 0.0, top: _r(y_neck - 0.002),
		cell, grain, wet: "dry", mass: 0.0, role: "hourglass-bottom", outlet: null
	})
}

// ---------------------------------------------------------------- stream table
function build_stream(c, P) {
	_upright(c)
	const x = c.ox
	const y = c.oy
	const L = P.length
	const W = P.width
	const tilt = P.tilt_deg
	const t = 0.006
	const wall = 0.1
	const a = tilt * D2R
	const ca = cos(a)
	const sa = sin(a)
	const tn = sa / ca
	// the floor: its top's middle at the anchor, falling to the right at `tilt`; the end walls stand upright on it
	const m = c.mat({ base: "polypropylene", overrides: {} })
	const kw = { kind: "static", material: m, look: "stream tray" }
	c.slab("floor", L + 2 * t, t, W, (-sa * t) / 2, (-ca * t) / 2, { langle: -tilt, words: "the stream table's tray", stand: "self", ...kw })
	const xl = x - (L / 2) * ca
	const xr = x + (L / 2) * ca
	const yl = y + (L / 2) * sa
	const yr = y - (L / 2) * sa
	c.slab("wall-high", t, wall + 0.02, W, (-L / 2) * ca - t / 2, (L / 2) * sa + wall / 2, { words: "the stream table's high end", stand: "self", ...kw })
	c.slab("wall-low", t, wall + 0.02, W, (L / 2) * ca + t / 2, (-L / 2) * sa + wall / 2, { words: "the stream table's low end", stand: "self", ...kw })
	const grain = P.grain
	const wet = P.wetness
	const share = P.sand_share
	const toe = xl + share * (xr - xl)
	const depth = P.sand_depth
	_ghost(c, "sand", share * (xr - xl), depth, W - 2 * t, (-L / 2) * ca + (share * (xr - xl)) / 2, (L / 2) * sa - (share * (xr - xl) * tn) / 2 + depth / 2,
		GRAINS[grain][7], `the stream table's ${grain}`)
	const z = W / 2 - t
	const top = yl + wall + 0.02
	const walls = [
		{ x0: _r(xl - t), x1: _r(xr + t), z0: _r(z), z1: _r(W / 2 + 0.02), top: _r(top) },
		{ x0: _r(xl - t), x1: _r(xr + t), z0: _r(-W / 2 - 0.02), z1: _r(-z), top: _r(top) }
	]
	const rid = _region(c, "sand", xl, xr, -z, z, yr - 0.02, top, 0.012, grain, wet, "stream", { shape: "slope", from: _r(xl), toe: _r(toe), depth: _r(depth) }, walls)
	const span = PLANTS[P.plants]
	let plants = null
	if (span !== null && span !== undefined) {
		// (the slope's foot too, where the lower part runs: the sand's toe falls at its angle of repose, about 1.5 sand depths long)
		const end = toe + 1.5 * depth
		plants = [{ x0: _r(xl + span[0] * (end - xl)), x1: _r(xl + span[1] * (end - xl)), tau: PLANT_TAU }]
	}
	c.process("sand-water", "water", { region: rid, sources: [{ x: _r(xl + 0.04), z: 0.0, rate: _r(P.flow_lpm / 60000, 9) }], drainX: _r(xr - 0.03), lake: _r(yr + P.lake_cm / 100), plants })
}

// ---------------------------------------------------------------- the catalog
function _types() {
	register(new ItemType("sand-pile", "Sand pile", CATEGORY, build_pile, {
		dynamic: false, module: MODULE,
		props: [
			new Prop("shape", "Shape", "heap", { kind: "choice", choices: ["heap", "castle"], help: "heap: a cone at the angle of repose; castle: a packed round tower (damp sand stands, dry sand slumps)" }),
			new Prop("sand_kg", "Amount", 1.0, 0.01, 20.0, 0.01, "kg", "A heap's weight of grains (a castle's follows its size)"),
			new Prop("width", "Castle width", 0.08, 0.02, 0.5, 0.005, "m", "A castle's diameter"),
			new Prop("height", "Castle height", 0.12, 0.01, 0.6, 0.005, "m", "A castle's height"),
			..._grain_props(), _tint()
		],
		tags: ["sand", "pile", "heap", "mound", "sandcastle", "castle", "gravel", "soil", "dirt", "flour", "angle of repose", "landslide", "dune", "beach", "pile of sugar", "heap of sugar", "pile of rice", "heap of rice", "pile of salt", "heap of salt"],
		description: "A heap of sand, gravel, soil, flour, sugar, salt or rice on whatever it rests on, or a packed sandcastle. Dry grains stand at their " +
			"angle of repose (sand 34°, gravel 38°, flour 45°, sugar 35°, salt and rice 32°) and slide down when piled steeper; damp sand sticks and stands in " +
			"walls; soaked sand slumps. Balls and blocks sink into it and are slowed by it. A heap wider than the shelf or plank it is on spills off its edge.",
		source: "Grains [WENTWORTH22] [CRC] [FREEZE79]; angles of repose [ETB-REPOSE]; bulk densities [ETB-BULK]; damp cohesion about " +
			"1 kPa (capillary bridges: a free damp tower stands to about 23 cm, provisional).",
		anchor: "the middle of its base, on what it rests on", facts: "1 kg of dry sand: a cone about 13 cm wide, 4.5 cm tall at 34°",
		readouts: [
			new Readout("height_mm", "Height", { unit: "mm", digits: 0, help: "Its top over where it lies" }),
			new Readout("width_mm", "Width", { unit: "mm", digits: 0, help: "Its footprint, as a disc" }),
			new Readout("angle_deg", "Slope", { unit: "°", digits: 1, help: "Its sides' slope: atan(height ÷ footprint radius)" }),
			new Readout("mass_g", "Mass", { unit: "g", digits: 0, help: "The grains in its place (on what it stands on)" }),
			new Readout("spilled_g", "Spilled", { unit: "g", digits: 0, help: "Grains that ran off the edge of what it stands on (a heap wider than its shelf or plank)" })
		]
	}))
	register(new ItemType("sand-tray", "Sand tray", CATEGORY, build_tray, {
		dynamic: false, module: MODULE,
		props: [
			new Prop("length", "Length", 0.5, 0.15, 3.0, 0.01, "m"), new Prop("width", "Front to back", 0.35, 0.1, 1.0, 0.01, "m"),
			new Prop("wall", "Wall height", 0.08, 0.02, 0.3, 0.005, "m"),
			new Prop("sand_depth", "Sand depth", 0.05, 0.005, 0.3, 0.005, "m", "How deep it is filled (up to its walls)"),
			..._grain_props("sand"), _tint()
		],
		tags: ["sandbox", "sand pit", "crater", "impact", "meteor", "flour", "long jump", "tray", "box of sand", "moon craters"],
		description: "A wooden tray filled level with sand, flour or soil. Drop a ball into it: it makes a crater (bigger from higher, " +
			"and for heavier balls) and is buried; roll something into it: it ploughs in and stops.",
		source: "Craters: Uehara et al. 2003 [UEHARA03] (checked in research/rw-validate-granular.ts); grains as the sand pile.",
		anchor: "the middle of its floor's underside, where it stands", facts: "50 × 35 cm, 5 cm of sand: about 14 kg",
		readouts: [
			new Readout("crater_mm", "Crater", { unit: "mm", digits: 0, help: "Rim to rim across the deepest crater" }),
			new Readout("crater_depth_mm", "Crater depth", { unit: "mm", digits: 0, help: "Below where the sand stood" }),
			new Readout("sand_mm", "Sand depth", { unit: "mm", digits: 0, help: "Its mean depth" })
		]
	}))
	register(new ItemType("sand-funnel", "Funnel of sand", CATEGORY, build_funnel, {
		dynamic: false, module: MODULE,
		props: [
			new Prop("sand_kg", "Grains in it", 0.3, 0.0, 5.0, 0.01, "kg"),
			new Prop("outlet_mm", "Spout", 10.0, 2.0, 60.0, 0.5, "mm", "The hole's width: grains jam in a hole under about 5 grains wide"),
			new Prop("funnel_cm", "Funnel width", 12.0, 5.0, 40.0, 0.5, "cm", "Across its top"),
			new Prop("height", "Spout height", 0.2, 0.03, 1.5, 0.01, "m", "Its spout over its base"),
			new Prop("delay", "Opens after", 0.0, 0.0, 20.0, 0.1, "s", "Seconds after the release that its spout opens"),
			..._grain_props("sand"), _tint()
		],
		tags: ["funnel", "pour", "pouring", "sand", "pile", "heap", "angle of repose", "clog", "jam", "flow rate", "gravel", "flour", "pour sugar", "pour salt", "pour rice", "sugar pile", "rice pile", "salt pile"],
		description: "A funnel of grains on a ring stand. At the release its spout opens and the grains pour out at a steady rate " +
			"(Beverloo: it does not slow as the funnel empties) and heap up below at their angle of repose. Too narrow a spout " +
			"for the grains (gravel, or sticky flour or damp sand) and it clogs. Over a jar, glass, cup, bowl or box the grains stay inside it and heap up within its walls.",
		source: "Discharge [BEVERLOO61] (25 g/s of sand through 1 cm); jamming [ZURIGUEL05]; cohesive arching (Jenike 1964).",
		anchor: "under its spout, on what its stand's foot stands on (the foot is beside the heap)",
		facts: "1 cm spout: about 25 g of sand a second",
		readouts: [
			new Readout("left_g", "Left", { unit: "g", digits: 0 }), new Readout("poured_g", "Poured", { unit: "g", digits: 0 }),
			new Readout("flow_gs", "Flow", { unit: "g/s", digits: 1 }), new Readout("clogged", "Clogged", { unit: "", digits: 0, help: "1 while its grains jam", words: { 0: "no", 1: "yes" } }),
			new Readout("heap_mm", "Heap height", { unit: "mm", digits: 0, help: "The heap it has poured: its top over where it lies" }),
			new Readout("heap_deg", "Heap slope", { unit: "°", digits: 1, help: "The poured heap's sides: atan(height ÷ footprint radius); in a jar or glass it fills, " + "the cone's slope from its top down to the wall" }),
			new Readout("heap_g", "Heap", { unit: "g", digits: 0, help: "The grains in the heap under it" }),
			new Readout("outside_g", "Outside", { unit: "g", digits: 0, help: "Grains that landed outside the jar, glass, cup or box it pours into" })
		]
	}))
	register(new ItemType("hourglass", "Hourglass (sand timer)", CATEGORY, build_hourglass, {
		dynamic: false, module: MODULE,
		props: [
			new Prop("sand_kg", "Sand", 0.066, 0.001, 2.0, 0.001, "kg", "66 g of fine sand through a 3 mm neck: one minute"),
			new Prop("neck_mm", "Neck", 3.0, 0.8, 12.0, 0.1, "mm", "Wider: it runs out sooner"),
			new Prop("bulb_cm", "Bulb width", 5.0, 2.0, 15.0, 0.5, "cm"),
			new Prop("grain", "Grains", "fine sand", { kind: "choice", choices: GRAIN_NAMES, help: "Finer grains run a little faster through the same neck" }),
			new Prop("delay", "Starts after", 0.0, 0.0, 20.0, 0.1, "s", "Seconds after the release that it starts running"), _tint()
		],
		tags: ["hourglass", "sand timer", "egg timer", "timer", "clock", "time", "minute", "measure time"],
		description: "A sand timer: grains run from the top bulb through the neck at a steady rate (whatever the height of sand above) " +
			"and heap up in the bottom bulb. It reads how long it has run (lesson seconds, with the scene's time-lapse). A neck narrower than about 5 grains jams: nothing runs and its clock stops.",
		source: "Beverloo's discharge through the neck [BEVERLOO61]: 1.1 g/s of fine sand through 3 mm [HOURGLASS].",
		anchor: "the middle of its base", facts: "66 g, 3 mm neck: 60 s",
		readouts: [
			new Readout("top_g", "Top", { unit: "g", digits: 1 }), new Readout("bottom_g", "Bottom", { unit: "g", digits: 1 }), new Readout("flow_gs", "Flow", { unit: "g/s", digits: 2 }),
			new Readout("run_s", "Ran", { unit: "s", digits: 1, help: "Lesson seconds since it started (frozen when it runs out)" }),
			new Readout("empty", "Empty", { unit: "", digits: 0, help: "1 once the top bulb has run out", words: { 0: "no", 1: "yes" } }),
			new Readout("clogged", "Jammed", { unit: "", digits: 0, help: "1 while its grains block the neck (too narrow for them: its clock stops)", words: { 0: "no", 1: "yes" } })
		]
	}))
	register(new ItemType("stream-table", "Stream table", CATEGORY, build_stream, {
		dynamic: false, module: MODULE,
		props: [
			new Prop("tilt_deg", "Slope", 6.0, 0.0, 25.0, 0.5, "°", "How much the tray is tipped (books under its high end)"),
			new Prop("flow_lpm", "Water flow", 1.0, 0.0, 6.0, 0.1, "L/min", "The hose's flow, from the release"),
			new Prop("sand_depth", "Sand depth", 0.05, 0.01, 0.12, 0.005, "m"),
			new Prop("sand_share", "Sand covers", 0.6, 0.2, 0.9, 0.05, "", "The share of the tray's length the sand fills, from the high end"),
			new Prop("lake_cm", "Pool depth", 2.0, 0.0, 6.0, 0.5, "cm", "Standing water at the low end (the outlet's lip)"),
			new Prop("plants", "Plants", "none", { kind: "choice", choices: Object.keys(PLANTS), help: "Grass on part of the sand slope: its roots hold the sand" }),
			new Prop("length", "Length", 0.9, 0.4, 2.5, 0.05, "m"), new Prop("width", "Front to back", 0.4, 0.15, 1.0, 0.01, "m"),
			..._grain_props("sand", "damp", true)
		],
		tags: ["stream table", "erosion", "deposition", "river", "delta", "weathering", "landform", "water", "sand", "canyon", "flood", "runoff", "plants hold soil"],
		description: "A tipped tray of damp sand with a hose at its high end and a pool at its low end. The water carves a channel down " +
			"the slope, carries the sand and drops it where it slows in the pool: a delta. Steeper, more water or finer grains: " +
			"more erosion; gravel and plant roots resist it. Set the scene's time-lapse (e.g. 15) to see minutes in seconds.",
		source: "Running water [CHOW59] moving grains by Wong & Parker's bed load [WP06], Shields' threshold (Soulsby & Whitehouse " +
			"1997); classroom stream tables [EMRIVER]; grass [FISCHENICH01].",
		anchor: "the middle of its tray's floor", facts: "1 L/min on 6°: a channel and a delta in about 5 minutes",
		readouts: [
			new Readout("eroded_g", "Eroded", { unit: "g", digits: 0, help: "Sand the water has carried away from where it lay" }),
			new Readout("delta_cm", "Delta", { unit: "cm", digits: 1, help: "How far the dropped sand reaches past the sand's toe" }),
			new Readout("channel_mm", "Channel", { unit: "mm", digits: 0, help: "The deepest cut" }), new Readout("water_lpm", "Water", { unit: "L/min", digits: 1 })
		]
	}))
}

// ---------------------------------------------------------------- containers hold grains; a pitcher of grains pours them (2026-10-20)
// type -> [its floor's part, its left walls' parts, its right walls' parts, round] (machines/mod_granular.py HOLDERS: the same)
export const HOLDERS = {
	"glass-jar": ["floor", ["left"], ["right"], true],
	cup: ["floor", ["left"], ["right"], true],
	"plastic-cup": ["floor", ["left"], ["right"], true],
	bucket: ["floor", ["left"], ["right"], true],
	basket: ["floor", ["left"], ["right"], false],
	box: ["floor", ["left"], ["right"], false],
	beaker: ["floor", ["wall-left"], ["wall-right"], true],
	"graduated-cylinder": ["floor", ["wall-left"], ["wall-right"], true],
	"measuring-jug": ["floor", ["wall-left"], ["wall-right"], true],
	"coffee-mug": ["body", ["wall-left"], ["wall-right"], true],
	bowl: ["base", ["wall-left"], ["wall-right"], true]
}
const HOLDER_NEAR = 0.6 // m: a container whose floor's middle is this near a region (in x) is named for it (the engine checks exactly)

/** A pitcher, jug or cup of the flow module that holds grains: the engine's record of its grains and the landing region under its lip
 *  (machines/mod_granular.py _pours, line by line). */
function _pours(sb, scene) {
	void scene
	for (const rec of [...sb.processes]) {
		if (rec.kind !== "flow-pour" || rec.contents !== "grains" || !(typeof rec.grain === "string" && Object.prototype.hasOwnProperty.call(GRAINS, rec.grain))) continue
		const root = sb.solids.find((s) => s.id === rec.solid)
		if (root === undefined) continue
		const iid = rec.item
		const grain = rec.grain
		const lx = root.at.x
		const ly = root.at.y
		const side = rec.tilt > 0 ? -1.0 : 1.0 // (pouring to the right tips it clockwise: a negative tilt)
		const ins = rec.inside
		const h = ins[3].y - ins[0].y
		const vol = rec.grains ?? 0.0
		const spread = cbrt((3 * vol) / (PI * tan_low(grain, "dry")))
		const reach = pymax(0.12, spread * 1.4 + 0.04)
		const x = lx + side * 0.03
		const top = ly - h - rec.wall - 0.004
		const own = sb.solids.filter((s) => s.item === iid).map((s) => s.id)
		sb.processes.push({
			kind: "sand-region", id: `${iid}/landing`, item: iid, x0: _r(x - reach), x1: _r(x + reach), z0: _r(-reach), z1: _r(reach), base: _r(top - 1.0), top: _r(top),
			cell: _cell(reach), grain, wet: "dry", role: "landing", deposit: { shape: "none" }, exclude: own
		})
		const pour = { kind: "sand-pour", id: `${iid}/grains`, item: iid, solid: rec.solid, inside: rec.inside, depth: rec.depth, wall: rec.wall, grain, wet: "dry", volume: vol }
		if (Object.prototype.hasOwnProperty.call(rec, "grains_asked")) pour.asked = rec.grains_asked
		sb.processes.push(pour)
	}
}

/** Every container of the scene that grains could be poured or heaped into, named in each heap's and each pour's landing region near it
 *  (machines/mod_granular.py _holders, line by line). */
function _holders(sb, scene) {
	const regions = sb.processes.filter((p) => p.kind === "sand-region" && (p.role === "pile" || p.role === "landing"))
	if (!regions.length) return
	const have = new Map(sb.solids.map((s) => [s.id, s]))
	const found = []
	for (const it of scene.items ?? []) {
		if (it === null || typeof it !== "object" || Array.isArray(it) || truthy(it.held) || !Object.prototype.hasOwnProperty.call(HOLDERS, it.type)) continue
		const iid = it.id
		const [fl, left, right, rnd] = HOLDERS[it.type]
		const fid = `${iid}/${fl}`
		const ls = left.map((p) => `${iid}/${p}`).filter((id) => have.has(id))
		const rs = right.map((p) => `${iid}/${p}`).filter((id) => have.has(id))
		if (!have.has(fid) || !ls.length || !rs.length) continue
		const depth = have.get(ls[0]).body.depth
		if (typeof depth !== "number" || !(depth > 0)) continue
		found.push([have.get(fid).at.x, { item: iid, floor: fid, left: ls, right: rs, round: rnd, depth }])
	}
	for (const r of regions) {
		const near = found.filter(([x]) => r.x0 - HOLDER_NEAR <= x && x <= r.x1 + HOLDER_NEAR).map(([, h]) => h)
		if (near.length) r.holders = near
	}
}

// ---------------------------------------------------------------- goal kinds (machines/mod_granular.py: the same, number for number)
const _last = (ctx, iid, key) => {
	const v = ctx.state(iid, key)
	return v && v.length ? v[v.length - 1] : null
}
const _first = (ctx, iid, key) => {
	const v = ctx.state(iid, key)
	return v && v.length ? v[0] : null
}
function _fmt(v, n = 1) {
	const t = fmtF(v, n)
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t
}
const lab = (g, fallback) => (truthy(g.label) ? g.label : fallback)
/** A heap's height and slope readings: a sand pile's, or the heap a funnel poured (heap_mm, heap_deg). */
const _heap_keys = (ctx, iid) => {
	const h = ctx.state(iid, "height_mm")
	const f = ctx.state(iid, "heap_mm")
	return !(h && h.length) && f && f.length ? ["heap_mm", "heap_deg"] : ["height_mm", "angle_deg"]
}
const r1 = (v, n) => (v === null ? null : pyRound(v, n))

function piles(ctx, g) {
	if (!ctx.known(g.item)) return null
	const lo = ctx.num(g.min_deg)
	const hi = ctx.num(g.max_deg)
	const [kh, ka] = _heap_keys(ctx, g.item)
	const h = _last(ctx, g.item, kh)
	const a = _last(ctx, g.item, ka)
	const ok = h !== null && h >= 5 && a !== null && (lo === null || a >= lo) && (hi === null || a <= hi)
	const span = (lo !== null && hi === null ? ` at ${_fmt(lo, 0)}°` : "") + (lo !== null && hi !== null ? ` between ${_fmt(lo, 0)}° and ${_fmt(hi, 0)}°` : "") +
		(hi !== null && lo === null ? ` no steeper than ${_fmt(hi, 0)}°` : "")
	return { label: lab(g, `${ctx.name(g.item)} stands as a heap${span}`), ok, kind: "piles", item: g.item, deg: r1(a, 1), mm: r1(h, 1) }
}
function stands(ctx, g) {
	if (!ctx.known(g.item)) return null
	const kh = _heap_keys(ctx, g.item)[0]
	const h0 = _first(ctx, g.item, kh)
	const h1 = _last(ctx, g.item, kh)
	const ok = h0 !== null && h1 !== null && h0 > 0 && h1 >= 0.9 * h0
	return { label: lab(g, `${ctx.name(g.item)} stays standing`), ok, kind: "stands", item: g.item, share: !truthy(h0) || h1 === null ? null : pyRound(h1 / h0, 3) }
}
function collapses(ctx, g) {
	if (!ctx.known(g.item)) return null
	const kh = _heap_keys(ctx, g.item)[0]
	const h0 = _first(ctx, g.item, kh)
	const h1 = _last(ctx, g.item, kh)
	const ok = h0 !== null && h1 !== null && h0 > 0 && h1 < 0.7 * h0
	return { label: lab(g, `${ctx.name(g.item)} collapses`), ok, kind: "collapses", item: g.item, share: !truthy(h0) || h1 === null ? null : pyRound(h1 / h0, 3) }
}
function steeper(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const a = _last(ctx, g.a, _heap_keys(ctx, g.a)[1])
	const b = _last(ctx, g.b, _heap_keys(ctx, g.b)[1])
	const ok = a !== null && b !== null && a >= b + 1
	return { label: lab(g, `${ctx.name(g.a)} stands steeper than ${ctx.name(g.b)}`), ok, kind: "steeper", a: g.a, b: g.b, deg: [r1(a, 1), r1(b, 1)] }
}
function crater(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.min_mm)
	least = least === null ? 10.0 : least
	const d = _last(ctx, g.item, "crater_mm")
	return { label: lab(g, `a crater at least ${_fmt(least, 0)} mm wide forms in ${ctx.name(g.item)}`), ok: d !== null && d >= least, kind: "crater", item: g.item, mm: r1(d, 1) }
}
function crater_bigger(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const a = _last(ctx, g.a, "crater_mm")
	const b = _last(ctx, g.b, "crater_mm")
	// (clearly wider, as a ruler would tell: by 2 mm and 5 %; two equal drops never pass on a grid cell's difference)
	const ok = a !== null && b !== null && a >= b + pymax(2.0, 0.05 * b)
	return { label: lab(g, `the crater in ${ctx.name(g.a)} is wider than in ${ctx.name(g.b)}`), ok, kind: "crater_bigger", a: g.a, b: g.b, mm: [r1(a, 1), r1(b, 1)] }
}
/** When a funnel or an hourglass runs empty (s of the run), or null. */
function _empty_at(ctx, iid) {
	const t = ctx.first_time(iid, "empty", (v) => v >= 1)
	if (t !== null) return t
	const left = ctx.state(iid, "left_g")
	if (left && left.length && left[0] > 0) return ctx.first_time(iid, "left_g", (v) => v <= 0.005 * left[0])
	return null
}
function empties(ctx, g) {
	if (!ctx.known(g.item)) return null
	const by = ctx.num(g.before_s)
	const after = ctx.num(g.after_s)
	const t = _empty_at(ctx, g.item)
	const ok = t !== null && (by === null || t <= by) && (after === null || t >= after)
	const when = (by !== null ? ` by ${_fmt(by, 2)} s` : "") + (after !== null ? ` after ${_fmt(after, 2)} s` : "")
	return { label: lab(g, `${ctx.name(g.item)} runs out of sand${when}`), ok, kind: "sand_runs_out", item: g.item, t: r1(t, 3) }
}
function empties_first(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const ta = _empty_at(ctx, g.a)
	const tb = _empty_at(ctx, g.b)
	// (clearly first: by 2 % of the other's time and at least 0.05 s of the run)
	const ok = ta !== null && (tb === null || ta <= tb - pymax(0.05, 0.02 * tb))
	return { label: lab(g, `${ctx.name(g.a)} runs out of sand before ${ctx.name(g.b)}`), ok, kind: "runs_out_first", a: g.a, b: g.b, t: [r1(ta, 3), r1(tb, 3)] }
}
function timer(ctx, g) {
	if (!ctx.known(g.item)) return null
	const want = ctx.num(g.seconds)
	if (want === null) return null
	// (tol_s: seconds; tol: seconds too, but under 1 it is a share of `seconds` (0.1 = 10 %), as a person says "within 10 %"; default 5 %)
	let tol = ctx.num(g.tol_s)
	if (tol === null) {
		tol = ctx.num(g.tol)
		if (tol !== null && tol > 0 && tol < 1) tol = tol * want
	}
	tol = tol === null ? 0.05 * want : Math.abs(tol)
	const e = _last(ctx, g.item, "empty")
	const s = _last(ctx, g.item, "run_s")
	const j = _last(ctx, g.item, "clogged")
	const ok = e === 1 && s !== null && Math.abs(s - want) <= tol + 1e-9
	return { label: lab(g, `${ctx.name(g.item)} runs out at ${_fmt(want, 1)} s (± ${_fmt(tol, 1)} s)`), ok, kind: "timer", item: g.item, s: r1(s, 2), want: pyRound(want, 3), tol: pyRound(tol, 3), empty: e === 1, jammed: j === 1 }
}
function clogs(ctx, g) {
	if (!ctx.known(g.item)) return null
	// (a funnel's spout or an hourglass's neck: both read `clogged` while their grains jam)
	const t = ctx.first_time(g.item, "clogged", (v) => v >= 1)
	return { label: lab(g, `${ctx.name(g.item)} clogs`), ok: t !== null, kind: "clogs", item: g.item, t: r1(t, 3) }
}
function erodes(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.min_g)
	least = least === null ? 20.0 : least
	const v = _last(ctx, g.item, "eroded_g")
	return { label: lab(g, `the water erodes at least ${_fmt(least, 0)} g of sand in ${ctx.name(g.item)}`), ok: v !== null && v >= least, kind: "erodes", item: g.item, g: r1(v, 1) }
}
function erodes_more(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const a = _last(ctx, g.a, "eroded_g")
	const b = _last(ctx, g.b, "eroded_g")
	// (clearly more, as weighing the washed-off sand would tell: by 10 g and 5 %; two equal tables never pass on noise)
	const ok = a !== null && b !== null && a >= b + pymax(10.0, 0.05 * b)
	return { label: lab(g, `the water erodes more sand in ${ctx.name(g.a)} than in ${ctx.name(g.b)}`), ok, kind: "erodes_more", a: g.a, b: g.b, g: [r1(a, 1), r1(b, 1)] }
}
function delta(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.min_cm)
	least = least === null ? 1.0 : least
	const v = _last(ctx, g.item, "delta_cm")
	return { label: lab(g, `a delta reaches at least ${_fmt(least, 1)} cm into ${ctx.name(g.item)}'s pool`), ok: v !== null && v >= least, kind: "delta", item: g.item, cm: r1(v, 1) }
}

const GOAL_FNS = { piles, stands, collapses, steeper, crater, crater_bigger, sand_runs_out: empties, runs_out_first: empties_first, timer, clogs, erodes, erodes_more, delta }

function _goals() {
	for (const [kind, fn] of Object.entries(GOAL_FNS)) register_goal_kind(kind, fn)
}

// ---------------------------------------------------------------- the AI's view of the module (web/sim/plugins.js)
const PILES = ["sand-pile"]
const HEAPS = ["sand-pile", "sand-funnel"] // (what piles/steeper read: a pile's heap, or the heap a funnel pours)
const TRAYS = ["sand-tray"]
const POURERS = ["sand-funnel", "hourglass"]
const STREAMS = ["stream-table"]
const ofType = (scene, types) => (scene?.items ?? []).filter((i) => types.includes(i.type))
const endOf = (run, iid, key) => {
	const v = run?.track?.state?.[iid]?.[key]
	return Array.isArray(v) && v.length ? v[v.length - 1] : null
}
const startOf = (run, iid, key) => {
	const v = run?.track?.state?.[iid]?.[key]
	return Array.isArray(v) && v.length ? v[0] : null
}
const n0 = (v, d = 0) => (v === null || v === undefined ? "?" : _fmt(v, d))
const cmOf = (m) => `${_fmt(m * 100, 1)} cm`
/** The narrowest spout or neck a dry grain runs through (mm; tooling/src/sim/granular.ts jamDiameter: 5 grains [ZURIGUEL05], flour and soil arch). */
const JAM_MM = { "fine sand": 0.9, sand: 2, "coarse sand": 5, gravel: 30, pebbles: 100, soil: 15, flour: 20, sugar: 2.5, salt: 2, rice: 14 }
const yes = (e) => (e.ok ? "yes" : "no")
const TIMER_KINDS = ["timer", "times", "sand_timer", "runs_for", "hourglass_time"]
/**
 * A wider neck with the sand that keeps a timer goal's time (the make-it-work search's coupled knob, web/ai/fixer.js `also`): the time is the
 * sand's mass over Beverloo's rate W = 0.58·ρ_b·√g·(D − 1.4d)^2.5 [BEVERLOO61], so sand = seconds × W; a top bulb holds about 0.75·bulb_cm³ g
 * (a bigger bulb when it must). Null: no timer goal for it, or the neck still under 5 grains (it would still jam).
 */
function keepTime(P, neckMm, { goals, item }) {
	const g = (goals ?? []).find((x) => x && TIMER_KINDS.includes(x.kind) && x.item === item?.id && typeof x.seconds === "number" && x.seconds > 0)
	const grain = GRAINS[P.grain] ? P.grain : "fine sand"
	if (!g || !(neckMm > (JAM_MM[grain] ?? 1))) return null
	const D = neckMm / 1000
	const d = GRAINS[grain][0]
	const W = 0.58 * bulk(grain, "dry") * Math.sqrt(9.81) * Math.pow(Math.max(0, D - 1.4 * d), 2.5)
	const kg = g.seconds * W
	if (!(kg > 0)) return null
	const bulb = typeof P.bulb_cm === "number" ? P.bulb_cm : 5
	const holds = (0.75 * bulb * bulb * bulb) / 1000
	return kg <= 0.95 * holds ? { sand_kg: kg } : { sand_kg: kg, bulb_cm: Math.ceil(2 * Math.pow((kg * 1000) / 0.7, 1 / 3)) / 2 }
}
const pair = (v, d, u) => `${n0(v?.[0], d)} vs ${n0(v?.[1], d)}${u}`
/** A goal's result in words for the cards ("no (it ran out after 69.9 lesson s; the goal 60 ± 3 s)"): never a bare "no". */
const DETAIL = {
	piles: (e) => `${yes(e)} (${e.mm === null || e.mm === undefined ? "no heap there" : `${n0(e.mm)} mm tall, its sides at ${n0(e.deg, 1)}°`})`,
	stands: (e) => `${yes(e)} (${e.share === null || e.share === undefined ? "no reading" : `it ends ${n0(e.share * 100)} % as tall as it started`})`,
	collapses: (e) => `${yes(e)} (${e.share === null || e.share === undefined ? "no reading" : `it ends ${n0(e.share * 100)} % as tall as it started`})`,
	steeper: (e) => `${yes(e)} (${pair(e.deg, 1, "°")})`,
	crater: (e) => `${yes(e)} (${e.mm ? `${n0(e.mm)} mm rim to rim` : "no crater"})`,
	crater_bigger: (e) => `${yes(e)} (${pair(e.mm, 0, " mm")})`,
	sand_runs_out: (e) => `${yes(e)} (${e.t === null || e.t === undefined ? "it never runs out in the run" : `it runs out at ${n0(e.t, 2)} s of the run`})`,
	runs_out_first: (e) => `${yes(e)} (${(e.t ?? []).map((t) => (t === null ? "never" : `${n0(t, 2)} s`)).join(" vs ")})`,
	timer: (e) => `${yes(e)} (${e.jammed ? "its grains jam in the neck, so it never runs" : e.empty ? `it ran out after ${n0(e.s, 1)} lesson s` : `still running after ${n0(e.s, 1)} lesson s`}; the goal ${n0(e.want, 1)} ± ${n0(e.tol, 1)} s)`,
	clogs: (e) => `${yes(e)} (${e.t === null || e.t === undefined ? "its grains keep running" : `from ${n0(e.t, 2)} s`})`,
	erodes: (e) => `${yes(e)} (${n0(e.g)} g carried off)`,
	erodes_more: (e) => `${yes(e)} (${pair(e.g, 0, " g")})`,
	delta: (e) => `${yes(e)} (${n0(e.cm, 1)} cm past the sand's toe)`
}

export const plugin = {
	title: "Sand, gravel and soil: piles, craters, pouring, sand timers, erosion",
	howto: [
		"Granular items are FIXED in place (static) and stand on what is under them (the table, a ramp, a tray): sand-pile (a heap of `sand_kg` kg at its angle of repose, or shape \"castle\": a packed tower `width` × `height`), sand-tray (a wooden box filled level with `sand_depth` of grains: drop balls into it for craters, roll things into it), sand-funnel (a funnel of `sand_kg` kg on a ring stand, its spout `height` m over its base; at the release it pours at Beverloo's steady rate and heaps up below), hourglass (a sand timer: `sand_kg` kg through a `neck_mm` neck; 66 g of fine sand through 3 mm = 60 s; its top bulb holds about 0.75·bulb_cm³ g of fine sand: 5 cm 94 g, 6 cm 160 g, 8 cm 380 g) and stream-table (a tray tipped `tilt_deg`, damp sand over `sand_share` of it from the high end, a hose of `flow_lpm` at the high end from the release, a pool `lake_cm` deep at the low end). Anchors: a pile's at the middle of its base on the surface; a funnel's under its spout, on the surface its stand stands on (the stand's foot is drawn beside the heap, about 6 cm past the funnel's rim); a tray's and an hourglass's at the middle of their base; a stream table's at the middle of its tipped floor.",
		"A heap must fit on what it stands on: a plank or a shelf is only 12 cm deep, so a heap wider than it (over about 300 g of sand) runs off its edge before the run, falls to what is below and reads spilled_g (the run says \"<heap> does not fit on <plank>\"); for a big heap use the table or a sand-tray (grains rest only on FIXED things: never on a ball, a car or a board that can move).",
		"Grains (`grain`): sand 0.4 mm (dry repose 34°), fine sand 0.18 mm (32°), coarse sand 1 mm (35°), gravel 6 mm (38°), pebbles 2 cm (40°), soil (35°, sticky), flour (45°: the crater medium); the kitchen's: sugar 0.5 mm (35°, 800 kg/m³ poured: 200 mL is 160 g), salt 0.4 mm (32°, 1200 kg/m³), rice (long grains, 32°, 770 kg/m³; a spout or neck must be over 14 mm for it). `wetness`: dry (flows, heaps at its angle of repose), damp (sticks: a castle up to about 23 cm stands with straight walls; taller, it crushes and slumps), soaked (slumps to 20-28°). A dry castle collapses into a cone in a fraction of a second; a damp one stands.",
		"Pouring: a funnel's flow is Beverloo's W = 0.58·ρ_b·√g·(D − 1.4d)^2.5: sand through a 10 mm spout 25 g/s, 20 mm 140 g/s. A spout or neck jams (clogs) under about 5 grains: dry fine sand needs over 0.9 mm, sand 2 mm, coarse sand 5 mm, gravel 30 mm, pebbles 10 cm; flour arches over anything under 20 mm and soil under 15 mm; damp sand jams in any funnel. A heap's height grows with the cube root of its mass; its slope stays the angle of repose.",
		"Poured heaps: to show the heap a funnel pours, use the funnel ALONE: never put a sand-pile under a funnel (a ready-made cone is not what was poured). The funnel itself reads its heap (heap_mm, heap_deg, heap_g), and piles {item: the funnel}, steeper {a: funnel, b: funnel} judge that poured heap. Which grains heap steepest: one funnel per grain side by side (about 0.6 m apart), each with a spout wide enough for its grains (sand 10-15 mm, gravel 40 mm, flour 25 mm), sand_kg 0.2-0.3, and seconds enough for each to empty.",
		"Sand timers: an hourglass runs only dry fine sand (neck over 0.9 mm), sand (over 2 mm) or coarse sand (over 5 mm); gravel, pebbles, soil and flour jam in any neck it has (12 mm at most). A jammed timer reads clogged 1 (\"jammed\"), its clock (run_s) stops and the run says \"<timer> jams: its grains arch over the 3 mm neck\": widen the neck past 5 grains or use finer grains. The hourglass is its own clock: time it by its run_s and the timer goal (lesson seconds, with the scene's time-lapse); a stopwatch can time it too: watch = the hourglass, stop = reads (stop_reading empty, stop_value 1: it stops as the sand runs out), counts lesson under a time-lapse (its face then shows lesson seconds, and a reads goal's seconds are those).",
		"Craters: hold a ball above a sand-tray (place it in the air over the tray, held, released at the scene's release): it strikes, throws sand out and is buried; the crater follows Uehara et al.'s law, D ≈ 0.9·(ρ_ball/ρ_sand)^¼·D_ball^¾·H^¼/√(tan repose): a 2.5 cm steel ball from 0.6 m about 9 cm, from 1 m about 10 cm; a ping-pong ball only about its own size (4-4.5 cm), whatever the height: a heavier ball, or a higher drop, makes a wider crater. In sand thinner than the ball goes (a 1 cm layer), it hits the floor and the crater is smaller. Compare two trays side by side. A ball or a toy car rolled into sand ploughs and stops.",
		"Erosion: a stream-table needs time: set the scene's settings.time_lapse (10-30) so seconds of the run are minutes of the lesson (the sand changes that much faster; the water runs as it does). More slope, more water or finer grains erode more; gravel hardly moves; plants (\"lower half\", \"all\") protect the sand they cover. Two tables side by side differing in ONE prop make a fair test.",
		"Readings each run: a pile's height_mm, width_mm, angle_deg, mass_g (on what it stands on), spilled_g; a tray's crater_mm (rim to rim), crater_depth_mm; a funnel's left_g, poured_g, flow_gs, clogged, heap_mm, heap_deg, heap_g (the heap it poured); an hourglass's top_g, bottom_g, flow_gs, run_s (lesson seconds), empty, clogged; a stream table's eroded_g (sand carried off the slope), delta_cm, channel_mm.",
		"Containers keep grains: a glass-jar (made wider and lower it is a dish, narrower and taller a glass; set its depth to its width), cup, plastic-cup, bucket, basket, box, beaker, graduated-cylinder, measuring-jug, coffee-mug or bowl that grains pour into (from a funnel, or a pitcher of grains: the flow module's pitcher with contents \"grains\") or that a sand-pile is laid in (its anchor on the container's floor) holds every grain inside its round or square walls: they pile up in it at their angle of repose, a bed that fills it topped by a cone once the heap reaches its wall (400 g of sand in a 6.5 cm glass: a 10.5 cm bed and cone, nothing outside). The pourer's heap_mm, heap_deg and heap_g are read inside the container; outside_g is what missed it (a pile's spilled_g). A funnel's spout or a cup's lip goes over the opening's middle (grains fall nearly straight down).",
		"A kitchen-scale weighs the grains resting on its platform or in a bowl or coffee-mug standing on it (a heap poured on it from a funnel above it, a sand-pile set on it: on: the scale, or sugar poured into a bowl on it: the bowl and the sugar); a fixed cup, jar, beaker, bucket or box holds its own grains (a scale under one weighs neither): measure's reads {item: scale, grams}; its tare zeroes a heap set on it before the release. Known limits: sieving (separating sand from gravel or pebbles by grain size) is the matter module's mixture-dish and sieve, not these items."
	].join(" "),
	prompt: {
		plan: [
			"Sand and soil: sand-pile, sand-tray, sand-funnel, hourglass and stream-table stand fixed on the table (place {on: \"table\"}); set their grain and wetness props. A funnel pours at the release (its `delay` later) and a stream table's hose runs from the release, so give funnels and hourglasses seconds enough (sand_kg ÷ flow: 0.3 kg of sand at 25 g/s is 12 s; a 60 s hourglass needs settings.time_lapse ≥ 4 to run out in a 15 s run) and stream tables a time_lapse of 10-30. A poured heap is the funnel's own: never put a sand-pile under a funnel; judge it with piles/steeper on the funnel. A heap on a plank or shelf must fit it (12 cm deep: up to about 300 g).",
			"Craters: a sand-tray (sand or flour) with a ball held over it (place {on: \"air\", x: the tray's x, y_m: drop height + the tray's sand top}, held: true): compare drop heights or balls in two trays side by side. Goals: crater {item: tray, min_mm?}, crater_bigger {a: tray, b: tray}. Piles: piles {item: pile or funnel, min_deg?, max_deg?}, steeper {a, b} (piles or funnels), stands {item} / collapses {item} for castles (damp vs dry). Pouring and timers: sand_runs_out {item, before_s?}, runs_out_first {a, b}, timer {item: hourglass, seconds, tol_s?} (tol_s in seconds; leave it out for 5 %), clogs {item: funnel or hourglass}. Erosion: erodes {item, min_g?}, erodes_more {a, b}, delta {item, min_cm?}. Time a sand timer by its own timer goal, or by a stopwatch with stop = reads (stop_reading empty) watching it."
		].join("\n"),
		edit: "Sand and soil: change grains with grain/wetness; a heap's size with sand_kg; a castle's with width/height (damp stands, dry slumps); a funnel's rate with outlet_mm (wider: faster; too narrow for the grains: it clogs); an hourglass's time with sand_kg (more sand: longer; past what its top bulb holds, about 0.75·bulb_cm³ g, widen bulb_cm too) or neck_mm (wider: shorter; under 5 grains wide it jams: coarse sand needs over 5 mm); a funnel holds about 0.36·funnel_cm³ g (12 cm: 620 g); a stream table's erosion with tilt_deg, flow_lpm, grain (finer erodes more, gravel hardly) or plants (cover protects). A crater grows with the ball's drop height (move the ball up) and its weight. A change of grain, spout or neck can make a goal stale (fine sand instead of gravel in a funnel that had \"clogs\"; coarse sand in a timer that had \"timer\"): rewrite that goal with set_goals to what the change now shows (sand_runs_out, or clogs) and say so in the reply.",
		refine: "Sand and soil: a funnel or an hourglass must run long enough to empty within the run (raise seconds or settings.time_lapse, or shrink sand_kg); a stream table needs settings.time_lapse 10-30 to show erosion; a crater goal needs the ball held above the tray's sand (not resting on it) and released; a poured heap is the funnel's (remove any sand-pile put under a funnel); a timer that jams needs a wider neck or finer grains."
	},
	examples: [
		{ ask: "Pour sand from a funnel onto the table to see it make a cone-shaped pile.", how: "a sand-funnel (sand_kg 0.3, outlet_mm 10, height 0.25) on the table, nothing under it; seconds ≥ mass ÷ 25 g/s + 2; goals sand_runs_out {funnel}, piles {funnel} (its poured heap)", plan: { seconds: 15, items: [{ id: "funnel", type: "sand-funnel", props: { sand_kg: 0.3, outlet_mm: 10, height: 0.25 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "sand_runs_out", item: "funnel" }, { kind: "piles", item: "funnel" }] } },
		{ ask: "Pour sugar into a glass jar and see it pile up.", how: "a glass-jar on the table and a sand-funnel of sugar (grain sugar, sand_kg 0.15, outlet_mm 12, height 0.25) at the jar's x, its spout over the jar's middle; seconds ≥ 150 g ÷ 20 g/s + 2; the jar keeps every grain; goal piles {funnel} (its heap in the jar)", plan: { seconds: 10, items: [{ id: "jar", type: "glass-jar", place: { on: "table", x: 1.2 } }, { id: "funnel", type: "sand-funnel", props: { grain: "sugar", sand_kg: 0.15, outlet_mm: 12, height: 0.25 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "piles", item: "funnel" }] } },
		{ ask: "Pour dry sand from one funnel and gravel from another: which makes the steeper pile?", how: "two sand-funnels side by side (sand: outlet_mm 12; gravel: outlet_mm 40), sand_kg 0.25 each, NO sand-pile under them; goal steeper {a: gravel funnel, b: sand funnel} on their poured heaps", plan: { seconds: 9, items: [{ id: "sandF", type: "sand-funnel", props: { grain: "sand", sand_kg: 0.25, outlet_mm: 12, height: 0.25 }, place: { on: "table", x: 0.9 } }, { id: "gravelF", type: "sand-funnel", props: { grain: "gravel", sand_kg: 0.25, outlet_mm: 40, height: 0.25 }, place: { on: "table", x: 1.6 } }], goals: [{ kind: "steeper", a: "gravelF", b: "sandF" }] } },
		{ ask: "Drop a steel ball into sand from a low and a high height: which makes the bigger crater?", how: "two sand-trays side by side, a steel-ball held over each (place on air, x = the tray's x, y_m 0.6 and 0.2); goal crater_bigger {a: high tray, b: low tray}", plan: { seconds: 3, items: [{ id: "trayA", type: "sand-tray", place: { on: "table", x: 0.8 } }, { id: "trayB", type: "sand-tray", place: { on: "table", x: 1.6 } }, { id: "high", type: "steel-ball", props: { diameter: 0.025 }, held: true, place: { on: "air", x: 0.8, y_m: 0.6 } }, { id: "low", type: "steel-ball", props: { diameter: 0.025 }, held: true, place: { on: "air", x: 1.6, y_m: 0.2 } }], goals: [{ kind: "crater_bigger", a: "trayA", b: "trayB" }] } },
		{ ask: "Make a sand timer that runs out in about 30 seconds.", how: "an hourglass of fine sand (sand_kg 0.033 with the 3 mm neck: 1.1 g/s), settings.time_lapse 4 and seconds 12; goal timer {item, seconds: 30} (5 % by default; tol_s is in seconds)", plan: { seconds: 12, settings: { time_lapse: 4 }, items: [{ id: "timer", type: "hourglass", props: { sand_kg: 0.033 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "timer", item: "timer", seconds: 30 }] } },
		{ ask: "Build a sandcastle from damp sand and one from dry sand: which stands?", how: "two sand-piles with shape castle, wetness damp and dry; goals stands {damp}, collapses {dry}", plan: { seconds: 3, items: [{ id: "damp", type: "sand-pile", props: { shape: "castle", wetness: "damp" }, place: { on: "table", x: 0.9 } }, { id: "dry", type: "sand-pile", props: { shape: "castle", wetness: "dry" }, place: { on: "table", x: 1.5 } }], goals: [{ kind: "stands", item: "damp" }, { kind: "collapses", item: "dry" }] } },
		{ ask: "Does a steeper stream table erode more sand? (5 minutes)", how: "two stream-tables (tilt_deg 12 and 4), settings.time_lapse 20, seconds 15; goal erodes_more {a: steep, b: gentle}", plan: { seconds: 15, settings: { time_lapse: 20 }, items: [{ id: "steep", type: "stream-table", props: { tilt_deg: 12 }, place: { on: "table", x: 0.75 } }, { id: "gentle", type: "stream-table", props: { tilt_deg: 4 }, place: { on: "table", x: 1.85 } }], goals: [{ kind: "erodes_more", a: "steep", b: "gentle" }] } }
	],
	goals: [
		{ kind: "piles", aliases: ["pile", "heap", "forms_pile", "angle_of_repose", "repose"], fields: { item: "item", min_deg: "number?", max_deg: "number?" },
			about: "piles {item: sand-pile, or sand-funnel for the heap it pours, min_deg?, max_deg?}: at the end it stands as a heap at least 5 mm tall, its slope (angle_deg, a funnel's heap_deg) within the bounds",
			label: (g, n) => `${n(g.item)} stands as a heap`, summarize: (ctx, g) => piles(ctx, g), detail: DETAIL.piles,
			sample: (scene, pick) => { const xs = ofType(scene, HEAPS); return xs.length ? { kind: "piles", item: pick(xs).id, ...(pick([true, false]) ? { min_deg: pick([25, 30, 33]), max_deg: pick([36, 40, 50]) } : {}) } : null } },
		{ kind: "stands", aliases: ["stays_standing", "holds_shape", "stand"], fields: { item: "item" },
			about: "stands {item}: a sand-pile (a castle) ends at least 90 % as tall as it started",
			label: (g, n) => `${n(g.item)} stays standing`, summarize: (ctx, g) => stands(ctx, g), detail: DETAIL.stands,
			sample: (scene, pick) => { const xs = ofType(scene, PILES); return xs.length ? { kind: "stands", item: pick(xs).id } : null } },
		{ kind: "collapses", aliases: ["collapse", "slumps", "falls_apart", "crumbles"], fields: { item: "item" },
			about: "collapses {item}: a sand-pile (a castle) ends under 70 % of the height it started at",
			label: (g, n) => `${n(g.item)} collapses`, summarize: (ctx, g) => collapses(ctx, g), detail: DETAIL.collapses,
			sample: (scene, pick) => { const xs = ofType(scene, PILES); return xs.length ? { kind: "collapses", item: pick(xs).id } : null } },
		{ kind: "steeper", aliases: ["steeper_pile", "steeper_than"], fields: { a: "item", b: "item" }, subject: ["a", "b"],
			about: "steeper {a, b}: heap a's slope ends at least 1° steeper than heap b's (sand-piles, or sand-funnels for the heaps they pour)",
			label: (g, n) => `${n(g.a)} stands steeper than ${n(g.b)}`, summarize: (ctx, g) => steeper(ctx, g), detail: DETAIL.steeper,
			sample: (scene, pick) => { const xs = ofType(scene, HEAPS); return xs.length >= 2 ? { kind: "steeper", a: xs[0].id, b: xs[1].id } : null } },
		{ kind: "crater", aliases: ["makes_crater", "craters", "impact_crater"], fields: { item: "item", min_mm: "number?" },
			about: "crater {item: sand-tray, min_mm?}: a crater at least min_mm (default 10) wide rim to rim ends in the tray",
			label: (g, n) => `a crater forms in ${n(g.item)}`, summarize: (ctx, g) => crater(ctx, g), detail: DETAIL.crater,
			sample: (scene, pick) => { const xs = ofType(scene, TRAYS); return xs.length ? { kind: "crater", item: pick(xs).id, ...(pick([true, false]) ? { min_mm: pick([20, 40, 80]) } : {}) } : null } },
		{ kind: "crater_bigger", aliases: ["bigger_crater", "wider_crater", "crater_wider"], fields: { a: "item", b: "item" }, subject: ["a", "b"],
			about: "crater_bigger {a, b}: the crater in sand-tray a ends clearly wider than the one in tray b (by 2 mm and 5 %)",
			label: (g, n) => `the crater in ${n(g.a)} is wider than in ${n(g.b)}`, summarize: (ctx, g) => crater_bigger(ctx, g), detail: DETAIL.crater_bigger,
			sample: (scene, pick) => { const xs = ofType(scene, TRAYS); return xs.length >= 2 ? { kind: "crater_bigger", a: xs[0].id, b: xs[1].id } : null } },
		{ kind: "sand_runs_out", aliases: ["funnel_empties", "hourglass_empties", "timer_runs_out", "sand_empties", "runs_out_of_sand", "pours_out"], fields: { item: "item", before_s: "number?", after_s: "number?" },
			about: "sand_runs_out {item: sand-funnel or hourglass, before_s?, after_s?}: its grains all run out (within those run seconds); for liquids use the flow module's empties",
			label: (g, n) => `${n(g.item)} runs out of sand`, summarize: (ctx, g) => empties(ctx, g), detail: DETAIL.sand_runs_out,
			sample: (scene, pick) => { const xs = ofType(scene, POURERS); return xs.length ? { kind: "sand_runs_out", item: pick(xs).id, ...(pick([true, false]) ? { before_s: pick([2, 10, 15]) } : {}) } : null } },
		{ kind: "runs_out_first", aliases: ["sand_runs_out_first", "timer_runs_out_first", "hourglass_first", "faster_timer"], fields: { a: "item", b: "item" }, subject: ["a", "b"],
			about: "runs_out_first {a, b}: funnel/hourglass a runs out of sand clearly before b (by 2 % of b's time), or b never does",
			label: (g, n) => `${n(g.a)} runs out of sand before ${n(g.b)}`, summarize: (ctx, g) => empties_first(ctx, g), detail: DETAIL.runs_out_first,
			sample: (scene, pick) => { const xs = ofType(scene, POURERS); return xs.length >= 2 ? { kind: "runs_out_first", a: xs[0].id, b: xs[1].id } : null } },
		{ kind: "timer", aliases: ["times", "sand_timer", "runs_for", "hourglass_time"], fields: { item: "item", seconds: "number", tol_s: "number?", tol: "number?" },
			about: "timer {item: hourglass, seconds, tol_s?}: it runs out after `seconds` lesson seconds, within tol_s SECONDS (default 5 % of seconds; an old `tol` under 1 is read as a share: 0.1 = 10 %); run_s counts the scene's time-lapse, and stops while a jam blocks the neck",
			label: (g, n) => `${n(g.item)} runs out at ${g.seconds} s`, summarize: (ctx, g) => timer(ctx, g), detail: DETAIL.timer,
			sample: (scene, pick) => { const xs = ofType(scene, ["hourglass"]); return xs.length ? { kind: "timer", item: pick(xs).id, seconds: pick([30, 60, 120]), ...(pick([true, false]) ? { tol_s: pick([1, 3, 6]) } : {}) } : null } },
		{ kind: "clogs", aliases: ["clog", "jams", "gets_stuck", "blocked"], fields: { item: "item" },
			about: "clogs {item: sand-funnel or hourglass}: its grains jam in the spout or the neck (too narrow for them)",
			label: (g, n) => `${n(g.item)} clogs`, summarize: (ctx, g) => clogs(ctx, g), detail: DETAIL.clogs,
			sample: (scene, pick) => { const xs = ofType(scene, POURERS); return xs.length ? { kind: "clogs", item: pick(xs).id } : null } },
		{ kind: "erodes", aliases: ["erosion", "erode", "washes_away", "carves"], fields: { item: "item", min_g: "number?" },
			about: "erodes {item: stream-table, min_g?}: the water carries at least min_g (default 20) g of sand away from where it lay",
			label: (g, n) => `the water erodes sand in ${n(g.item)}`, summarize: (ctx, g) => erodes(ctx, g), detail: DETAIL.erodes,
			sample: (scene, pick) => { const xs = ofType(scene, STREAMS); return xs.length ? { kind: "erodes", item: pick(xs).id, ...(pick([true, false]) ? { min_g: pick([10, 50, 200]) } : {}) } : null } },
		{ kind: "erodes_more", aliases: ["more_erosion", "erodes_faster"], fields: { a: "item", b: "item" }, subject: ["a", "b"],
			about: "erodes_more {a, b}: the water erodes clearly more sand in stream table a than in b (by 10 g and 5 %)",
			label: (g, n) => `the water erodes more sand in ${n(g.a)} than in ${n(g.b)}`, summarize: (ctx, g) => erodes_more(ctx, g), detail: DETAIL.erodes_more,
			sample: (scene, pick) => { const xs = ofType(scene, STREAMS); return xs.length >= 2 ? { kind: "erodes_more", a: xs[0].id, b: xs[1].id } : null } },
		{ kind: "delta", aliases: ["builds_delta", "deposits", "deposition"], fields: { item: "item", min_cm: "number?" },
			about: "delta {item: stream-table, min_cm?}: the sand the water drops reaches at least min_cm (default 1) past the sand's toe toward the pool",
			label: (g, n) => `a delta forms in ${n(g.item)}`, summarize: (ctx, g) => delta(ctx, g), detail: DETAIL.delta,
			sample: (scene, pick) => { const xs = ofType(scene, STREAMS); return xs.length ? { kind: "delta", item: pick(xs).id } : null } }
	],
	knobs: [
		{ type: "sand-funnel", key: "outlet_mm", how: "rel", steps: [0.1, 0.25, 0.5, 1.0, 2.0, 3.0], cost: 0.15, more: "widen {it}'s spout", less: "narrow {it}'s spout", why: "a wider spout pours faster (Beverloo: as the width to the 2.5) and stops jamming once it is over about 5 grains wide (gravel needs 3-4 cm, flour 2-3 cm)" },
		{ type: "sand-funnel", key: "sand_kg", how: "rel", more: "put more grains in {it}", less: "put fewer grains in {it}", why: "more grains make a bigger heap (its height grows as the cube root of its mass) and take longer to pour" },
		{ type: "sand-funnel", key: "grain", how: "choice", cost: 15, more: "fill {it} with {to} instead", less: "fill {it} with {to} instead", why: "finer dry grains pour through a narrower spout; gravel jams in small spouts, flour arches over them; a steeper heap needs coarser or stickier grains (gravel 38°, flour 45°)" },
		{ type: "hourglass", key: "sand_kg", how: "rel", steps: [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.1, 1.2, 1.35, 1.5, 2.0], cost: 0.1, more: "put more sand in {it}", less: "put less sand in {it}", why: "the time is the sand's mass over the steady flow: twice the sand runs twice as long (a jammed neck never runs, whatever the sand)" },
		{ type: "hourglass", key: "neck_mm", how: "rel", steps: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 0.75, 1.0, 1.5], cost: 0.5, more: "widen {it}'s neck", less: "narrow {it}'s neck", why: "the flow grows as the neck's width to the 2.5: a neck a quarter wider runs out in about 0.6 of the time; a neck under 5 grains wide jams (coarse sand needs over 5 mm, sand 2 mm, fine sand 0.9 mm): widening it past that is the honest fix when the grains are the person's choice" },
		{ type: "hourglass", key: "neck_mm", how: "rel", steps: [0.5, 0.75, 1.0, 1.5, 2.0], cost: 0.6, also: keepTime, more: "widen {it}'s neck", less: "narrow {it}'s neck", why: "with a timer goal: a neck widened past 5 grains (the jam's honest fix when the grains are the person's) with the sand that keeps the goal's time (sand = seconds × the flow; a bigger bulb when the top one cannot hold it)" },
		{ type: "hourglass", key: "grain", how: "choice", cost: 15, more: "fill {it} with {to} instead", less: "fill {it} with {to} instead", why: "finer grains pass a narrower neck (it must be over 5 grains wide) and run a little faster; gravel, pebbles, soil and flour jam in any timer's neck" },
		{ type: "sand-pile", key: "sand_kg", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a bigger heap is taller and wider at the same slope (on a 12 cm plank, over about 300 g of sand spills off)" },
		{ type: "sand-pile", key: "wetness", how: "choice", cost: 3, more: "make {it} {to}", less: "make {it} {to}", why: "damp sand sticks (a castle stands); dry sand slumps to its angle of repose; soaked sand slumps flatter" },
		{ type: "sand-pile", key: "height", how: "rel", cost: 2, more: "build {it} taller", less: "build {it} lower", why: "a damp sand castle taller than about 23 cm crushes under its own weight (coarse sand about 9 cm)" },
		{ type: "sand-tray", key: "sand_depth", how: "m", cost: 2, more: "fill {it} deeper", less: "fill {it} shallower", why: "a crater needs sand deeper than the ball goes (a few cm); too shallow and the ball hits the floor and the crater is smaller" },
		{ type: "sand-tray", key: "grain", how: "choice", cost: 15, more: "fill {it} with {to} instead", less: "fill {it} with {to} instead", why: "flour and fine sand show crisp craters; gravel barely dents" },
		{ type: "stream-table", key: "tilt_deg", how: "abs", steps: [1, 2, 4, 6], cost: 0.25, more: "tip {it} more", less: "tip {it} less", why: "a steeper slope makes the water faster and its push on the sand stronger: more erosion" },
		{ type: "stream-table", key: "flow_lpm", how: "rel", steps: [0.1, 0.25, 0.5, 1.0, 2.0], cost: 0.5, more: "turn {it}'s water up", less: "turn {it}'s water down", why: "more water flows deeper and faster: it carries more sand" },
		{ type: "stream-table", key: "grain", how: "choice", cost: 15, more: "fill {it} with {to} instead", less: "fill {it} with {to} instead", why: "fine sand and soil wash away easily; coarse sand less; gravel hardly moves" },
		{ type: "stream-table", key: "plants", how: "choice", cost: 4, more: "change the grass on {it} to {to}", less: "change the grass on {it} to {to}", why: "roots and stems hold the sand they cover: the water cannot pick it up there" },
		{ type: "stream-table", key: "sand_depth", how: "m", cost: 3, more: "pile more sand in {it}", less: "use less sand in {it}", why: "deeper sand lets the channel cut deeper before it reaches the tray" }
	],
	place: {
		containers: TRAYS,
		/** A sand tray's inside in its own frame: between its walls, from its sand's top to its rim (what goes in rests on the sand). */
		interior(type, props) {
			if (type !== "sand-tray") return null
			const P = { length: 0.5, wall: 0.08, sand_depth: 0.05, ...(props ?? {}) }
			const fill = pymin(P.sand_depth, P.wall)
			return { x0: -P.length / 2, x1: P.length / 2, floor: 0.012 + fill, rim: 0.012 + P.wall }
		}
	},
	digest(item, run) {
		const out = []
		const P = run?.resolved?.[item.id] ?? item.props ?? {}
		const goalsOf = (kind) => (run?.summary?.goals ?? []).filter((g) => g && g.kind === kind && (g.item === item.id || g.a === item.id || g.b === item.id))
		if (item.type === "sand-pile") {
			const h0 = startOf(run, item.id, "height_mm")
			const h1 = endOf(run, item.id, "height_mm")
			out.push(`${P.shape === "castle" ? `a ${P.wetness ?? "dry"} ${P.grain ?? "sand"} castle ${n0((P.width ?? 0.08) * 100, 1)} cm wide, ${n0((P.height ?? 0.12) * 100, 1)} cm tall` : `a heap of ${n0((P.sand_kg ?? 1) * 1000)} g of ${P.wetness ?? "dry"} ${P.grain ?? "sand"}`}`)
			if (h1 !== null) out.push(`height ${n0(h0)} → ${n0(h1)} mm, slope ${n0(endOf(run, item.id, "angle_deg"), 1)}°, ${n0(endOf(run, item.id, "width_mm"))} mm wide`)
			const sp = endOf(run, item.id, "spilled_g")
			if (sp !== null && sp >= 1) out.push(`it does NOT fit on what it stands on: ${n0(sp)} g ran off the edge (${n0(endOf(run, item.id, "mass_g"))} g stays on it): a smaller heap, or the table or a sand-tray under it`)
		} else if (item.type === "sand-tray") {
			out.push(`${n0((P.sand_depth ?? 0.05) * 100, 1)} cm of ${P.wetness ?? "dry"} ${P.grain ?? "sand"}; its sand's top at ${n0(((P.sand_depth ?? 0.05) + 0.012) * 100, 1)} cm over its base`)
			const d = endOf(run, item.id, "crater_mm")
			if (d !== null) out.push(d > 0 ? `crater ${n0(d)} mm rim to rim, ${n0(endOf(run, item.id, "crater_depth_mm"))} mm deep` : "no crater")
		} else if (item.type === "sand-funnel") {
			out.push(`${n0((P.sand_kg ?? 0.3) * 1000)} g of ${P.wetness ?? "dry"} ${P.grain ?? "sand"}, spout ${n0(P.outlet_mm ?? 10, 1)} mm, ${cmOf(P.height ?? 0.2)} over its base`)
			const left = endOf(run, item.id, "left_g")
			if (left !== null) out.push(`poured ${n0(endOf(run, item.id, "poured_g"))} g (${n0(left)} g left)${endOf(run, item.id, "clogged") === 1 ? `; it CLOGGED: the ${n0(P.outlet_mm ?? 10, 1)} mm spout is too narrow for ${P.grain ?? "sand"} (it needs over ${n0(JAM_MM[P.grain ?? "sand"] ?? 2, 1)} mm${(P.wetness ?? "dry") !== "dry" ? ", and dry grains" : ""})` : ""}`)
			const hm = endOf(run, item.id, "heap_mm")
			if (hm !== null && hm > 0) out.push(`its poured heap: ${n0(hm)} mm tall, sides at ${n0(endOf(run, item.id, "heap_deg"), 1)}°, ${n0(endOf(run, item.id, "heap_g"))} g (what piles/steeper on this funnel judge)${(endOf(run, item.id, "outside_g") ?? 0) > 0.5 ? `; ${n0(endOf(run, item.id, "outside_g"))} g landed OUTSIDE the container under it: put the spout over its opening's middle` : ""}`)
		} else if (item.type === "hourglass") {
			out.push(`${n0((P.sand_kg ?? 0.066) * 1000)} g of ${P.grain ?? "fine sand"} through a ${n0(P.neck_mm ?? 3, 1)} mm neck`)
			const s = endOf(run, item.id, "run_s")
			const goal = goalsOf("timer")[0]
			const aim = goal && Number.isFinite(goal.want) ? ` (goal ${n0(goal.want, 1)} ± ${n0(goal.tol, 1)} s)` : ""
			if (endOf(run, item.id, "clogged") === 1) out.push(`it JAMS: its ${P.grain ?? "fine sand"} arches over the ${n0(P.neck_mm ?? 3, 1)} mm neck and nothing runs, its clock stopped at ${n0(s, 1)} s${aim}: the neck must be over ${n0(JAM_MM[P.grain ?? "fine sand"] ?? 1, 1)} mm for these grains, or use finer grains`)
			else if (s !== null) out.push(endOf(run, item.id, "empty") === 1 ? `ran out after ${n0(s, 1)} lesson s${aim}` : `still running after ${n0(s, 1)} lesson s (${n0(endOf(run, item.id, "top_g"), 1)} g left on top)${aim}`)
		} else if (item.type === "stream-table") {
			out.push(`tipped ${n0(P.tilt_deg ?? 6, 1)}°, ${n0(P.flow_lpm ?? 1, 1)} L/min, ${P.wetness ?? "damp"} ${P.grain ?? "sand"} ${n0((P.sand_depth ?? 0.05) * 100, 1)} cm deep${P.plants && P.plants !== "none" ? `, grass on the ${P.plants}` : ""}`)
			const e = endOf(run, item.id, "eroded_g")
			if (e !== null) out.push(`eroded ${n0(e)} g, channel ${n0(endOf(run, item.id, "channel_mm"))} mm deep, delta ${n0(endOf(run, item.id, "delta_cm"), 1)} cm`)
		}
		return out.length ? out : null
	},
	words: {
		// (the words that name a setting in a request: "make the sand timer's neck 4 mm wide" holds its neck_mm, so no fix offers 3 mm back; a grain
		// named, "fill it with coarse sand", holds the grain)
		keys: {
			"sand-funnel.outlet_mm": "spout\\w*|hole\\w*|outlet\\w*|opening\\w*|neck\\w*",
			"sand-funnel.sand_kg": "more sand|less sand|more grains|fewer grains|grams?|kg|kilo\\w*|how much",
			"sand-funnel.grain": "sand|fine sand|coarse sand|gravel|pebbles?|soil|dirt|flour|grains?|powder|sugar|salt|rice",
			"sand-funnel.wetness": "damp|wet|dry|drier|soaked|moist\\w*|water\\w*",
			"hourglass.neck_mm": "neck\\w*|hole\\w*|opening\\w*",
			"hourglass.sand_kg": "more sand|less sand|grams?|kg|how much",
			"hourglass.bulb_cm": "bulbs?|glass",
			"hourglass.grain": "sand|fine sand|coarse sand|gravel|pebbles?|soil|dirt|flour|grains?|powder|sugar|salt|rice",
			"sand-pile.sand_kg": "more sand|less sand|grams?|kg|kilo\\w*|how much",
			"sand-pile.wetness": "damp|wet|dry|drier|soaked|moist\\w*|water\\w*",
			"sand-pile.shape": "castle|heap|pile|cone|tower",
			"sand-pile.grain": "sand|fine sand|coarse sand|gravel|pebbles?|soil|dirt|flour|grains?|powder|sugar|salt|rice",
			"sand-tray.sand_depth": "deep\\w*|depth|shallow\\w*",
			"sand-tray.grain": "sand|fine sand|coarse sand|gravel|pebbles?|soil|dirt|flour|grains?|powder",
			"sand-tray.wetness": "damp|wet|dry|drier|soaked|moist\\w*|water\\w*",
			"stream-table.tilt_deg": "tip\\w*|tilt\\w*|steep\\w*|slope\\w*|angle|gentl\\w*|flatter",
			"stream-table.flow_lpm": "flow\\w*|hose|litres?|liters?|L/min|more water|less water",
			"stream-table.grain": "sand|fine sand|coarse sand|gravel|pebbles?|soil|dirt|flour|grains?|powder",
			"stream-table.plants": "plants?|plant\\w*|grass\\w*|roots?|vegetation",
			"stream-table.sand_depth": "deep\\w*|depth|shallow\\w*|more sand|less sand",
			"stream-table.lake_cm": "pool|lake|pond|standing water"
		},
		// (a change of grains, of their wetness, or of a spout or a neck changes what a goal must expect: fine sand pours where gravel jammed,
		// coarse sand jams a neck fine sand ran through; an edit asking for it may rewrite such a goal (web/sim/plugins.js moduleRegoals; verify-fga
		// G6: "fill the funnel with fine sand instead" kept "the gravel jams in the 10 mm spout", failing))
		regoals: "fine sand|coarse sand|gravel|pebbles?|flour|soil|dirt|sugar|salt|rice|damp|soaked|spout\\w*|neck\\w*|outlet\\w*",
		change(type, key, a, b) {
			const num = (v, d = 1) => (typeof v === "number" ? _fmt(v, d) : String(v))
			if (type === "stream-table" && key === "tilt_deg") return `slope ${num(a)} → ${num(b)}°`
			if (type === "stream-table" && key === "flow_lpm") return `water ${num(a)} → ${num(b)} L/min`
			if (type === "hourglass" && key === "neck_mm") return `neck ${num(a)} → ${num(b)} mm`
			if (type === "hourglass" && key === "sand_kg") return `sand ${num(a * 1000, 0)} → ${num(b * 1000, 0)} g`
			if (type === "sand-funnel" && key === "outlet_mm") return `spout ${num(a)} → ${num(b)} mm`
			if ((type === "sand-funnel" || type === "sand-pile") && key === "sand_kg") return `${num(a * 1000, 0)} → ${num(b * 1000, 0)} g of grains`
			if (type === "sand-tray" && key === "sand_depth") return `sand ${num(a * 100)} → ${num(b * 100)} cm deep`
			if (key === "grain" || key === "wetness" || key === "plants") return `${key === "plants" ? "plants" : key} ${a} → ${b}`
			return null
		}
	}
}
