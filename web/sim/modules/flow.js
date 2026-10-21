// The flow module: liquids that MOVE (pitchers, taps, bottles with holes, hoses and siphons, waterwheels; catalog cups catch what is poured).
// A port of machines/mod_flow.py, line by line (same names, same order, same numbers); plain ES module, no dependencies beyond web/sim.
// web/sim/modules/index.js registers it (register_all, as a catalog file's) after the catalog files; its `plugin` export is the AI's view of it
// (goal kinds, digest, knobs, prompt lines, change words: web/sim/plugins.js). The engine side: tooling/src/sim/modules/flow.ts (records
// flow-pour, flow-tap, flow-vessel, flow-basin, flow-hose, flow-wheel) with the physics in tooling/src/sim/flow.ts.
// Sources: see the Python file's docstring ([IAPWS-95], [CRC], [SHARQAWY], [NOUREDDINI], [YANNIOTIS], [WHITE], [EPA-WS], [PET]).
let register, ItemType, Prop, Link, Readout, add_look, LOOKS, LOOK_FILL, LOOK_SHADE, D2R, register_goal_kind, register_build_hook, CATEGORIES
let pyRound, pymin, pymax, hasOwn, truthy, cos, sin
let F = null

export const MODULE = "flow"
export const CATEGORY = "Pouring & flowing"

export function register_all(g) {
	;({ register, ItemType, Prop, Link, Readout, add_look, LOOKS, LOOK_FILL, LOOK_SHADE, D2R, register_goal_kind, register_build_hook, CATEGORIES } = g)
	;({ pyRound, pymin, pymax, hasOwn, truthy, cos, sin } = g.py)
	F = g
	if (!CATEGORIES.includes(CATEGORY)) CATEGORIES.push(CATEGORY)
	_looks()
	_pourers()
	_tap()
	_bottle()
	_hose()
	_wheel()
	_goals()
	register_build_hook(_basins)
}

// ---------------------------------------------------------------- liquids (machines/mod_fluids.py's table, the same words and numbers)
export const LIQUIDS = {
	water: [998.2, 0.001002, "Water at 20 °C: 998.2 kg/m³, 1.002 mPa·s [IAPWS-95]."],
	"salt water": [null, null, "Salt water (sodium chloride) at 20 °C: density and viscosity by its salt [CRC]."],
	"sea water": [1024.8, 0.00108, "Sea water, 35 g of salt a kilogram: 1024.8 kg/m³, 1.08 mPa·s [SHARQAWY]."],
	"vegetable oil": [920.0, 0.06, "Soybean or canola oil: about 920 kg/m³, about 0.06 Pa·s [NOUREDDINI] (approximate)."],
	honey: [1420.0, 10.0, "Honey: about 1420 kg/m³; 2-20 Pa·s by its water, 10 used [YANNIOTIS] (approximate)."],
	"corn syrup": [1380.0, 2.5, "Light corn syrup: about 1380 kg/m³, about 2.5 Pa·s (approximate: brands differ)."],
	"dish soap": [1050.0, 0.5, "Liquid dish soap: about 1050 kg/m³, about 0.5 Pa·s (manufacturers' data; approximate)."],
	"rubbing alcohol": [880.0, 0.0025, "Rubbing alcohol (70 % isopropyl): about 880 kg/m³, about 2.5 mPa·s (approximate)."],
	milk: [1030.5, 0.0021, "Whole milk at 20 °C: 1030.5 kg/m³ [MILK-RHO], 2.1 mPa·s [MILK-MU]; white and opaque (its fat droplets and casein scatter light)."],
	"chocolate milk": [1065.0, 0.008, "Chocolate milk at 20 °C: about 1065 kg/m³ (provisional); about 8 mPa·s as it pours (7.1 at 150 1/s, 13.2 at " +
		"10 1/s: it thins as it flows [DRINKS-RHEO]); brown and opaque."]
}
export const LIQUID_NAMES = Object.keys(LIQUIDS)
const SALT = [
	[0.0, 998.2, 1.002], [1.0, 1005.3, 1.02], [2.0, 1012.5, 1.036], [4.0, 1026.8, 1.07], [6.0, 1041.3, 1.108], [8.0, 1055.9, 1.149],
	[10.0, 1070.7, 1.193], [12.0, 1085.7, 1.244], [14.0, 1100.9, 1.3], [16.0, 1116.2, 1.361], [20.0, 1147.8, 1.503],
	[24.0, 1180.2, 1.686], [26.0, 1197.2, 1.8]
]
export const SALT_MAX = 26.0

/** A number as a short text: 10, 12.5 (no trailing zeros), as Python's `str(int(r))` or `f"{r:g}"` writes it for these small numbers. */
export function _num_text(v) {
	const r = pyRound(v, 2)
	return r === Math.trunc(r) ? String(Math.trunc(r)) : String(r)
}

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

/** {words, density, viscosity} of an item's liquid choice (its salt for salt water). */
export function liquid_of(P) {
	const name = P.liquid
	if (name === "salt water") {
		const [d, v] = salt_water(P.salt_pct)
		return { words: `salt water (${_num_text(P.salt_pct)} % salt)`, density: d, viscosity: v }
	}
	const [d, v] = LIQUIDS[name]
	return { words: name, density: d, viscosity: v }
}

// Food colouring, as absorbance per centimetre of light path (red, green, blue): what shows through is exp(−a·path) (provisional strengths).
// White colouring scatters light instead: its fourth number, scattering per cm (machines/mod_flow.py DYES: the same).
export const DYES = {
	none: [0.0, 0.0, 0.0], red: [0.0, 0.5, 0.25], orange: [0.0, 0.18, 0.5], yellow: [0.0, 0.02, 0.5], green: [0.45, 0.02, 0.4], blue: [0.5, 0.08, 0.005], purple: [0.2, 0.5, 0.05],
	white: [0.0, 0.0, 0.0, 20.0], brown: [0.22, 0.38, 0.6]
}
export const DYE_NAMES = Object.keys(DYES)
// The named colours a mixture is told by (goal "mixes_to"): shares of brightness (r, g, b over their sum) through 5 cm of water.
export const COLOR_REF = { red: [0.7275, 0.0605, 0.212], orange: [0.6688, 0.2753, 0.0558], yellow: [0.5001, 0.4582, 0.0418], green: [0.0909, 0.7903, 0.1187], blue: [0.0468, 0.3872, 0.5659], purple: [0.2959, 0.0669, 0.6372] }
export const COLOR_NAMES = ["clear", "brown", ...Object.keys(COLOR_REF), "white"]

/** The name of a liquid's colour (each 0…1): what shows through it, or, for one that scatters back half the light or more (o, its tint_o
 *  reading: milk, white colouring), what it looks like: "white" when every channel is 0.7 or more. */
export function color_name(r, g, b, o = 0.0) {
	if (o >= 0.5 && Math.min(r, g, b) >= 0.7) return "white"
	if (o < 0.5 && Math.min(r, g, b) >= 0.85) return "clear"
	if (Math.max(r, g, b) < 0.4) return "brown"
	const s = r + g + b
	if (!(s > 0)) return "brown"
	let best = null
	let name = "clear"
	for (const [k, [cr, cg, cb]] of Object.entries(COLOR_REF)) {
		const dr = r / s - cr
		const dg = g / s - cg
		const db = b / s - cb
		const d = dr * dr + dg * dg + db * db
		if (best === null || d < best) {
			best = d
			name = k
		}
	}
	return name
}

function _liquid_props(def = "water") {
	return [
		new Prop("liquid", "Liquid", def, { kind: "choice", choices: LIQUID_NAMES, help: "What is in it (each at 20 °C): honey and syrup pour slowly, water, milk and alcohol fast" }),
		new Prop("salt_pct", "Salt", 10.0, 0.0, SALT_MAX, 0.5, "%", "Salt water only: grams of salt in 100 g of it"),
		new Prop("dye", "Food colouring", "none", { kind: "choice", choices: DYE_NAMES, help: "A few drops of food colouring: liquids of two colours mix (blue and yellow make green); white makes water look like milk" })
	]
}

function _looks() {
	for (const [key, kw] of [
		["flow chrome", { fill: "#d8dde2", shade: "#8f979e", roughness: 0.12, metalness: 1.0, clearcoat: 0.6 }],
		["flow tubing", { fill: "#e6f0f2", shade: "#a9bcc0", roughness: 0.25, metalness: 0.0, clearcoat: 0.8, transmission: 0.6, ior: 1.45, thickness: 0.004 }],
		["flow paddle", { fill: "#e2b04a", shade: "#a87e28", roughness: 0.4, metalness: 0.0, clearcoat: 0.4 }]
	])
		if (!hasOwn(LOOKS, key)) add_look(key, kw)
}

const _r5 = (pts) => pts.map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)])

/** A solid welded to another solid of this item: `at` (and `angle`, rad) in the parent's own frame. */
function _child(c, part, parent, body, at, material, look, words, angle = 0.0, extra = {}) {
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look, body, material,
		at: { x: pyRound(at[0], 5), y: pyRound(at[1], 5) }, parent, placeholder: { fill: LOOK_FILL[look] },
		render: { kind: "procedural", shade: LOOK_SHADE[look] }, depth: 2
	}
	if (Math.abs(angle) > 1e-12) s.angle = pyRound(angle, 6)
	Object.assign(s, extra)
	c.sb.solids.push(s)
	return s.id
}

const _slab = (w, h, d) => ({ kind: "slab", width: pyRound(w, 5), height: pyRound(h, 5), depth: pyRound(d, 5) })

/** A box as the inside's four corners (bottom-left, bottom-right, top-right, top-left), each {x, y}. */
const _box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ x: pyRound(x, 5), y: pyRound(y, 5) }))

function _pour_readouts() {
	return [
		new Readout("left_ml", "Left in it", { unit: "mL", digits: 1 }), new Readout("poured_ml", "Poured out", { unit: "mL", digits: 1 }),
		new Readout("flow_ml_s", "Pouring", { unit: "mL/s", digits: 1, help: "How fast it pours now" }), new Readout("tilt_deg", "Tipped", { unit: "°", digits: 0 }),
		new Readout("lands_x", "Stream lands at", { unit: "m", digits: 3, help: "Where along the table its stream comes down (x)" }),
		new Readout("left_g", "Grains left in it", { unit: "g", digits: 0, help: "A cup of grains (sugar, salt, rice, sand): what is still in it" }),
		new Readout("poured_g", "Grains poured", { unit: "g", digits: 0, help: "A cup of grains: what has poured out over its lip" }),
		new Readout("heap_mm", "Heap height", { unit: "mm", digits: 0, help: "A cup of grains: the heap its grains make where they land (in a jar or glass, over its floor)" }),
		new Readout("heap_deg", "Heap slope", { unit: "°", digits: 1, help: "A cup of grains: the heap's sides (in a jar or glass it fills, from its top down to the wall)" }),
		new Readout("outside_g", "Grains outside", { unit: "g", digits: 0, help: "A cup of grains: what landed outside the jar, glass or box it pours into" })
	]
}

// the grains a pitcher, jug or cup can hold (machines/mod_granular.py GRAINS: the granular module pours them; its names)
export const POUR_GRAINS = ["sugar", "salt", "rice", "sand", "fine sand", "coarse sand", "gravel", "soil", "flour"]

// ---------------------------------------------------------------- pitchers, jugs and cups that a hand tips to pour
// inner width (round: its diameter), inner height, wall, spout width, material, look, default mL, words, handle
export const VESSELS = {
	pitcher: [0.1, 0.17, 0.003, 0.035, "glass", "glass", 750.0, "a glass pitcher", true],
	jug: [0.13, 0.22, 0.0025, 0.04, "polypropylene", "plastic", 1500.0, "a plastic jug", true],
	"measuring cup": [0.095, 0.12, 0.0025, 0.025, "polypropylene", "plastic", 400.0, "a plastic measuring cup", true],
	cup: [0.07, 0.095, 0.002, 0.03, "PET", "plastic", 200.0, "a plastic cup", false]
}

function _pourers() {
	function build_pitcher(c, P) {
		const [w, h, t, lip, mat, look, ml0, words, handle] = VESSELS[P.vessel]
		const given = c.item.props ?? {}
		if (!hasOwn(given, "fill_ml")) P.fill_ml = ml0
		const D = (Math.PI / 4) * w
		const cap = w * h * D * 1e6
		const fill = pymin(P.fill_ml, 0.97 * cap)
		const grains = P.contents === "grains"
		const side = P.pour_to === "right" ? 1.0 : -1.0
		const m = c.mat({ base: mat, overrides: {} })
		// the root is the pour lip at the item's anchor (the hand turns the whole pitcher about it); the rest welded to it
		const root = c.slab("lip", 0.01, t, lip, 0.0, 0.0, { kind: "static", material: m, look, words: `${words}'s spout` })
		_child(c, "floor", root, _slab(w + 2 * t, t, w + 2 * t), [-side * w / 2, -h - t / 2], m, look, `${words}'s bottom`)
		_child(c, "wall-spout", root, _slab(t, h, w + 2 * t), [side * t / 2, -h / 2], m, look, `${words}'s wall`)
		_child(c, "wall-back", root, _slab(t, h, w + 2 * t), [-side * (w + t / 2), -h / 2], m, look, `${words}'s wall`)
		if (handle) _child(c, "handle", root, _slab(0.012, 0.6 * h, 0.014), [-side * (w + t + 0.03), -0.45 * h], m, look, `${words}'s handle`)
		const inside = side > 0 ? _box(-w, -h, 0.0, 0.0) : _box(0.0, -h, w, 0.0)
		// (more than fits: filled to the brim, and the record keeps what was asked, so the run says "only 355 mL fits in it")
		let asked = P.fill_ml > 0.97 * cap + 1e-9 ? { asked: pyRound(P.fill_ml, 1) } : {}
		// (a cup of grains: this module tips it and pours no liquid; web/sim/modules/granular.js's build hook pours its grains: `grains` m³ packed)
		let extra = {}
		if (grains) {
			extra = { contents: "grains", grain: P.grain, grains: pyRound(fill / 1e6, 9) }
			if (Object.keys(asked).length) extra.grains_asked = asked.asked
			asked = {}
		}
		c.process("flow-pour", "pour", {
			solid: root, inside, depth: pyRound(D, 6), lip, wall: t, liquid: liquid_of(P), dye: [...DYES[P.dye]],
			volume: grains ? 0.0 : pyRound(fill / 1e6, 9), tilt: pyRound(-side * P.tilt * D2R, 6), at: P.pour_at, turn: P.tip_s,
			back: P.back_at > 0 ? P.back_at : null, ...asked, ...extra
		})
		P.capacity_ml = pyRound(cap, 1)
		P.inner_width = w
		P.inner_height = h
	}

	register(new ItemType("pitcher", "Pitcher", CATEGORY, build_pitcher, {
		dynamic: false, material: "glass", materials: ["glass"],
		props: [
			new Prop("vessel", "Kind", "pitcher", { kind: "choice", choices: Object.keys(VESSELS),
				help: "pitcher: a 1.3 L glass pitcher; jug: a 2.9 L plastic jug; measuring cup: 0.85 L; cup: a 0.37 L plastic cup" }),
			new Prop("contents", "Holds", "liquid", {
				kind: "choice", choices: ["liquid", "grains"],
				help: "liquid (its Liquid below) or grains (its Grains: sugar, salt, rice, sand...), which pour out once it is tipped past " + "their angle of repose and heap up where they land"
			}),
			new Prop("grain", "Grains", "sugar", {
				kind: "choice", choices: POUR_GRAINS,
				help: "What grains it holds when it holds grains: sugar 0.5 mm, salt 0.4 mm, rice (long grains), sand, fine sand, coarse sand, " + "gravel, soil, flour"
			}),
			new Prop("fill_ml", "Amount in it", 750.0, 0.0, 2900.0, 5.0, "mL", "How much it holds at the start, liquid or grains (200 mL of " + "sugar is about 160 g; follows the kind until you set it)", { auto: ["vessel"] }),
			..._liquid_props(),
			new Prop("pour_to", "Pours to the", "right", { kind: "choice", choices: ["right", "left"], help: "The side its spout faces and it tips toward" }),
			new Prop("pour_at", "Starts tipping at", 1.0, 0.0, 20.0, 0.1, "s"),
			new Prop("tilt", "Tips to", 110.0, 10.0, 170.0, 1.0, "°", "How far the hand tips it from upright (about 90° or more empties it)"),
			new Prop("tip_s", "Tipping takes", 1.5, 0.1, 10.0, 0.1, "s"),
			new Prop("back_at", "Tips back at", 0.0, 0.0, 30.0, 0.1, "s", "When the hand stands it up again (0: never)")
		],
		links: [], readouts: _pour_readouts(),
		tags: ["pitcher", "jug", "pour", "pouring", "cup", "glass", "water", "milk", "fill", "measuring cup", "honey", "syrup", "kettle", "cup of water", "glass of water", "cup of oil", "cup of milk", "cup of juice", "pour water", "pour oil", "pour milk", "pour juice", "pour honey", "pour syrup", "vegetable oil", "coloured water", "colored water", "paint water", "food colouring", "food coloring", "water runs down", "spill",
			"chocolate milk", "cup of sugar", "pour sugar", "cup of rice", "pour rice", "pour salt", "pour sand", "cup of sand"],
		description: "A pitcher, jug or cup of liquid that a hand tips to pour, from the moment you set and as far as you set. Its item position is " +
			"its pour lip, where the stream starts: put the lip above the container to fill (a few cm to its side the stream lands a " +
			"little further). The level inside stays flat as it tips; it pours over the lip like water over a weir, so honey pours far " +
			"slower than water. Set it to hold grains (sugar, salt, rice, sand) and they stay put until it is tipped past their angle " +
			"of repose, then slide out over the lip and heap up where they land.",
		source: "Pouring over a lip: a sharp-crested weir, q = 0.62·⅔·√(2g)·H^1.5 per metre of lip, and a viscous film's g·H³/(3ν) for thick " +
			"liquids (Henderson 1966; Nusselt 1916). A glass pitcher 10 cm across, 17 cm deep inside; spout widths approximate.",
		anchor: "its pour lip (the spout's top edge): the stream starts there", facts: "1.3 L glass pitcher, 750 mL of water, tips at 1 s",
		module: MODULE
	}))
}

// ---------------------------------------------------------------- a tap
export const NOZZLES = { aerator: 0.022, plain: 0.012 }

function _tap() {
	function build_tap(c, P) {
		const reach = 0.16
		const m = c.mat({ base: "steel", overrides: {} })
		const kw = { kind: "static", material: m, look: "flow chrome" }
		c.slab("outlet", 0.026, 0.03, 0.026, 0.0, 0.017, { words: "the tap's outlet", ...kw })
		c.slab("spout", reach, 0.022, 0.024, -reach / 2, 0.043, { words: "the tap's spout", ...kw })
		c.slab("plate", 0.012, 0.07, 0.07, -reach - 0.006, 0.043, { words: "the tap's wall plate", ...kw })
		c.slab("handle", 0.05, 0.012, 0.016, -reach + 0.03, 0.068, { words: "the tap's lever", ...kw })
		c.process("flow-tap", "flow", {
			at: { x: pyRound(c.ox, 5), y: pyRound(c.oy, 5) }, angle: pyRound(c.a - Math.PI / 2, 6), d: NOZZLES[P.nozzle],
			q: pyRound(P.flow_ml_s / 1e6, 9), on: P.on_at, off: P.off_at > 0 ? P.off_at : null, liquid: liquid_of(P),
			dye: [...DYES[P.dye]]
		})
	}

	register(new ItemType("tap", "Tap", CATEGORY, build_tap, {
		dynamic: false, material: "steel", materials: ["steel"],
		props: [
			new Prop("flow_ml_s", "Flow", 100.0, 5.0, 250.0, 5.0, "mL/s", "A kitchen tap full on is about 140 mL/s; a trickle 10-20 mL/s"),
			new Prop("on_at", "Turns on at", 0.5, 0.0, 20.0, 0.1, "s"),
			new Prop("off_at", "Turns off at", 0.0, 0.0, 30.0, 0.1, "s", "0: it stays on"),
			new Prop("nozzle", "Nozzle", "aerator", { kind: "choice", choices: Object.keys(NOZZLES), help: "aerator 22 mm (a soft round stream); plain 12 mm (faster, thinner)" }),
			..._liquid_props()
		],
		readouts: [new Readout("flowed_ml", "Run so far", { unit: "mL", digits: 0 }), new Readout("flow_ml_s", "Flow", { unit: "mL/s", digits: 0 }),
			new Readout("lands_x", "Stream lands at", { unit: "m", digits: 3, help: "Where along the table its stream comes down (x)" })],
		tags: ["tap", "faucet", "sink", "water", "stream", "running water", "fill", "spigot", "kitchen", "turn on the tap", "tap water", "faucet water", "water runs", "fills the sink", "overflow"],
		description: "A chrome wall tap whose water falls straight down from its outlet, at the flow you set, between the times you set. Its " +
			"item position is the outlet's mouth: put it above a cup, a bucket or a waterwheel.",
		source: "A kitchen faucet flows at most 139 mL/s (2.2 gal/min) [EPA-WS]. The stream leaves at the flow over the nozzle's area and speeds up as it falls.",
		anchor: "the mouth of its outlet, where the water leaves", facts: "100 mL/s from 0.5 s, aerator nozzle", module: MODULE
	}))
}

// ---------------------------------------------------------------- a bottle with holes in its side
export const BOTTLE_W = 0.102
export const BOTTLE_H = 0.23
export const BOTTLE_T = 0.002

function _bottle() {
	function build_bottle(c, P) {
		c.ca = 1.0
		c.sa = 0.0
		c.a = 0.0
		const [w, H, t] = [BOTTLE_W, BOTTLE_H, BOTTLE_T]
		const stand = P.stand_cm / 100
		const pet = c.mat({ base: "PET", overrides: {} })
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		if (stand > 0) c.slab("stand", 0.14, stand, 0.14, 0.0, stand / 2, { kind: "static", material: wood, look: "wood", words: "a wooden block the bottle stands on" })
		const floor = c.slab("floor", w + 2 * t, t, w + 2 * t, 0.0, stand + t / 2, { kind: "static", material: pet, look: "glass", words: "the bottle's bottom" })
		c.slab("wall-left", t, H, w + 2 * t, -w / 2 - t / 2, stand + t + H / 2, { kind: "static", material: pet, look: "glass", words: "the bottle's side" })
		c.slab("wall-right", t, H, w + 2 * t, w / 2 + t / 2, stand + t + H / 2, { kind: "static", material: pet, look: "glass", words: "the bottle's side" })
		const top = stand + t + H
		c.poly("shoulder-left", _r5([[-w / 2 - t, top], [-w / 2, top], [-0.0105, top + 0.06], [-0.0125, top + 0.06]]), w + 2 * t, 0.0, 0.0, {
			kind: "static", material: pet, look: "glass", words: "the bottle's shoulder"
		})
		c.poly("shoulder-right", _r5([[w / 2, top], [w / 2 + t, top], [0.0125, top + 0.06], [0.0105, top + 0.06]]), w + 2 * t, 0.0, 0.0, {
			kind: "static", material: pet, look: "glass", words: "the bottle's shoulder"
		})
		if (truthy(P.cap))
			c.slab("cap", 0.03, 0.014, 0.03, 0.0, top + 0.067, { kind: "static", material: c.mat({ base: "ABS plastic", overrides: {} }), look: "plastic", words: "the bottle's cap", color: "#d23a2c" })
		const side = P.facing === "right" ? 1.0 : -1.0
		const holes = []
		let dropped = 0
		for (let k = 0; k < Math.trunc(P.holes); k++) {
			const hy = P.lowest_cm / 100 + (k * P.spacing_cm) / 100
			if (hy > H - 0.005) {
				dropped = Math.trunc(P.holes) - k // (above its 23 cm body: the run says how many it could not have)
				break
			}
			holes.push({ x: pyRound((side * w) / 2, 5), y: pyRound(t / 2 + hy, 5), angle: side > 0 ? 0.0 : pyRound(Math.PI, 6), d: pyRound(P.hole_mm / 1000, 5) })
		}
		const fill = pymin(P.fill_cm / 100, H - 0.002)
		const D = (Math.PI / 4) * w
		const layers = fill > 0 ? [{ liquid: liquid_of(P), dye: [...DYES[P.dye]], volume: pyRound(fill * w * D, 9) }] : []
		c.process("flow-vessel", "vessel", {
			solid: floor, inside: _box(-w / 2, t / 2, w / 2, t / 2 + H), depth: pyRound(D, 6), wall: t, lip: 0.02,
			layers, holes, cap: truthy(P.cap), full: truthy(P.kept_full), open: P.open_at, ground: pyRound(c.oy, 5),
			...(dropped ? { dropped } : {})
		})
		P.hole_heights_cm = holes.map((h) => _num_text(pyRound((h.y - t / 2) * 100, 2))).join(", ")
	}

	register(new ItemType("leaky-bottle", "Bottle with holes", CATEGORY, build_bottle, {
		dynamic: false, material: "PET", materials: ["PET"],
		props: [
			new Prop("holes", "Holes", 3, 1, 4, 1, "", "Holes in a line up its side", { kind: "int" }),
			new Prop("lowest_cm", "Lowest hole", 3.0, 1.0, 20.0, 0.5, "cm", "Height of the lowest hole over the bottle's inside bottom"),
			new Prop("spacing_cm", "Between holes", 5.0, 1.0, 10.0, 0.5, "cm"),
			new Prop("hole_mm", "Hole size", 4.0, 1.5, 8.0, 0.5, "mm", "A nail hole is 2-4 mm"),
			new Prop("facing", "Holes face", "right", { kind: "choice", choices: ["right", "left"] }),
			new Prop("fill_cm", "Water depth", 20.0, 0.0, 22.5, 0.5, "cm", "How deep the liquid stands at the start"),
			new Prop("kept_full", "Kept full", false, { kind: "bool", help: "A hose keeps it topped up: the jets stay as strong (the classic pressure demo)" }),
			new Prop("cap", "Cap on", false, { kind: "bool", help: "With the cap on, no air gets in, so nothing comes out" }),
			new Prop("open_at", "Holes open at", 0.5, 0.0, 20.0, 0.1, "s", "When the tape over the holes comes off"),
			new Prop("stand_cm", "Stands on a block", 15.0, 0.0, 40.0, 1.0, "cm", "How high the block it stands on is (0: on the table)"),
			..._liquid_props()
		],
		readouts: [
			new Readout("left_ml", "Left in it", { unit: "mL", digits: 0 }), new Readout("level_mm", "Water depth", { unit: "mm", digits: 1 }),
			new Readout("flow_ml_s", "Flowing out", { unit: "mL/s", digits: 1 }), new Readout("poured_ml", "Run out", { unit: "mL", digits: 0 }),
			new Readout("jet1_ms", "Jet speed, hole 1 (lowest)", { unit: "m/s", digits: 2 }), new Readout("jet2_ms", "Jet speed, hole 2", { unit: "m/s", digits: 2 }),
			new Readout("jet3_ms", "Jet speed, hole 3", { unit: "m/s", digits: 2 }), new Readout("jet4_ms", "Jet speed, hole 4", { unit: "m/s", digits: 2 }),
			new Readout("reach1_m", "Reach, hole 1", { unit: "m", digits: 3, help: "How far out from the hole its jet lands, at the level the bottle stands on" }),
			new Readout("reach2_m", "Reach, hole 2", { unit: "m", digits: 3 }), new Readout("reach3_m", "Reach, hole 3", { unit: "m", digits: 3 }), new Readout("reach4_m", "Reach, hole 4", { unit: "m", digits: 3 })
		],
		tags: ["bottle", "holes", "leaky bottle", "pressure", "water pressure", "depth", "jets", "squirt", "spurt", "Torricelli", "soda bottle"],
		description: "A 2 L soda bottle of water with holes up one side, standing on a block. When the tape comes off, water spurts from every hole " +
			"below the surface; the lower the hole, the deeper it is and the harder the water is pushed out, so the lowest jet is fastest " +
			"and lands farthest. As the level falls the jets weaken (unless it is kept full).",
		source: "Jet speed C_v·√(2gΔh), flow C_d·a·√(2gΔh) with C_d 0.61, C_v 0.97 for a sharp-edged hole [WHITE]; thick liquids add Sampson's " +
			"viscous drop (1891). A 2 L bottle is 10.2 cm inside [PET].",
		anchor: "the middle of the bottom of the block it stands on (on the table)", facts: "2 L bottle, 3 holes 4 mm at 3, 8, 13 cm, water 20 cm",
		module: MODULE
	}))
}

// ---------------------------------------------------------------- a hose (a siphon)
export const CONTAINERS = ["water-tank", "graduated-cylinder", "beaker", "measuring-jug", "density-column", "pitcher", "leaky-bottle", "cup", "plastic-cup",
	"glass-jar", "coffee-mug", "bucket", "box", "bowl"]

function _hose() {
	function build_hose(c, P) {
		const tube = c.mat({ base: "PET", overrides: {} })
		c.slab("end", 0.03, 0.012, 0.012, 0.0, 0.0, { kind: "static", material: tube, look: "flow tubing", words: "the hose's free end", ghost: true })
		const src = c.link("from")
		if (src === null) return
		const dst = c.link("to")
		c.process("flow-hose", "flow", {
			from: src, to: dst, out: { x: pyRound(c.ox, 5), y: pyRound(c.oy, 5) }, d: pyRound(P.diameter_mm / 1000, 5),
			length: P.length_m > 0 ? P.length_m : null, inlet: pyRound(P.inlet_cm / 100, 5), open: P.open_at
		})
	}

	register(new ItemType("hose", "Hose (siphon)", CATEGORY, build_hose, {
		dynamic: false, material: "PET", materials: ["PET"],
		props: [
			new Prop("diameter_mm", "Inside width", 10.0, 3.0, 25.0, 0.5, "mm", "Aquarium tubing is 4-6 mm; a garden hose 13-19 mm"),
			new Prop("length_m", "Length", 0.0, 0.0, 5.0, 0.05, "m", "0: as long as the path it is laid along"),
			new Prop("inlet_cm", "Inlet height", 1.5, 0.5, 30.0, 0.5, "cm", "How high its end sits over the source container's bottom"),
			new Prop("open_at", "Starts at", 0.5, 0.0, 20.0, 0.1, "s", "When the siphon is started (its clip opened)")
		],
		links: [
			new Link("from", "From", { types: CONTAINERS, help: "The container it draws from (its end sits inside, near the bottom)" }),
			new Link("to", "To", { types: CONTAINERS, help: "The container its other end goes into (none: water leaves its free end, at this item's position)" })
		],
		readouts: [new Readout("moved_ml", "Moved", { unit: "mL", digits: 0 }), new Readout("flow_ml_s", "Flow", { unit: "mL/s", digits: 1 }),
			new Readout("lands_x", "Stream lands at", { unit: "m", digits: 3, help: "Where water from its free end comes down (x)" })],
		tags: ["hose", "siphon", "tube", "pipe", "drain", "transfer", "aquarium", "garden hose"],
		description: "A filled hose from one container over its rim to another (a siphon): liquid flows while the source's surface stands above " +
			"the other end (above the other container's surface, or its free end), faster the bigger the height difference and the " +
			"wider the hose, and stops when the two surfaces are level. Link `from` (and `to`); without `to` it pours out of its free " +
			"end at the item's position.",
		source: "Bernoulli with the hose's losses: g·Δh = ½v²(1 + 0.5 + f·L/d), f = 64/Re (laminar) or 0.3164·Re^−¼ (Blasius) [WHITE].",
		anchor: "its free end (where the water comes out when it goes into no container)", facts: "10 mm hose, starts at 0.5 s",
		module: MODULE
	}))
}

// ---------------------------------------------------------------- a waterwheel
function _wheel() {
	function build_wheel(c, P) {
		const R = P.diameter / 2
		const r = 0.02
		const n = Math.trunc(P.paddles)
		const D = P.paddle_depth
		const plastic = c.mat({ base: "ABS plastic", overrides: {} })
		const extra = P.axle_friction > 0 ? { damping: P.axle_friction } : {}
		// (the type is a fixed machine, so the catalog-wide start speed and spin are not its props; its hub and paddles turn, unless it is fixed)
		const kind = truthy(c.item.fixed) ? "static" : "dynamic"
		const hub = c.ball("hub", r, 0.0, 0.0, {
			material: plastic, kind, look: "plastic", words: "the waterwheel's hub", inertia: 0.5, shape: "cylinder",
			length: pyRound(D, 5), pivot: { x: 0.0, y: 0.0 }, ...extra
		})
		const L = R - r + 0.002
		for (let k = 0; k < n; k++) {
			const a = (2 * Math.PI * k) / n
			const mid = r - 0.002 + L / 2
			_child(c, `paddle-${k + 1}`, hub, _slab(L, 0.003, D), [mid * cos(a), mid * sin(a)], plastic, "flow paddle", "a waterwheel paddle", a, { kind })
		}
		c.slab("stand", 0.012, 0.012, 0.012, 0.0, 0.0, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "the axle's bracket", ghost: true })
		c.process("flow-wheel", "wheel", { solid: hub })
	}

	register(new ItemType("waterwheel", "Waterwheel", CATEGORY, build_wheel, {
		dynamic: false, material: "ABS plastic", materials: ["ABS plastic"],
		props: [
			new Prop("diameter", "Diameter", 0.24, 0.1, 0.6, 0.01, "m"),
			new Prop("paddles", "Paddles", 8, 4, 16, 1, "", { kind: "int" }),
			new Prop("paddle_depth", "Paddle width", 0.06, 0.02, 0.2, 0.005, "m", "Front to back"),
			new Prop("axle_friction", "Axle friction", 0.0005, 0.0, 0.05, 0.0005, "N·m·s", "How hard its axle drags (a load it lifts)")
		],
		readouts: [new Readout("rpm", "Turning", { unit: "rpm", digits: 0 }), new Readout("turns", "Turns", { unit: "", digits: 1 })],
		tags: ["waterwheel", "water wheel", "mill", "turbine", "paddle wheel", "energy", "work", "flow"],
		description: "A plastic waterwheel on a fixed axle at its item position (a bracket holds it). A stream falling on its paddles pushes them " +
			"round: put a tap, a pitcher's spout or a hose's end above one side of it. A faster, bigger stream turns it faster.",
		source: "A jet's push on a paddle is the momentum it brings, ρ·Q·(v − u) for a paddle moving at u (the particles' own momentum, given back).",
		anchor: "its axle (it turns about it)", facts: "24 cm, 8 paddles 6 cm wide", module: MODULE
	}))
}

// ---------------------------------------------------------------- catalog containers catch liquid (when the scene pours)
// type -> [floor part, left wall parts, right wall parts, round]
export const BASIN_PARTS = {
	cup: ["floor", ["left"], ["right"], true],
	"plastic-cup": ["floor", ["left"], ["right"], true],
	"glass-jar": ["floor", ["left"], ["right"], true],
	"coffee-mug": ["body", ["wall-left"], ["wall-right"], true],
	bucket: ["floor", ["left"], ["right"], true],
	box: ["floor", ["left"], ["right"], false],
	bowl: ["base", ["wall-left"], ["wall-right"], true]
}
export const SOURCES = ["pitcher", "tap", "leaky-bottle", "hose"]

function _basins(sb, scene) {
	const items = (scene.items ?? []).filter((i) => i !== null && typeof i === "object" && !Array.isArray(i))
	if (!items.some((i) => SOURCES.includes(i.type))) return
	const have = new Map(sb.solids.map((s) => [s.id, s]))
	for (const it of items) {
		const spec = hasOwn(BASIN_PARTS, it.type) ? BASIN_PARTS[it.type] : null
		if (spec === null) continue
		const iid = it.id
		const [floor, left, right, rnd] = spec
		const fid = `${iid}/${floor}`
		if (!have.has(fid)) continue
		const ls = left.map((p) => `${iid}/${p}`).filter((id) => have.has(id))
		const rs = right.map((p) => `${iid}/${p}`).filter((id) => have.has(id))
		if (!ls.length || !rs.length) continue
		const body = have.get(fid).body
		const depth = hasOwn(body, "depth") ? body.depth : 0.1
		sb.processes.push({ kind: "flow-basin", id: `${iid}/basin`, item: iid, floor: fid, left: ls, right: rs, round: rnd, depth: pyRound(depth, 5) })
	}
}

// ---------------------------------------------------------------- goals (machines/mod_flow.py reports the same, number for number)
const last = (ctx, iid, key) => {
	const v = ctx.state(iid, key)
	return v && v.length ? v[v.length - 1] : null
}
const first_key = (ctx, iid, keys) => keys.find((k) => ctx.state(iid, k) !== null) ?? null
const when_text = (by) => (by === null ? "" : ` by ${_num_text(by)} s`)
const label_of = (g, fallback) => (truthy(g.label) ? g.label : fallback)

function fills(ctx, g) {
	if (!ctx.known(g.container)) return null
	let want = ctx.num(g.at_least_ml)
	want = want === null ? 100.0 : want
	const by = ctx.num(g.before_s)
	const key = first_key(ctx, g.container, ["liquid_ml", "volume_ml", "left_ml"])
	const t = key === null ? null : ctx.first_time(g.container, key, (v) => v >= want - 1e-9)
	const v = key === null ? null : last(ctx, g.container, key)
	return {
		label: label_of(g, `${ctx.name(g.container)} fills to at least ${_num_text(want)} mL${when_text(by)}`),
		ok: t !== null && (by === null || t <= by), kind: "fills", container: g.container, ml: v === null ? null : pyRound(v, 1), t: t === null ? null : pyRound(t, 3)
	}
}

function empties(ctx, g) {
	if (!ctx.known(g.item)) return null
	const by = ctx.num(g.before_s)
	// (a pitcher of grains reads grams: its left_g)
	const lm = ctx.state(g.item, "left_ml")
	const key = lm && lm.length ? "left_ml" : "left_g"
	const v = ctx.state(g.item, key)
	let t = null
	if (v && v.length) {
		const lim = pymax(1.0, 0.01 * v[0])
		t = ctx.first_time(g.item, key, (x) => x <= lim)
	}
	return { label: label_of(g, `${ctx.name(g.item)} empties${when_text(by)}`), ok: t !== null && (by === null || t <= by), kind: "empties", item: g.item, t: t === null ? null : pyRound(t, 3) }
}

function half_time(ctx, iid) {
	const v = ctx.state(iid, "left_ml")
	if (!v || !v.length || !(v[0] > 0)) return null
	const half = 0.5 * v[0]
	return ctx.first_time(iid, "left_ml", (x) => x <= half)
}

function poured(ctx, iid) {
	const k = first_key(ctx, iid, ["poured_ml", "flowed_ml", "moved_ml"])
	return k === null ? null : last(ctx, iid, k)
}

function pours_faster(ctx, g) {
	const a = g.a
	const b = g.b
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	const ta = half_time(ctx, a)
	const tb = half_time(ctx, b)
	const pa = poured(ctx, a)
	const pb = poured(ctx, b)
	let ok
	if (ta !== null || tb !== null) ok = ta !== null && (tb === null || ta < tb)
	else ok = pa !== null && pb !== null && pa > pb + 1e-9
	return { label: label_of(g, `${ctx.name(a)} pours faster than ${ctx.name(b)}`), ok, kind: "pours_faster", a, b, a_ml: pa === null ? null : pyRound(pa, 1), b_ml: pb === null ? null : pyRound(pb, 1) }
}

/** a beats b by a clear difference: 1 cm (or 1 mL…) and 5 % of b, as the granular module's comparisons (a jet's landing spot wanders a few
 *  millimetres with the stream's break-up). */
function clearly(a, b) {
	const b0 = b === null ? 0.0 : b
	return a !== null && a > b0 + pymax(0.01, 0.05 * Math.abs(b0))
}

function reach_of(ctx, iid, hole) {
	const v = (ctx.state(iid, `reach${hole}_m`) ?? []).filter((x) => x !== null && x !== undefined)
	return v.length ? v.reduce((m, x) => (x > m ? x : m), v[0]) : null
}

function jet_farthest(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let hole = ctx.num(g.hole)
	hole = hole === null ? 1 : Math.trunc(hole)
	const reach = new Map()
	for (let k = 1; k < 5; k++) {
		const r = reach_of(ctx, iid, k)
		if (r !== null) reach.set(k, r)
	}
	const mine = reach.has(hole) ? reach.get(hole) : null
	const ok = mine !== null && mine > 0 && [...reach].every(([k, r]) => k === hole || clearly(mine, r))
	return { label: label_of(g, `the jet from hole ${hole} of ${ctx.name(iid)} lands farthest`), ok, kind: "jet_farthest", item: iid, hole, reach_m: mine === null ? null : pyRound(mine, 3) }
}

function reaches_farther(ctx, g) {
	const a = g.a
	const b = g.b
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	let hole = ctx.num(g.hole)
	hole = hole === null ? 1 : Math.trunc(hole)
	const ra = reach_of(ctx, a, hole)
	const rb = reach_of(ctx, b, hole)
	return {
		label: label_of(g, `the jet from ${ctx.name(a)} lands farther out than the one from ${ctx.name(b)}`),
		ok: ra !== null && ra > 0 && clearly(ra, rb), kind: "reaches_farther", a, b, hole,
		a_m: ra === null ? null : pyRound(ra, 3), b_m: rb === null ? null : pyRound(rb, 3)
	}
}

/** s a wheel must keep a speed up for it to count (a one-frame spike as it jams is no turning). */
const HOLD_S = 0.5

/** The fastest a wheel KEEPS turning for half a second (the lowest rpm over its best 0.5 s): a one-frame spike, a knock as it jams, never
 *  counts. null when it has no rpm reading. */
function held_rpm(ctx, iid) {
	const v = ctx.state(iid, "rpm")
	if (!v || !v.length) return null
	const ts = ctx.times
	const n = Math.min(v.length, ts.length)
	let best = 0.0
	let i0 = 0
	for (let k = 0; k < n; k++) {
		while (ts[k] - ts[i0] > HOLD_S + 1e-9) i0++
		if (ts[k] - ts[0] < HOLD_S - 1e-9) continue
		let m = null
		for (let i = i0; i <= k; i++) {
			const x = v[i] === null || v[i] === undefined ? 0.0 : v[i]
			m = m === null || x < m ? x : m
		}
		if (m !== null && m > best) best = m
	}
	return best
}

/** When a wheel first turns at want rpm or more and keeps it up for half a second (the start of that half second), or null. */
function held_from(ctx, iid, want) {
	const v = ctx.state(iid, "rpm")
	if (!v || !v.length) return null
	const ts = ctx.times
	const n = Math.min(v.length, ts.length)
	let start = null
	for (let k = 0; k < n; k++) {
		const x = v[k] === null || v[k] === undefined ? 0.0 : v[k]
		if (x >= want) {
			if (start === null) start = k
			if (ts[k] - ts[start] >= HOLD_S - 1e-9) return ts[start]
		} else start = null
	}
	return null
}

function turns(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let want = ctx.num(g.at_least_rpm)
	want = want === null ? 10.0 : want
	const by = ctx.num(g.before_s)
	const t = held_from(ctx, iid, want)
	const v = (ctx.state(iid, "rpm") ?? []).filter((x) => x !== null && x !== undefined)
	const h = held_rpm(ctx, iid)
	return {
		label: label_of(g, `${ctx.name(iid)} turns at ${_num_text(want)} rpm or more${when_text(by)}`), ok: t !== null && (by === null || t <= by),
		kind: "turns", item: iid, max_rpm: !v.length ? null : pyRound(v.reduce((m, x) => (x > m ? x : m), v[0]), 1), held_rpm: h === null ? null : pyRound(h, 1),
		t: t === null ? null : pyRound(t, 3)
	}
}

/** A wheel turns clearly faster: 2 rpm and 10 % more, held for half a second each. */
function clearly_rpm(a, b) {
	const b0 = b === null ? 0.0 : b
	return a > b0 + pymax(2.0, 0.1 * b0)
}

function turns_faster(ctx, g) {
	const a = g.a
	const b = g.b
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	const ha = held_rpm(ctx, a)
	const hb = held_rpm(ctx, b)
	return {
		label: label_of(g, `${ctx.name(a)} turns faster than ${ctx.name(b)}`), ok: ha !== null && ha > 0 && clearly_rpm(ha, hb),
		kind: "turns_faster", a, b, a_rpm: ha === null ? null : pyRound(ha, 1), b_rpm: hb === null ? null : pyRound(hb, 1)
	}
}

/** A container's reading of what it holds and the volume it held at the start: [key, list, start] or null. */
function gained(ctx, cid) {
	const key = first_key(ctx, cid, ["liquid_ml", "volume_ml", "left_ml"])
	if (key === null) return null
	const v = ctx.state(cid, key)
	const v0 = v.find((x) => x !== null && x !== undefined) ?? 0.0
	return [key, v, v0]
}

function fills_faster(ctx, g) {
	const a = g.a
	const b = g.b
	if (!ctx.known(a) || !ctx.known(b) || a === b) return null
	const A = gained(ctx, a)
	const B = gained(ctx, b)
	let want = ctx.num(g.ml)
	const ends = [A, B].filter((X) => X !== null).map((X) => {
		const xs = X[1].filter((x) => x !== null && x !== undefined)
		return (xs.length ? xs.reduce((m, x) => (x > m ? x : m), xs[0]) : 0.0) - X[2]
	})
	if (want === null) want = ends.length === 2 && pymin(...ends) > 1.0 ? 0.5 * pymin(...ends) : 50.0
	const ta = A === null ? null : ctx.first_time(a, A[0], (v) => v - A[2] >= want - 1e-9)
	const tb = B === null ? null : ctx.first_time(b, B[0], (v) => v - B[2] >= want - 1e-9)
	const ok = ta !== null && (tb === null || ta < tb - pymax(0.1, 0.05 * tb))
	return {
		label: label_of(g, `${ctx.name(a)} fills faster than ${ctx.name(b)}`), ok, kind: "fills_faster", a, b,
		ml: pyRound(want, 1), a_s: ta === null ? null : pyRound(ta, 3), b_s: tb === null ? null : pyRound(tb, 3)
	}
}

function overflows(ctx, g) {
	const cid = g.container
	if (!ctx.known(cid)) return null
	const by = ctx.num(g.before_s)
	const key = first_key(ctx, cid, ["overflow_ml", "spilled_ml"])
	const t = key === null ? null : ctx.first_time(cid, key, (v) => v > 0.5)
	const v = key === null ? null : last(ctx, cid, key)
	return {
		label: label_of(g, `${ctx.name(cid)} overflows${when_text(by)}`), ok: t !== null && (by === null || t <= by),
		kind: "overflows", container: cid, ml: v === null ? null : pyRound(v, 1), t: t === null ? null : pyRound(t, 3)
	}
}

function mixes_to(ctx, g) {
	const cid = g.container
	if (!ctx.known(cid)) return null
	const want = typeof g.color === "string" ? g.color : "green"
	const r = last(ctx, cid, "tint_r")
	const gg = last(ctx, cid, "tint_g")
	const b = last(ctx, cid, "tint_b")
	const o = last(ctx, cid, "tint_o")
	const got = r === null || gg === null || b === null ? null : color_name(r, gg, b, o === null ? 0.0 : o)
	return { label: label_of(g, `the liquid in ${ctx.name(cid)} ends ${want}`), ok: got === want, kind: "mixes_to", container: cid, color: got }
}

function delivers(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let want = ctx.num(g.at_least_ml)
	want = want === null ? 100.0 : want
	const v = poured(ctx, iid)
	return { label: label_of(g, `${ctx.name(iid)} delivers at least ${_num_text(want)} mL`), ok: v !== null && v >= want - 1e-9, kind: "delivers", item: iid, ml: v === null ? null : pyRound(v, 1) }
}

function _goals() {
	// (web/sim/modules/index.js registers the plugin's goal kinds with register_goal_kind; nothing more to do here)
}

// ---------------------------------------------------------------- the AI's view (web/sim/plugins.js)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const trimNum = (v, d) => {
	if (v === null || v === undefined || !Number.isFinite(v)) return "?"
	const t = v.toFixed(d)
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t
}
const startOf = (run, iid, key) => {
	const v = run?.track?.state?.[iid]?.[key]
	return Array.isArray(v) && v.length ? v[0] : null
}
const endOf = (run, iid, key) => {
	const v = run?.track?.state?.[iid]?.[key]
	return Array.isArray(v) && v.length ? v[v.length - 1] : null
}
const maxOf = (run, iid, key) => {
	const v = run?.track?.state?.[iid]?.[key]
	return Array.isArray(v) && v.length ? v.reduce((m, x) => (x > m ? x : m), v[0]) : null
}
const firstWhen = (run, iid, key, test) => {
	const v = run?.track?.state?.[iid]?.[key]
	const f = run?.track?.frames
	if (!Array.isArray(v) || !Array.isArray(f)) return null
	for (let k = 0; k < Math.min(v.length, f.length); k++) if (test(v[k])) return f[k].t
	return null
}
const nu = (name) => (LIQUIDS[name] && LIQUIDS[name][0] ? LIQUIDS[name][1] / LIQUIDS[name][0] : 1e-6)
const colorOfRun = (run, iid) => {
	const r = endOf(run, iid, "tint_r")
	const g = endOf(run, iid, "tint_g")
	const b = endOf(run, iid, "tint_b")
	return r === null || g === null || b === null ? null : color_name(r, g, b)
}
const CATCHERS = [...Object.keys(BASIN_PARTS), "water-tank", "graduated-cylinder", "beaker", "measuring-jug", "density-column"]
/** Every container's opening at the start: [{item, x0, x1, rim}] (a fluids container's walls; this module's from its inside and its frame's place). */
function openings(run) {
	const out = []
	const doc = run?.doc
	const K = run?.track?.keyframes ?? {}
	const f0 = run?.track?.frames?.[0]?.placements ?? {}
	for (const r of doc?.processes ?? []) {
		if (r.kind === "liquid") out.push({ item: r.item, x0: r.x0, x1: r.x1, rim: r.rim })
		else if (["flow-pour", "flow-vessel", "flow-basin"].includes(r.kind)) {
			const i = K[r.item]?.i?.[0]
			const frame = r.kind === "flow-basin" ? r.floor : r.solid
			const pl = f0[frame] ?? doc.solids.find((s) => s.id === frame)?.at
			if (!i || !pl) continue
			const c = Math.cos(pl.angle ?? 0)
			const sn = Math.sin(pl.angle ?? 0)
			const w = (x, y) => [pl.x + x * c - y * sn, pl.y + x * sn + y * c]
			const a = w(i[5], i[6])
			const b = w(i[7], i[8])
			out.push({ item: r.item, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), rim: Math.max(a[1], b[1]) })
		}
	}
	return out
}
/** Where a source's stream came down, against the containers' openings: a line for the digest, or null. */
function landingLine(run, item, nameOf = (id) => id) {
	const lx = endOf(run, item.id, "lands_x")
	if (lx === null) return null
	const ops = openings(run).filter((o) => o.item !== item.id)
	const hit = ops.find((o) => lx >= o.x0 && lx <= o.x1)
	if (hit) return `its stream comes down at x ${trimNum(lx, 3)} m: INTO ${nameOf(hit.item)} (opening x ${trimNum(hit.x0, 3)}…${trimNum(hit.x1, 3)})`
	if (!ops.length) return `its stream comes down at x ${trimNum(lx, 3)} m`
	const near = ops.reduce((b, o) => (Math.min(Math.abs(lx - o.x0), Math.abs(lx - o.x1)) < Math.min(Math.abs(lx - b.x0), Math.abs(lx - b.x1)) ? o : b))
	const miss = lx < near.x0 ? near.x0 - lx : lx - near.x1
	return `its stream comes down at x ${trimNum(lx, 3)} m: it MISSES ${nameOf(near.item)} (opening x ${trimNum(near.x0, 3)}…${trimNum(near.x1, 3)}) by ${trimNum(miss * 100, 1)} cm to the ${lx < near.x0 ? "left" : "right"}: move the ${item.type === "tap" ? "tap" : item.type === "hose" ? "hose's end" : "pitcher"} ${trimNum(miss * 100 + 2, 0)} cm ${lx < near.x0 ? "right" : "left"}`
}
const pickOf = (scene, types) => (scene.items ?? []).filter((i) => types.includes(i.type))
/**
 * The make-it-work search's tries for a container that does not fill (or overflow): the pitcher, tap or hose end whose stream comes down
 * nearest the container's opening, moved by its miss so it lands in the middle (a pitcher left where it was when the person moved the bowl
 * it pours into). Only moves the search may make (never what the person placed: web/ai/fixer.js checks). -> [{changes, cost}]
 */
function aimPour(cid, scene, run) {
	if (!run?.track || typeof cid !== "string") return []
	const op = openings(run).find((o) => o.item === cid)
	if (!op) return []
	const mid = (op.x0 + op.x1) / 2
	let best = null
	for (const it of scene.items ?? []) {
		if (!["pitcher", "tap", "hose"].includes(it.type) || it.id === cid) continue
		const lx = endOf(run, it.id, "lands_x")
		if (lx === null || (lx >= op.x0 + 0.01 && lx <= op.x1 - 0.01)) continue
		const miss = lx < op.x0 ? op.x0 - lx : lx - op.x1
		if (!best || miss < best.miss) best = { it, lx, miss }
	}
	if (!best || best.miss > 1.5) return []
	const dx = pyRound(mid - best.lx, 3)
	return Math.abs(dx) >= 0.005 ? [{ changes: [{ kind: "move", ids: [best.it.id], dx, dy: 0 }], cost: 0.3 + Math.abs(dx) * 10 }] : []
}
/** Whether a fixed surface lies under x at height y (within 1.2 cm): what a jet lands on (a table, a block), from the run's document. */
function surfaceUnder(run, x, y) {
	const f0 = run?.track?.frames?.[0]?.placements ?? {}
	for (const s of run?.doc?.solids ?? []) {
		if (s.kind !== "static" || s.ghost === true || s.body?.kind !== "slab") continue
		const p = f0[s.id] ?? { x: s.at?.x, y: s.at?.y, angle: s.angle ?? 0 }
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.angle ?? 0) > 0.02) continue
		const top = p.y + s.body.height / 2
		if (Math.abs(top - y) <= 0.012 && x >= p.x - s.body.width / 2 && x <= p.x + s.body.width / 2) return true
	}
	return false
}
/** The run's events about an item, of a kind ("jam", "inside", "brim", "holes", "capped", "siphon"). */
const eventsOf = (run, iid, kind) => (run?.track?.events ?? []).filter((e) => e?.kind === kind && Array.isArray(e.items) && e.items.includes(iid))

export const plugin = {
	// (the words a teacher uses: pour, tap, faucet, spill, overflow, siphon, puddle, jet, waterwheel; the digest's tiers pick this module's
	// full section by them: ai/catalog-digest.mjs promptCatalog)
	title: "Pouring, flowing and spilling liquids: taps, faucets, overflows, spills, siphons, puddles, jets and waterwheels",
	howto: [
		"Liquids that MOVE: pitcher (a pitcher/jug/measuring cup/cup of `fill_ml` of `liquid` that a hand tips: from `pour_at` s it turns over `tip_s` s to `tilt` degrees toward `pour_to`; `back_at` stands it up again; more than fits is filled to the brim and the run says so). Its item position IS ITS POUR LIP (the spout's top edge), held in the air: the stream starts there, leaves the lip sideways toward pour_to (about 0.4 m/s from a cup, 0.5 from a 500 mL pitcher, 0.8 from a 1.5 L jug) and falls, so it LANDS PAST THE LIP, the farther the fuller the vessel and the higher the lip (water, the middle of the pour; its strongest gush lands 1-5 cm farther still): a cup of 180 mL about 6 cm past it for a 10 cm drop, 7.5 cm for 20 cm, 9 cm for 30 cm; a pitcher of 500 mL 7.5 / 10 / 11.5 cm; a full pitcher (750 mL) 9 / 11 / 13 cm; a 1.5 L jug 11 / 14 / 16 cm; honey and syrup about 3 cm. The pitcher's BODY hangs below and behind the lip (pour_to right: to the LEFT of the lip): pitcher 17 cm tall × 10 cm wide (plus a 3 cm handle), jug 22 × 13, measuring cup 12 × 9.5, cup 9.5 × 7 (no handle). To fill a container put the lip that landing distance BEFORE the middle of its opening (pour_to right: lip x = opening middle − that distance, 7-9 cm for a cup or a 500 mL pitcher; pour_to left: + it) and HIGH ENOUGH THAT ITS BODY CLEARS THE RIM: where the body is over the opening (a bowl, a bucket, a box: wider than about 15 cm) the lip goes at least the body's height + 2 cm above the rim (pitcher 19, jug 24, measuring cup 14, cup 12 cm); over a narrow mug, jar or beaker the body hangs beside it and 8-15 cm above the rim is enough, and lower is more forgiving: the pour spreads as it falls, so from higher up its strongest part can go over the far rim of an opening 10 cm wide (place {on: \"air\", x, y_m}; the solver raises a pitcher that would start inside something). Its lands_x reading says where the stream came down. Water empties a pitcher tipped 110° in about 1-3 s. Honey (10 Pa·s) and corn syrup (2.5 Pa·s) pour 2-3× slower than water when tipped 70-85° (they ooze over the lip as a thick film); tipped past about 100° an open cup of honey falls out nearly as fast as the hand turns it, so to COMPARE liquids tip both the same moderate amount (tilt 75-80).",
		"tap (a faucet): a wall tap whose water falls STRAIGHT DOWN from its item position (the outlet's mouth, in the air: place {on: \"air\", x, y_m}) at `flow_ml_s` (kitchen tap 100-140, trickle 10-20) from `on_at` to `off_at` (0: stays on); the run says when it turns on and off. leaky-bottle: a 2 L bottle (10.2 cm inside, 23 cm body) standing on a wooden block `stand_cm` high (its item position is the block's bottom, on the table), with `holes` holes up the side it is `facing` from `lowest_cm` every `spacing_cm` (holes that would be above its 23 cm body are left off, and the run says so); they open at `open_at`; jets: the lowest is deepest, so fastest (v = 0.97·√(2g·depth)) and lands farthest; leave 40-60 cm clear on that side for the jets, ON the table (a jet that goes past the table's edge falls to the floor: its reach is still measured at the block's level); `kept_full` keeps them steady; `cap` on stops all flow (no air gets in). hose: a siphon: link `from` (and `to`) containers; a filled hose flows from the HIGHER surface to the lower whichever end is called from (named the other way round it runs from `to` to `from`, and says so) and stops when they are level; without `to` it pours from its free end (the hose's item position) while from's surface is above that end. waterwheel: a wheel on a fixed axle at its item position (in the air: place {on: \"air\", x, y_m}; a fixed machine: no start speed); a stream falling on the paddles on ONE side of the axle (x offset 0.3-0.45 × diameter from the axle) turns it; nothing else may be within its paddles' circle (a bucket's wall there jams it: the run says so).",
		"Catching: every cup, plastic-cup, glass-jar, coffee-mug, bucket, bowl and box catches liquid poured into it (inside: cup 7 cm wide × 10 cm deep, 0.32 L; plastic-cup 9 × 12.5 cm, 0.53 L; glass-jar 8 × 8.6 cm, 0.44 L; coffee-mug 7.3 × 8.7 cm, 0.37 L; bowl 14 × 6 cm, 0.56 L; box 24 × 13 cm, 3.7 L; bucket 27 × 27 cm, 12.5 L; readings liquid_ml, level_mm, overflow_ml (what went over its rim) and tint_r/g/b, its colour) once the scene has a pitcher, tap, leaky-bottle or hose; a fixed beaker, measuring-jug, graduated-cylinder or water-tank (fluids module) does too (its volume_ml rises; received_ml). What a container holds WEIGHS: a coffee-mug or bowl on a kitchen-scale reads the mug plus its water (about 1 g per mL: measure's goal reads {item: scale, grams}). Things FLOAT in it: a cork, a toy duck or a ball put inside a jar or bucket that a tap fills rises with the water and floats (fluids' goals floats / sinks {item}; readings submerged, afloat). Liquid that misses runs over the table: on a level surface it stops as a puddle (puddle_ml of that surface's item); on a slope steeper than about 6° (a plank as a ramp or slide, 10-30°) it RUNS DOWN and spills off the low end: put the low end over a container's opening, above its rim, to catch it. Food colouring (`dye`: red, orange, yellow, green, blue, purple) mixes in the container when poured into the SAME liquid: blue + yellow → green, red + blue → purple, red + yellow → orange. Liquids at 20 °C: water 998 kg/m³ 0.001 Pa·s, vegetable oil 920 / 0.06, dish soap 1050 / 0.5, corn syrup 1380 / 2.5, honey 1420 / 10; a different liquid poured into a container becomes its own layer and does not mix (oil floats on water, honey sinks): the container's colour is its biggest layer's.",
		"Readings: pitcher left_ml, poured_ml, flow_ml_s, tilt_deg; tap flowed_ml, flow_ml_s; leaky-bottle left_ml, level_mm, flow_ml_s, poured_ml, jet1_ms…jet4_ms (1 = lowest hole), reach1_m…reach4_m (where each jet lands, measured out from the hole at the level the bottle stands on); hose moved_ml, flow_ml_s; waterwheel rpm, turns. Events: '<tap> turns on (100 mL/s)', '<tap> turns off after 400 mL', '<pitcher> starts pouring', '<pitcher> is empty', \"<bottle>'s jets start\", \"<bottle>'s holes open, but its cap is on\", '<hose> starts siphoning', '<container> overflows', '<container> fills to N mL', \"<bottle>'s hole k stops spurting\", '<wheel> starts turning', '<hose> stops: the two surfaces are level'; at the start: 'only N mL fits in <pitcher>', '<pitcher> starts inside <thing>', '<thing> is in the way of <wheel>'s paddles'. FAIR TESTS (is this a valid experiment?): two set-ups side by side that differ in ONE thing only (the same containers, the same heights and distances), compared with a two-item goal: reaches_farther (two bottles' jets), turns_faster (two waterwheels), fills_faster (two containers), pours_faster (two pitchers or bottles).",
		"Milk (1030 kg/m³, 2.1 mPa·s) and chocolate milk (1065, 8 mPa·s) pour as water does and are opaque: milk white, chocolate milk brown (mixes_to colours \"white\", \"brown\"); `dye` white makes water look like milk, brown like cocoa. A pitcher, measuring cup or cup can hold GRAINS instead (contents \"grains\", `grain` sugar | salt | rice | sand | fine sand | coarse sand | gravel | soil | flour; fill_ml is then the grains' volume: 200 mL of sugar is 160 g, of salt 240 g, of rice 154 g): they do NOT pour until the tilt passes their angle of repose (a full cup about 35°, a half-full cup about 85°), then slide out over the lip and fall almost straight down (they land only 1-2 cm past the lip: put the lip over the opening, 1-2 cm before its middle) and heap up where they land; tip it to 130° or more to empty it (at 110-115° a little stays on its spout wall). A jar, glass, cup, mug, bowl, beaker, bucket or box under the stream keeps every grain inside it. Readings: left_g, poured_g, heap_mm, heap_deg (the heap's slope, its angle of repose), outside_g (grains that missed the container); goals piles {item: the pitcher} (its heap) and empties {item}. The same cup with liquid or grains is the lesson's \"liquids lie flat, grains pile up\" pair: change only `contents`."
	].join(" "),
	prompt: {
		plan: [
			"Flowing liquids: a pitcher's or a tap's item position is where its liquid leaves (the pitcher's pour lip, the tap's mouth): place it in the air ({on: \"air\", x, y_m}) above what it fills. A tap's water falls straight down: put its mouth straight above the opening's middle, 10-20 cm above the rim. A pitcher's water leaves the lip sideways and lands PAST the lip: from 10-20 cm up about 6-8 cm for a cup, 7.5-10 cm for a 500 mL pitcher, 9-11 cm for a full one, 11-14 cm for a 1.5 L jug (honey about 3 cm): with pour_to right put the lip that far LEFT of the opening's middle (pour_to left: to its right), and high enough that its body (pitcher 17 cm, jug 22, measuring cup 12, cup 9.5 cm below the lip, and as wide behind it) clears the rim: over a wide bowl, bucket or box the lip goes the body's height + 2 cm above the rim; beside a narrow mug, jar or beaker 8-15 cm is enough (lower is more forgiving: from higher the strongest part of the pour can go over the far rim). Two pitchers into one container: one pour_to right standing to its left, one pour_to left to its right, at different pour_at times. A leaky-bottle stands on the table (place {on: \"table\", x}); its jets go the way it is `facing` (keep 0.6 m of TABLE clear there). A hose links from (and to) containers by id; a waterwheel's axle goes in the air with the stream above one side of its paddles and nothing within its paddles' circle. Water down a ramp: a plank tilted 10-30° (angle_deg) under the pour (landing a quarter of the way down it, not at its very top end), its low end over the catching container's opening and above its rim.",
			"Make the run long enough: seconds ≥ pour_at + tip_s + 2 s for water (honey: 10 s or more); a tap filling a container: its capacity ÷ flow + 2 s. Goals: fills {container, at_least_ml, before_s?}, overflows {container, before_s?} (liquid goes over its rim), empties {item, before_s?}, pours_faster {a, b} (a empties/pours half its liquid sooner), fills_faster {a, b, ml?} (container a gains ml sooner than b, by a clear margin), jet_farthest {item, hole} (1 = lowest hole), reaches_farther {a, b, hole?} (bottle a's jet from that hole lands farther out than bottle b's, by at least 1 cm and 5 %), turns {item, at_least_rpm?, before_s?} (a waterwheel, held half a second), turns_faster {a, b} (wheel a keeps a clearly faster speed than wheel b), mixes_to {container, color}, delivers {item, at_least_ml} (a tap's, pitcher's, bottle's or hose's output). A fair test of one change: two set-ups the same in everything else, and the two-item goal that compares them."
		].join("\n"),
		edit: "Flowing liquids: a pitcher pours from `pour_at` over `tip_s` to `tilt` degrees (more tilt or more fill → more poured; tip it back with back_at); move a pitcher or tap by its x/y (its lip/mouth: when the container it fills moves, move the pitcher or tap with it, the same distance); a tap's `flow_ml_s`, on_at, off_at; a bottle's `fill_cm`, `hole_mm`, `stand_cm`, `kept_full`, `cap`; a hose's `diameter_mm` (flow grows faster than the diameter squared) and its from/to links; a waterwheel's `axle_friction`. Thick liquids (honey, corn syrup) pour and flow far slower than water.",
		refine: "Flowing liquids: a container that must fill needs the stream to land inside it (the pitcher's lip or tap's mouth above it: the digest says where each stream came down and by how much it missed) and enough run time; a pitcher must not start inside anything (its body hangs below and behind its lip); a waterwheel needs the stream on one side of its axle, not straight over it, and nothing in its paddles' circle; a siphon needs its source's surface above the other end; water down a ramp needs the ramp's low end over the container's opening."
	},
	examples: [
		{ ask: "Pour a pitcher of water into a beaker.", how: "a beaker {size 1000 mL, fill_ml 0} on the table, a pitcher {fill_ml 500, pour_to right, pour_at 1, tilt 110} in the air with its lip 8 cm left of the beaker's middle and 12 cm above its 14.7 cm rim (its 17 cm body hangs beside the 10 cm-wide beaker, clear of it; from much higher the strongest part of the pour goes over the far rim); goal fills {beaker, at_least_ml 450}", plan: { seconds: 6, items: [{ id: "beaker", type: "beaker", props: { size: "1000 mL", fill_ml: 0 }, place: { on: "table", x: 1.2 } }, { id: "pitcher", type: "pitcher", props: { fill_ml: 500, pour_to: "right", pour_at: 1, tilt: 110 }, place: { on: "air", x: 1.12, y_m: 0.27 } }], goals: [{ kind: "fills", container: "beaker", at_least_ml: 450 }] } },
		{ ask: "Pour a cup of vegetable oil and a cup of water into the same glass jar.", how: "a glass-jar on the table; a pitcher {vessel cup, liquid water, pour_to right, pour_at 0.8, tilt 110} left of it (lip 7 cm left of the jar's middle, 12 cm over its rim) and a pitcher {vessel cup, liquid vegetable oil, pour_to left, pour_at 3, tilt 110} right of it; seconds 8; the oil floats on the water as its own layer; goal fills {jar, at_least_ml 300}", plan: { seconds: 8, items: [{ id: "jar", type: "glass-jar", place: { on: "table", x: 1.2 } }, { id: "water", type: "pitcher", name: "Cup of water", props: { vessel: "cup", fill_ml: 180, liquid: "water", pour_to: "right", pour_at: 0.8, tilt: 110 }, place: { on: "air", x: 1.13, y_m: 0.3 } }, { id: "oil", type: "pitcher", name: "Cup of oil", props: { vessel: "cup", fill_ml: 180, liquid: "vegetable oil", pour_to: "left", pour_at: 3, tilt: 110 }, place: { on: "air", x: 1.27, y_m: 0.3 } }], goals: [{ kind: "fills", container: "jar", at_least_ml: 300 }] } },
		{ ask: "A tap fills a coffee mug until it overflows.", how: "a coffee-mug on the table, a tap {flow_ml_s 60, on_at 0.5} with its mouth straight above the mug's middle about 15 cm over its rim; seconds ≥ the mug's capacity ÷ 60 + 3 (the overflow runs onto the table as a puddle); goals fills {mug, at_least_ml 250}, overflows {mug}", plan: { seconds: 9, items: [{ id: "mug", type: "coffee-mug", place: { on: "table", x: 1.2 } }, { id: "tap", type: "tap", props: { flow_ml_s: 60, on_at: 0.5 }, place: { on: "air", x: 1.2, y_m: 0.27 } }], goals: [{ kind: "overflows", container: "mug" }] } },
		{ ask: "Which pours faster, honey or water?", how: "two buckets apart on the table, a cup of water and a cup of honey (pitcher {vessel cup, fill_ml 200, tilt 75}) each held over its own bucket (lip 7 cm and 3 cm before the bucket's middle, 45 cm up); seconds 10; goal pours_faster {a: water, b: honey}", plan: { seconds: 10, items: [{ id: "cup1", type: "bucket", place: { on: "table", x: 0.8 } }, { id: "water", type: "pitcher", name: "Cup of water", props: { vessel: "cup", fill_ml: 200, liquid: "water", pour_at: 1, tilt: 75 }, place: { on: "air", x: 0.72, y_m: 0.45 } }, { id: "cup2", type: "bucket", place: { on: "table", x: 1.7 } }, { id: "honey", type: "pitcher", name: "Cup of honey", props: { vessel: "cup", fill_ml: 200, liquid: "honey", pour_at: 1, tilt: 75 }, place: { on: "air", x: 1.67, y_m: 0.45 } }], goals: [{ kind: "pours_faster", a: "water", b: "honey" }] } },
		{ ask: "Show that water spurts farther from lower holes in a bottle.", how: "a leaky-bottle {holes 3, kept_full true, stand_cm 20} on the table with 0.6 m of table clear on its facing side; goal jet_farthest {bottle, hole 1}", plan: { seconds: 4, items: [{ id: "bottle", type: "leaky-bottle", props: { holes: 3, kept_full: true, stand_cm: 20 }, place: { on: "table", x: 0.8 } }], goals: [{ kind: "jet_farthest", item: "bottle", hole: 1 }] } },
		{ ask: "Fair test: does deeper water squirt farther? One bottle filled deep, one shallow.", how: "two leaky-bottles {holes 1, lowest_cm 3, facing right, stand_cm 15} the same in all but fill_cm (20 and 8), 1 m apart on the table so each jet has 0.6 m of table; goal reaches_farther {a: deep, b: shallow}", plan: { seconds: 3, items: [{ id: "deep", type: "leaky-bottle", name: "Deep bottle", props: { holes: 1, lowest_cm: 3, fill_cm: 20, kept_full: true, stand_cm: 15 }, place: { on: "table", x: 0.1 } }, { id: "shallow", type: "leaky-bottle", name: "Shallow bottle", props: { holes: 1, lowest_cm: 3, fill_cm: 8, kept_full: true, stand_cm: 15 }, place: { on: "table", x: 1.4 } }], goals: [{ kind: "reaches_farther", a: "deep", b: "shallow" }] } },
		{ ask: "Fair test: a strong stream and a trickle on two waterwheels: which turns faster?", how: "two waterwheels the same, axles in the air 1 m apart and 45 cm up (so a bucket's 27 cm rim stays out of the paddles' circle), a tap over one side of each (x offset 0.35 × diameter) at the same height: flow_ml_s 140 and 30; a bucket under each wheel; goal turns_faster {a: wheel under the strong tap, b: the other}", plan: { seconds: 5, items: [{ id: "w1", type: "waterwheel", name: "Wheel under the strong tap", place: { on: "air", x: 0.7, y_m: 0.45 } }, { id: "t1", type: "tap", name: "Strong tap", props: { flow_ml_s: 140, on_at: 0.3 }, place: { on: "air", x: 0.784, y_m: 0.75 } }, { id: "b1", type: "bucket", place: { on: "table", x: 0.75 } }, { id: "w2", type: "waterwheel", name: "Wheel under the trickle", place: { on: "air", x: 1.7, y_m: 0.45 } }, { id: "t2", type: "tap", name: "Trickling tap", props: { flow_ml_s: 30, on_at: 0.3 }, place: { on: "air", x: 1.784, y_m: 0.75 } }, { id: "b2", type: "bucket", place: { on: "table", x: 1.75 } }], goals: [{ kind: "turns_faster", a: "w1", b: "w2" }] } },
		{ ask: "Fair test: two taps, one open more: which cup fills faster?", how: "two glass-jars the same, a tap straight above each at the same height: flow_ml_s 120 and 40; goal fills_faster {a: jar under the 120 mL/s tap, b: the other}", plan: { seconds: 6, items: [{ id: "j1", type: "glass-jar", place: { on: "table", x: 0.8 } }, { id: "t1", type: "tap", props: { flow_ml_s: 120, on_at: 0.5 }, place: { on: "air", x: 0.8, y_m: 0.3 } }, { id: "j2", type: "glass-jar", place: { on: "table", x: 1.6 } }, { id: "t2", type: "tap", props: { flow_ml_s: 40, on_at: 0.5 }, place: { on: "air", x: 1.6, y_m: 0.3 } }], goals: [{ kind: "fills_faster", a: "j1", b: "j2" }] } },
		{ ask: "Water runs down a slide into a bucket.", how: "a bucket on the table; a plank {length 0.6, legs false} tilted 20° (angle_deg -20, low end to the right) in the air with its low end just before the bucket's opening and above its rim (the water shoots off it into the bucket); a pitcher {fill_ml 500, pour_to right} pouring onto the plank a quarter of the way down from its high end, its lip 10-20 cm above it (a stream landing right at the top end splashes back over it onto the table); goal fills {bucket, at_least_ml 400}", plan: { seconds: 7, items: [{ id: "bucket", type: "bucket", place: { on: "table", x: 1.4 } }, { id: "ramp", type: "plank", props: { length: 0.6, legs: false }, place: { on: "air", x: 0.9, y_m: 0.45, angle_deg: -20 } }, { id: "pitcher", type: "pitcher", props: { fill_ml: 500, pour_to: "right" }, place: { on: "air", x: 0.66, y_m: 0.75 } }], goals: [{ kind: "fills", container: "bucket", at_least_ml: 400 }] } },
		{ ask: "A tap fills a jar and the cork in it floats up.", how: "a glass-jar on the table with a cork inside (place {inside: jar}), a tap {flow_ml_s 100} straight above the jar; the cork rises with the water and floats; goals fills {jar, at_least_ml 300}, floats {cork}", plan: { seconds: 6, items: [{ id: "jar", type: "glass-jar", place: { on: "table", x: 1.2 } }, { id: "cork", type: "cork", place: { inside: "jar" } }, { id: "tap", type: "tap", props: { flow_ml_s: 100, on_at: 0.3 }, place: { on: "air", x: 1.2, y_m: 0.32 } }], goals: [{ kind: "fills", container: "jar", at_least_ml: 300 }, { kind: "floats", item: "cork" }] } },
		{ ask: "Weigh the water a tap pours into a mug on a kitchen scale.", how: "a kitchen-scale on the table, a coffee-mug on it, a tap {flow_ml_s 50, on_at 0.5, off_at 5.5} straight above the mug: 250 mL runs in, and the scale's reading rises by about 250 g (measure's reads {item: scale, grams: mug + 250, tol})", plan: { seconds: 8, items: [{ id: "scale", type: "kitchen-scale", place: { on: "table", x: 1.2 } }, { id: "mug", type: "coffee-mug", place: { on: "scale" } }, { id: "tap", type: "tap", props: { flow_ml_s: 50, on_at: 0.5, off_at: 5.5 }, place: { on: "air", x: 1.2, y_m: 0.35 } }], goals: [{ kind: "fills", container: "mug", at_least_ml: 240 }] } },
		{ ask: "Mix blue and yellow water in a jar.", how: "a glass-jar; two cups of water (pitcher {vessel cup, fill_ml 150}) dye blue pour_to right from its left and dye yellow pour_to left from its right, pour_at 0.8 and 2.5; goal mixes_to {jar, green}", plan: { seconds: 7, items: [{ id: "jar", type: "glass-jar", place: { on: "table", x: 1.2 } }, { id: "blue", type: "pitcher", name: "Cup of blue water", props: { vessel: "cup", fill_ml: 150, dye: "blue", pour_to: "right", pour_at: 0.8 }, place: { on: "air", x: 1.12, y_m: 0.32 } }, { id: "yellow", type: "pitcher", name: "Cup of yellow water", props: { vessel: "cup", fill_ml: 150, dye: "yellow", pour_to: "left", pour_at: 2.5 }, place: { on: "air", x: 1.28, y_m: 0.32 } }], goals: [{ kind: "mixes_to", container: "jar", color: "green" }] } },
		{ ask: "A tap turns a waterwheel.", how: "a waterwheel's axle in the air 45 cm up, a tap {flow_ml_s 140} over one side of its paddles (x offset 0.35 × diameter), a bucket below whose rim stays out of the paddles' circle; goal turns {wheel, at_least_rpm 20}", plan: { seconds: 5, items: [{ id: "wheel", type: "waterwheel", place: { on: "air", x: 1.2, y_m: 0.45 } }, { id: "tap", type: "tap", props: { flow_ml_s: 140, on_at: 0.3 }, place: { on: "air", x: 1.284, y_m: 0.75 } }, { id: "tub", type: "bucket", place: { on: "table", x: 1.25 } }], goals: [{ kind: "turns", item: "wheel", at_least_rpm: 20 }] } }
	],
	goals: [
		{
			kind: "fills", aliases: ["fill", "filled", "fills_to", "fills_up"], fields: { container: "item", at_least_ml: "number", before_s: "number?" }, subject: ["container"],
			about: "fills {container, at_least_ml, before_s?}: liquid poured into the container reaches at least that many mL (by before_s if given)",
			label: (g, nameOf) => `${nameOf(g.container)} fills to at least ${g.at_least_ml} mL${Number.isFinite(g.before_s) ? ` by ${g.before_s} s` : ""}`,
			summarize: (ctx, g) => fills(ctx, g),
			aim: (g, entry, scene, run) => aimPour(g.container, scene, run),
			sample: (scene, pick) => {
				const xs = pickOf(scene, CATCHERS)
				return xs.length ? { kind: "fills", container: pick(xs).id, at_least_ml: pick([50, 100, 250]), ...(pick([true, false]) ? { before_s: pick([2, 3.5]) } : {}) } : null
			}
		},
		{
			kind: "overflows", aliases: ["overflow", "overflowed", "spills_over", "runs_over", "brims_over"], fields: { container: "item", before_s: "number?" }, subject: ["container"],
			about: "overflows {container, before_s?}: liquid goes over the container's rim (more than half a millilitre), by before_s if given",
			label: (g, nameOf) => `${nameOf(g.container)} overflows${Number.isFinite(g.before_s) ? ` by ${g.before_s} s` : ""}`,
			summarize: (ctx, g) => overflows(ctx, g),
			aim: (g, entry, scene, run) => aimPour(g.container, scene, run),
			detail: (e) => (e?.ok ? `yes (it overflows at ${trimNum(e.t, 1)} s; ${trimNum(e.ml, 0)} mL went over its rim)` : e?.t === null ? "no: nothing went over its rim" : null),
			sample: (scene, pick) => {
				const xs = pickOf(scene, CATCHERS)
				return xs.length ? { kind: "overflows", container: pick(xs).id, ...(pick([true, false]) ? { before_s: pick([2, 4]) } : {}) } : null
			}
		},
		{
			kind: "empties", aliases: ["empty", "emptied", "runs_dry"], fields: { item: "item", before_s: "number?" },
			about: "empties {item, before_s?}: the pitcher or bottle pours out (at most 1 % or 1 mL left) by before_s if given",
			label: (g, nameOf) => `${nameOf(g.item)} empties${Number.isFinite(g.before_s) ? ` by ${g.before_s} s` : ""}`,
			summarize: (ctx, g) => empties(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["pitcher", "leaky-bottle"])
				return xs.length ? { kind: "empties", item: pick(xs).id, ...(pick([true, false]) ? { before_s: 3 } : {}) } : null
			}
		},
		{
			kind: "pours_faster", aliases: ["flows_faster", "faster_pour", "empties_first"], fields: { a: "item", b: "item" }, subject: ["a"],
			about: "pours_faster {a, b}: a pours out half of what it held sooner than b (or, when neither does, has poured more by the end)",
			label: (g, nameOf) => `${nameOf(g.a)} pours faster than ${nameOf(g.b)}`,
			summarize: (ctx, g) => pours_faster(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["pitcher", "leaky-bottle", "tap", "hose"])
				return xs.length >= 2 ? { kind: "pours_faster", a: xs[0].id, b: xs[1].id } : null
			}
		},
		{
			kind: "fills_faster", aliases: ["fills_first", "fills_sooner", "fills_quicker"], fields: { a: "item", b: "item", ml: "number?" }, subject: ["a"],
			about: "fills_faster {a, b, ml?}: container a gains ml (default half of what the less full one ends with) sooner than container b, by at least 0.1 s and 5 % (a fair test of two taps, two pours, two hoses)",
			label: (g, nameOf) => `${nameOf(g.a)} fills faster than ${nameOf(g.b)}`,
			summarize: (ctx, g) => fills_faster(ctx, g),
			detail: (e) => (e && e.a_s !== null ? `${e.ok ? "yes" : "no"} (${trimNum(e.ml, 0)} mL in ${trimNum(e.a_s, 2)} s, against ${e.b_s === null ? "never" : `${trimNum(e.b_s, 2)} s`})` : null),
			sample: (scene, pick) => {
				const xs = pickOf(scene, CATCHERS)
				return xs.length >= 2 ? { kind: "fills_faster", a: xs[0].id, b: xs[1].id, ...(pick([true, false]) ? { ml: pick([50, 150]) } : {}) } : null
			}
		},
		{
			kind: "jet_farthest", aliases: ["spurts_farthest", "farthest_jet", "lands_farthest"], fields: { item: "item", hole: "number" },
			about: "jet_farthest {item, hole}: of a leaky-bottle's jets, the one from that hole (1 = lowest) lands farthest out, by at least 1 cm and 5 % over each other jet",
			label: (g, nameOf) => `the jet from hole ${g.hole} of ${nameOf(g.item)} lands farthest`,
			summarize: (ctx, g) => jet_farthest(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["leaky-bottle"])
				return xs.length ? { kind: "jet_farthest", item: pick(xs).id, hole: pick([1, 2, 3]) } : null
			}
		},
		{
			kind: "reaches_farther", aliases: ["jet_farther", "squirts_farther", "spurts_farther", "jet_reaches_farther", "lands_farther_out"], fields: { a: "item", b: "item", hole: "number?" }, subject: ["a"],
			about: "reaches_farther {a, b, hole?}: bottle a's jet from that hole (default 1, the lowest) lands farther out than bottle b's, by at least 1 cm and 5 % (a fair test: deeper water, a taller block, a bigger hole)",
			label: (g, nameOf) => `the jet from ${nameOf(g.a)} lands farther out than the one from ${nameOf(g.b)}`,
			summarize: (ctx, g) => reaches_farther(ctx, g),
			detail: (e) => (e && e.a_m !== null ? `${e.ok ? "yes" : "no"} (${trimNum(e.a_m * 100, 1)} cm out, against ${e.b_m === null ? "none" : `${trimNum(e.b_m * 100, 1)} cm`}, measured at the level each bottle stands on)` : null),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["leaky-bottle"])
				return xs.length >= 2 ? { kind: "reaches_farther", a: xs[0].id, b: xs[1].id, ...(pick([true, false]) ? { hole: pick([1, 2]) } : {}) } : null
			}
		},
		{
			kind: "turns", aliases: ["spins", "turning", "rotates"], fields: { item: "item", at_least_rpm: "number?", before_s: "number?" },
			about: "turns {item, at_least_rpm?, before_s?}: the waterwheel turns at least that fast (default 10 rpm) and keeps it up for half a second, by before_s if given",
			label: (g, nameOf) => `${nameOf(g.item)} turns at ${Number.isFinite(g.at_least_rpm) ? g.at_least_rpm : 10} rpm or more`,
			summarize: (ctx, g) => turns(ctx, g),
			detail: (e) => (e ? `${e.ok ? "yes" : "no"} (it keeps up ${trimNum(e.held_rpm ?? 0, 0)} rpm for half a second${e.max_rpm !== null && e.max_rpm > (e.held_rpm ?? 0) + 5 ? `; a moment's ${trimNum(e.max_rpm, 0)} rpm does not count` : ""})` : null),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["waterwheel"])
				return xs.length ? { kind: "turns", item: pick(xs).id, ...(pick([true, false]) ? { at_least_rpm: pick([5, 20, 60]) } : {}) } : null
			}
		},
		{
			kind: "turns_faster", aliases: ["spins_faster", "wheel_faster", "turns_quicker"], fields: { a: "item", b: "item" }, subject: ["a"],
			about: "turns_faster {a, b}: waterwheel a keeps a faster speed than waterwheel b (each its best held for half a second), by at least 2 rpm and 10 % (a fair test of two streams)",
			label: (g, nameOf) => `${nameOf(g.a)} turns faster than ${nameOf(g.b)}`,
			summarize: (ctx, g) => turns_faster(ctx, g),
			detail: (e) => (e ? `${e.ok ? "yes" : "no"} (${trimNum(e.a_rpm ?? 0, 0)} rpm against ${trimNum(e.b_rpm ?? 0, 0)} rpm, each held half a second)` : null),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["waterwheel"])
				return xs.length >= 2 ? { kind: "turns_faster", a: xs[0].id, b: xs[1].id } : null
			}
		},
		{
			kind: "mixes_to", aliases: ["mixes", "turns_color", "colour", "color"], fields: { container: "item", color: "string" }, subject: ["container"],
			about: "mixes_to {container, color}: the liquid in the container ends that colour (clear, red, orange, yellow, green, blue, purple, brown): blue + yellow water → green; liquids that do not mix (oil on water) keep their own colours, and the container's is its biggest layer's",
			label: (g, nameOf) => `the liquid in ${nameOf(g.container)} ends ${g.color}`,
			summarize: (ctx, g) => mixes_to(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, CATCHERS)
				return xs.length ? { kind: "mixes_to", container: pick(xs).id, color: pick(["green", "clear", "purple"]) } : null
			}
		},
		{
			kind: "delivers", aliases: ["moves_liquid", "siphons", "drains"], fields: { item: "item", at_least_ml: "number" },
			about: "delivers {item, at_least_ml}: the tap, pitcher, bottle or hose puts out at least that many mL",
			label: (g, nameOf) => `${nameOf(g.item)} delivers at least ${g.at_least_ml} mL`,
			summarize: (ctx, g) => delivers(ctx, g),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["pitcher", "leaky-bottle", "tap", "hose"])
				return xs.length ? { kind: "delivers", item: pick(xs).id, at_least_ml: pick([20, 100, 400]) } : null
			}
		}
	],
	knobs: [
		{ type: "pitcher", key: "tilt", how: "abs", steps: [5, 10, 20, 30, 45], more: "tip {it} further", less: "tip {it} less", why: "the further it tips, the lower its lip goes under the surface: it pours faster and more of it runs out (about 90° or more empties it)" },
		{ type: "pitcher", key: "pour_at", how: "abs", steps: [0.2, 0.5, 1, 2], more: "tip {it} later", less: "tip {it} sooner", why: "when the hand starts tipping it: sooner leaves more time to pour before the run ends" },
		{ type: "pitcher", key: "tip_s", how: "rel", more: "tip {it} more slowly", less: "tip {it} more quickly", why: "a quick tip starts a strong stream at once; a slow one starts gently" },
		{ type: "pitcher", key: "fill_ml", how: "rel", more: "fill {it} more", less: "fill {it} less", why: "more liquid in it: it starts pouring at a smaller tilt and pours more" },
		{ type: "pitcher", key: "back_at", how: "abs", steps: [0.5, 1, 2, 3], cost: 2, more: "stand {it} up later", less: "stand {it} up sooner", why: "standing it up again stops the pour: later pours more" },
		{ type: "pitcher", key: "liquid", how: "choice", cost: 4, more: "pour another liquid from {it}", less: "pour another liquid from {it}", why: "thick liquids (honey 10 Pa·s, corn syrup 2.5) pour 10-100× slower than water" },
		{ type: "tap", key: "flow_ml_s", how: "rel", steps: [0.2, 0.4, 1, 2], more: "open {it} more", less: "close {it} a little", why: "more flow fills faster and pushes a waterwheel harder (the push grows with the flow times its speed)" },
		{ type: "tap", key: "on_at", how: "abs", steps: [0.2, 0.5, 1], more: "turn {it} on later", less: "turn {it} on sooner", why: "when the water starts" },
		{ type: "tap", key: "off_at", how: "abs", steps: [0.5, 1, 2], cost: 2, more: "turn {it} off later", less: "turn {it} off sooner", why: "when the water stops (0 = never): it decides how much runs" },
		{ type: "leaky-bottle", key: "fill_cm", how: "abs", steps: [1, 2, 4], more: "fill {it} higher", less: "fill {it} lower", why: "deeper water pushes harder at each hole: faster jets that land farther" },
		{ type: "leaky-bottle", key: "hole_mm", how: "abs", steps: [0.5, 1, 2], more: "make {it}'s holes bigger", less: "make {it}'s holes smaller", why: "flow grows with the hole's area (its width squared); the jets' speed depends only on the depth" },
		{ type: "leaky-bottle", key: "stand_cm", how: "abs", steps: [5, 10, 15], more: "raise {it} on a taller block", less: "lower {it}", why: "jets fall farther before they land, so each lands farther out (reach = v·√(2·height/g))" },
		{ type: "leaky-bottle", key: "kept_full", how: "bool", more: "keep {it} topped up", less: "stop topping {it} up", why: "kept full, the jets stay as strong; otherwise they weaken as the level falls" },
		{ type: "leaky-bottle", key: "cap", how: "bool", cost: 2, more: "put {it}'s cap on", less: "take {it}'s cap off", why: "with the cap on no air gets in, so nothing comes out of the holes" },
		{ type: "hose", key: "diameter_mm", how: "rel", more: "use a wider hose", less: "use a narrower hose", why: "a wider hose carries far more: the flow grows faster than the width squared (less friction)" },
		{ type: "hose", key: "inlet_cm", how: "abs", steps: [0.5, 1, 2], more: "raise {it}'s inlet", less: "lower {it}'s inlet", why: "the siphon breaks when the source's surface falls below its inlet" },
		{ type: "hose", key: "to", how: "link", cost: 3, more: "lead {it} into {to}", less: "lead {it} into {to}", why: "which container its other end fills" },
		{ type: "hose", key: "from", how: "link", cost: 3, more: "draw {it} from {to}", less: "draw {it} from {to}", why: "which container it drains" },
		{ type: "waterwheel", key: "axle_friction", how: "rel", steps: [0.5, 0.8, 0.9, 0.95], cost: 0.1, more: "load {it}'s axle more", less: "free {it}'s axle", why: "a dragging axle (a load) slows it; a freer axle turns faster under the same stream" },
		{ type: "waterwheel", key: "paddle_depth", how: "rel", cost: 2, more: "widen {it}'s paddles", less: "narrow {it}'s paddles", why: "wider paddles catch the whole stream" }
	],
	digest(item, run, h) {
		const out = []
		const P = run?.resolved?.[item.id] ?? item.props ?? {}
		const doc = run?.doc
		const recs = (doc?.processes ?? []).filter((p) => p.item === item.id)
		if (item.type === "pitcher" && P.contents === "grains") {
			// (a cup of grains: the granular module pours them; their readings in grams)
			const rec = recs.find((p) => p.kind === "flow-pour")
			out.push(`a ${P.vessel ?? "pitcher"} of ${trimNum(P.fill_ml ?? 0, 0)} mL of ${P.grain ?? "sugar"} (${trimNum(startOf(run, item.id, "left_g") ?? 0, 0)} g); its lip at x ${trimNum(item.x ?? 0, 3)}, y ${trimNum(item.y ?? 0, 3)} m; it tips to ${trimNum(P.tilt ?? 110, 0)}° toward the ${P.pour_to ?? "right"} from ${trimNum(P.pour_at ?? 1, 2)} s over ${trimNum(P.tip_s ?? 1.5, 2)} s`)
			const start = eventsOf(run, item.id, "pours")[0]
			const left = endOf(run, item.id, "left_g")
			if (left !== null) out.push(`it poured ${trimNum(endOf(run, item.id, "poured_g") ?? 0, 0)} g${start ? ` from ${trimNum(start.t, 2)} s (${/tipped \d+°/.exec(start.text ?? "")?.[0] ?? "tipped"})` : " (it never poured: grains stay until it is tipped past their angle of repose; tip it further)"}; ${trimNum(left, 0)} g left${left > 0.5 && (P.tilt ?? 110) < 125 ? " (some rests on its spout wall: tip it to 130° to empty it)" : ""}`)
			const hm = endOf(run, item.id, "heap_mm")
			if (hm !== null && hm > 0) out.push(`its grains' heap: ${trimNum(hm, 0)} mm tall, sides at ${trimNum(endOf(run, item.id, "heap_deg") ?? 0, 1)}°${(endOf(run, item.id, "outside_g") ?? 0) > 0.5 ? `; ${trimNum(endOf(run, item.id, "outside_g"), 0)} g landed OUTSIDE the container under it` : ""}`)
			if (rec && Number.isFinite(rec.grains_asked)) out.push(`only ${trimNum(rec.grains * 1e6, 0)} mL fits in it (fill_ml ${trimNum(rec.grains_asked, 0)} asked): it is filled to the brim`)
			const land = landingLine(run, item, h?.nameOf)
			if (land) out.push(land.replace("its stream", "its grains"))
		} else if (item.type === "pitcher") {
			const rec = recs.find((p) => p.kind === "flow-pour")
			const l0 = startOf(run, item.id, "left_ml")
			const l1 = endOf(run, item.id, "left_ml")
			out.push(`a ${P.vessel ?? "pitcher"} of ${trimNum(P.fill_ml ?? 0, 0)} mL ${P.liquid ?? "water"}${P.dye && P.dye !== "none" ? ` (${P.dye})` : ""}; its lip (the item's position) at x ${trimNum(item.x ?? 0, 3)}, y ${trimNum(item.y ?? 0, 3)} m; it tips to ${trimNum(P.tilt ?? 110, 0)}° toward the ${P.pour_to ?? "right"} from ${trimNum(P.pour_at ?? 1, 2)} s over ${trimNum(P.tip_s ?? 1.5, 2)} s${num(P.back_at) > 0 ? `, back up at ${trimNum(P.back_at, 2)} s` : ""}`)
			if (l0 !== null) {
				const start = firstWhen(run, item.id, "flow_ml_s", (v) => v > 0.5)
				out.push(`it held ${trimNum(l0, 0)} mL, poured ${trimNum(endOf(run, item.id, "poured_ml") ?? 0, 0)} mL${start === null ? " (it never poured: tip it further or fill it more)" : ` from ${trimNum(start, 2)} s`}; ${trimNum(l1, 0)} mL left at the end`)
			}
			if (rec && !(rec.volume > 0)) out.push("it is EMPTY: set fill_ml")
			if (rec && Number.isFinite(rec.asked)) out.push(`only ${trimNum(rec.volume * 1e6, 0)} mL fits in it (fill_ml ${trimNum(rec.asked, 0)} asked): it is filled to the brim`)
			for (const e of eventsOf(run, item.id, "inside")) out.push(`it STARTS INSIDE ${h?.nameOf?.(e.items[1]) ?? e.items[1]}: raise it (its body hangs ${trimNum((VESSELS[P.vessel ?? "pitcher"] ?? VESSELS.pitcher)[1] * 100 + 0.3, 0)} cm below its lip and ${trimNum((VESSELS[P.vessel ?? "pitcher"] ?? VESSELS.pitcher)[0] * 100, 0)} cm behind it) or move it aside`)
			const land = landingLine(run, item, h?.nameOf)
			if (land) out.push(land)
		} else if (item.type === "tap") {
			out.push(`water falls straight down from x ${trimNum(item.x ?? 0, 3)}, y ${trimNum(item.y ?? 0, 3)} m at ${trimNum(P.flow_ml_s ?? 100, 0)} mL/s from ${trimNum(P.on_at ?? 0.5, 2)} s${num(P.off_at) > 0 ? ` to ${trimNum(P.off_at, 2)} s` : ""}; ran ${trimNum(endOf(run, item.id, "flowed_ml") ?? 0, 0)} mL`)
			if (num(P.off_at) > 0 && P.off_at <= (P.on_at ?? 0)) out.push("off_at is before on_at: it never runs")
			const land = landingLine(run, item, h?.nameOf)
			if (land) out.push(land)
		} else if (item.type === "leaky-bottle") {
			const jets = [1, 2, 3, 4].map((k) => [k, maxOf(run, item.id, `jet${k}_ms`), maxOf(run, item.id, `reach${k}_m`)]).filter(([, v]) => v !== null && v > 0)
			out.push(`holes at ${P.hole_heights_cm ?? "?"} cm over its inside bottom facing ${P.facing ?? "right"}; water ${trimNum(P.fill_cm ?? 20, 1)} cm deep${P.kept_full ? " (kept full)" : ""}${P.cap ? "; CAP ON: no water comes out" : ""}; it stands on a ${trimNum(P.stand_cm ?? 15, 0)} cm block`)
			if (jets.length) out.push(`jets (fastest each): ${jets.map(([k, v, r]) => `hole ${k} ${trimNum(v, 2)} m/s lands ${trimNum(r, 3)} m out`).join("; ")}`)
			// (where each jet comes down: on the table or the block, or past its edge, falling to the floor; its reach is measured at the block's level all the same)
			const side = (P.facing ?? "right") === "right" ? 1 : -1
			const off = jets.filter(([, , r]) => r > 0 && !surfaceUnder(run, (item.x ?? 0) + side * (0.051 + r), item.y ?? 0))
			if (off.length) out.push(`the jet from ${off.map(([k]) => `hole ${k}`).join(", ")} lands PAST THE EDGE of what the bottle stands on (x ${off.map(([, , r]) => trimNum((item.x ?? 0) + side * (0.051 + r), 2)).join(", ")} m) and falls to the floor: its reach is still measured at the block's level; move the bottle so 0.6 m of table is clear on its ${P.facing ?? "right"}`)
			const rec = recs.find((p) => p.kind === "flow-vessel")
			if (rec && Number.isFinite(rec.dropped) && rec.dropped > 0) out.push(`${rec.dropped} of its ${(rec.holes?.length ?? 0) + rec.dropped} holes would be above its 23 cm body, so it has only ${rec.holes?.length ?? 0}: lower lowest_cm or spacing_cm`)
			const l1 = endOf(run, item.id, "left_ml")
			if (l1 !== null) out.push(`${trimNum(endOf(run, item.id, "poured_ml") ?? 0, 0)} mL ran out; ${trimNum(l1, 0)} mL left, water ${trimNum((endOf(run, item.id, "level_mm") ?? 0) / 10, 1)} cm deep at the end`)
		} else if (item.type === "hose") {
			const rec = recs.find((p) => p.kind === "flow-hose")
			if (!rec) out.push("NOT LINKED: set its `from` container (and `to`): it moves nothing")
			else {
				out.push(`a ${trimNum(P.diameter_mm ?? 10, 1)} mm hose from ${rec.from} to ${rec.to ?? "its free end at the item's position"}; moved ${trimNum(endOf(run, item.id, "moved_ml") ?? 0, 0)} mL (fastest ${trimNum(maxOf(run, item.id, "flow_ml_s") ?? 0, 1)} mL/s)`)
				if (eventsOf(run, item.id, "siphon").some((e) => /runs from/.test(e.text ?? ""))) out.push(`it RAN THE OTHER WAY, from ${rec.to} to ${rec.from}: that surface was the higher (a siphon flows from the higher surface to the lower whatever its ends are called)`)
				if (!rec.to) {
					const land = landingLine(run, item, h?.nameOf)
					if (land) out.push(land)
				}
			}
		} else if (item.type === "waterwheel") {
			out.push(`axle at x ${trimNum(item.x ?? 0, 3)}, y ${trimNum(item.y ?? 0, 3)} m, ${trimNum((P.diameter ?? 0.24) * 100, 0)} cm across; fastest ${trimNum(maxOf(run, item.id, "rpm") ?? 0, 0)} rpm, ${trimNum(endOf(run, item.id, "turns") ?? 0, 1)} turns`)
			if ((maxOf(run, item.id, "rpm") ?? 0) < 1) out.push("it hardly turns: the stream must fall on the paddles on ONE side of the axle (0.3-0.45 × the diameter from it)")
			for (const e of eventsOf(run, item.id, "jam")) out.push(`${h?.nameOf?.(e.items[0]) ?? e.items[0]} is IN THE WAY of its paddles (they sweep a ${trimNum((P.diameter ?? 0.24) * 100, 0)} cm circle round the axle): it cannot turn freely; move that or raise the wheel`)
		} else if (Object.keys(BASIN_PARTS).includes(item.type)) {
			const v = endOf(run, item.id, "liquid_ml")
			if (v !== null) out.push(`caught ${trimNum(v, 0)} mL (${trimNum((endOf(run, item.id, "level_mm") ?? 0) / 10, 1)} cm deep)${v > 0 ? `, coloured ${colorOfRun(run, item.id) ?? "?"}` : ""}`)
			const over = endOf(run, item.id, "overflow_ml")
			if (over !== null && over > 0.5) out.push(`it OVERFLOWED from ${trimNum(firstWhen(run, item.id, "overflow_ml", (x) => x > 0.5) ?? 0, 1)} s: ${trimNum(over, 0)} mL went over its rim`)
		} else if (["water-tank", "graduated-cylinder", "beaker", "measuring-jug", "density-column"].includes(item.type)) {
			const r = endOf(run, item.id, "received_ml")
			if (r !== null && r > 0) out.push(`${trimNum(r, 0)} mL was poured in${colorOfRun(run, item.id) ? `; its liquid is ${colorOfRun(run, item.id)}` : ""}`)
		}
		return out.length ? out : null
	},
	place: {
		/** Held up by what this module draws or implies: a pitcher by the hand that tips it, a tap by its wall plate, a waterwheel by its
		 *  axle bracket, a hose's free end by whoever holds it: the solver need not prop them up. */
		held: (type) => ["pitcher", "tap", "waterwheel", "hose"].includes(type),
		/** A pitcher (and a tap) is held over what it fills: the solver places it after the rest and raises it clear of a bowl it would start
		 *  inside (its body hangs below and behind its lip), never pushes the bowl aside. */
		hover: (type) => type === "pitcher" || type === "tap"
	},
	words: {
		/** what one added thing is called on the card */
		added(item) {
			const P = item?.props ?? {}
			if (item?.type === "pitcher" && P.contents === "grains") return `a ${P.vessel ?? "pitcher"} of ${P.fill_ml ?? (VESSELS[P.vessel ?? "pitcher"] ?? VESSELS.pitcher)[6]} mL of ${P.grain ?? "sugar"}`
			if (item?.type === "pitcher") return `a ${P.vessel ?? "pitcher"} of ${P.fill_ml ?? (VESSELS[P.vessel ?? "pitcher"] ?? VESSELS.pitcher)[6]} mL of ${P.dye && P.dye !== "none" ? `${P.dye} ` : ""}${P.liquid ?? "water"}`
			if (item?.type === "tap") return `a tap running ${P.flow_ml_s ?? 100} mL/s`
			if (item?.type === "leaky-bottle") return `a bottle with ${P.holes ?? 3} holes`
			return null
		},
		/** the words in a request that name a setting (the person's own choice: a fix never offers it back) */
		keys: {
			"pitcher.tilt": "tip\\w*|tilt\\w*|angle",
			"pitcher.fill_ml": "full|fill\\w*|how much|ml|millilit\\w*",
			"pitcher.pour_at": "sooner|later|start\\w* pour\\w*|when",
			liquid: "honey|syrup|oil|water|soap|alcohol|milk|chocolate milk|liquid|thick\\w*|thin\\w*",
			dye: "colou?r\\w*|dye|food colou?ring|blue|red|yellow|green|purple|orange|white|brown",
			"pitcher.contents": "grains?|sugar|salt|rice|sand",
			"pitcher.grain": "sugar|salt|rice|sand|fine sand|coarse sand|gravel|soil|flour",
			"tap.flow_ml_s": "flow|faster|slower|harder|trickle|full on",
			"leaky-bottle.hole_mm": "hole size|bigger holes?|smaller holes?|wider holes?",
			"leaky-bottle.fill_cm": "water level|deeper|fuller|depth|how full",
			"leaky-bottle.stand_cm": "block|stand|higher|raise\\w*|lower",
			"leaky-bottle.kept_full": "kept full|keep\\w* (it )?full|topped up|top\\w* up",
			"leaky-bottle.cap": "cap|lid",
			"hose.diameter_mm": "wide|wider|narrow|narrower|thick|thicker|thin|thinner|diameter|width|across|bore",
			"waterwheel.axle_friction": "friction|load|brake|drag"
		},
		change(type, key, a, b, nameOf) {
			if (type === "pitcher" && key === "tilt") return `tips to ${trimNum(a, 0)}° → ${trimNum(b, 0)}°`
			if (type === "pitcher" && key === "fill_ml") return `${trimNum(a, 0)} → ${trimNum(b, 0)} mL in it`
			if (type === "pitcher" && key === "pour_at") return `starts pouring at ${trimNum(a, 1)} → ${trimNum(b, 1)} s`
			if (["pitcher", "tap", "leaky-bottle"].includes(type) && key === "liquid") return `${a} → ${b} (${trimNum(nu(a) * 1e6, 0)} → ${trimNum(nu(b) * 1e6, 0)} mm²/s: ${nu(b) > nu(a) ? "thicker, flows slower" : "thinner, flows faster"})`
			if (["pitcher", "tap", "leaky-bottle"].includes(type) && key === "dye") return `colour ${a} → ${b}`
			if (type === "pitcher" && key === "contents") return `holds ${a} → ${b}`
			if (type === "pitcher" && key === "grain") return `grains ${a} → ${b}`
			if (type === "tap" && key === "flow_ml_s") return `flow ${trimNum(a, 0)} → ${trimNum(b, 0)} mL/s`
			if (type === "leaky-bottle" && key === "fill_cm") return `water ${trimNum(a, 1)} → ${trimNum(b, 1)} cm deep (lowest jet ${trimNum(0.97 * Math.sqrt(2 * 9.81 * Math.max(0, a / 100 - 0.03)), 2)} → ${trimNum(0.97 * Math.sqrt(2 * 9.81 * Math.max(0, b / 100 - 0.03)), 2)} m/s)`
			if (type === "leaky-bottle" && key === "hole_mm") return `holes ${trimNum(a, 1)} → ${trimNum(b, 1)} mm (flow × ${trimNum((b * b) / (a * a), 2)})`
			if (type === "leaky-bottle" && key === "stand_cm") return `block ${trimNum(a, 0)} → ${trimNum(b, 0)} cm`
			if (type === "hose" && key === "diameter_mm") return `hose ${trimNum(a, 1)} → ${trimNum(b, 1)} mm wide`
			if (type === "hose" && (key === "from" || key === "to")) return `${key} ${a ? nameOf(a) : "none"} → ${b ? nameOf(b) : "none"}`
			if (type === "waterwheel" && key === "axle_friction") return `axle drag ${trimNum(a, 4)} → ${trimNum(b, 4)} N·m·s`
			return null
		}
	}
}
