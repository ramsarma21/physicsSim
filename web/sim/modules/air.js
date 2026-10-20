// The air module's port (machines/mod_air.py, line for line: the same documents, number for number) and its plug-ins for the AI (goal kinds,
// digest, knobs, prompts, placement, change words). Balloons that fill and pop, a model hot-air balloon, an incense stick's smoke, a cup
// anemometer, a wind tunnel, a vacuum jar, a card under an upside-down glass of water, a suction cup, a can crushed by the air, paper airplanes and kites.
// The engine side: tooling/src/sim/modules/air.ts (process kind "air") with the physics in tooling/src/sim/air.ts. Sources: machines/mod_air.py.
let register, ItemType, Prop, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, D2R, register_goal_kind, register_build_hook, TYPES, CATEGORIES, define_material
let pyRound, pyRoundInt, truthy, hasOwn, fmtF, cube, cos, sin
let F = null // the whole framework object

export const MODULE = "air"
const CAT = "Air"

// ---------------------------------------------------------------- the physics constants (tooling/src/sim/air.ts has the same, with sources)
const GAS_R = 8.314462618
const ATM = 101325.0
const KELVIN = 273.15
const MOLAR = { air: 0.0289644, helium: 0.0040026 }
const RUBBER_K = 10.0
const RUBBER_FULL = 6.0
const RUBBER_P = 3000.0
const RUBBER_BURST = 7.8
const LEAK = { air: 1.15e-6, helium: 1.925e-5 }
const BALLOON_RUBBER = 0.003
const NECK = 0.004

export function rubber_shape(l) {
	if (l <= 1) return 0.0
	const l2 = l * l
	const l4 = l2 * l2
	const l7 = l4 * l2 * l
	return (1 / l - 1 / l7) * (1 + l2 / RUBBER_K)
}
const FULL_SHAPE = rubber_shape(RUBBER_FULL)
export const skin_pressure = (l) => (RUBBER_P * rubber_shape(l)) / FULL_SHAPE
export const sphere_volume = (r) => (4 / 3) * Math.PI * r * r * r

/** Where n mol at T fill a balloon of slack radius r0 against pout (machines/mod_air.py balloon_radius). */
export function balloon_radius(n, T, pout, r0, cap) {
	const want = n * GAS_R * T
	const f = (r) => (pout + skin_pressure(r / r0)) * sphere_volume(r) - want
	let lo = 0.5 * r0
	let hi = cap
	if (f(lo) >= 0) return lo
	if (f(hi) <= 0) return hi
	for (let k = 0; k < 64; k++) {
		const mid = (lo + hi) / 2
		if (f(mid) < 0) lo = mid
		else hi = mid
	}
	return (lo + hi) / 2
}

export function register_all(g) {
	;({ register, ItemType, Prop, Readout, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, D2R, register_goal_kind, register_build_hook, TYPES, CATEGORIES, define_material } = g)
	;({ pyRound, pyRoundInt, truthy, hasOwn, fmtF, cube, cos, sin } = g.py)
	F = g
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
	_looks()
	_materials()
	_balloons()
	_hot_air()
	_smoke()
	_anemometer()
	_tunnel()
	_jar()
	_pressure()
	_flyers()
	_goals()
	register_build_hook(_hook)
}

// ---------------------------------------------------------------- looks and materials
export const COLORS = {
	red: "#d62828", blue: "#1f5fbf", yellow: "#f2c230", green: "#2e9e44", orange: "#f07f1a", purple: "#7b3fb0", pink: "#ec6fa5", white: "#f4f4f0",
	silver: "#c9ced3", black: "#222222"
}
const COLOR_NAMES = Object.keys(COLORS)

function _looks() {
	add_look("latex", { fill: "#d62828", shade: "#9c1c1c", roughness: 0.28, metalness: 0.0, clearcoat: 0.9 })
	add_look("tissue", { fill: "#f3e2c0", shade: "#cdb78f", roughness: 0.85, metalness: 0.0, clearcoat: 0.0, transmission: 0.25 })
	add_look("ripstop", { fill: "#e04a3a", shade: "#a83226", roughness: 0.6, metalness: 0.0, clearcoat: 0.1 })
	add_look("folded paper", { fill: "#f6f5f0", shade: "#cfccc2", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	add_look("balsa", { fill: "#e9d7ae", shade: "#c3ad7f", roughness: 0.8, metalness: 0.0, clearcoat: 0.0, grain: true })
	add_look("cup vinyl", { fill: "#dfe7ea", shade: "#a9b6bb", roughness: 0.3, metalness: 0.0, clearcoat: 0.6, transmission: 0.5 })
	add_look("can paint", { fill: "#c8202a", shade: "#8f141c", roughness: 0.3, metalness: 0.6, clearcoat: 0.8 })
	add_look("index card", { fill: "#fbfbf6", shade: "#d6d6cc", roughness: 0.85, metalness: 0.0, clearcoat: 0.0 })
}

function _mat(key, kw) {
	const values = { ...kw }
	if (!("rolling" in values)) values.rolling = 0.0
	if (!("side" in values)) values.side = 0.0
	if (!hasOwn(MATERIALS, key)) define_material(key, values, [])
}

function _materials() {
	_mat("balloon latex", { density: 920.0, bounce: 0.5, friction: 0.6, rolling: 0.05, look: "latex",
		source: "Natural rubber latex 920-930 kg/m³ [CRC]; an 11-inch party balloon's rubber about 3 g (provisional). Its weight and the gas in it are set by the air module." })
	_mat("envelope tissue", { density: 500.0, bounce: 0.1, friction: 0.5, look: "tissue",
		source: "Craft tissue paper 17 g/m² (with 15 % for its glued seams) or a 12 µm polyethylene bag 11 g/m²: the envelope's weight is set from its area." })
	_mat("kite (spars and ripstop)", { density: 500.0, bounce: 0.2, friction: 0.5, look: "ripstop",
		source: "Ripstop nylon about 40 g/m² and two 4-6 mm spars about 10 g/m: a 70 cm diamond kite weighs about 25 g (provisional)." })
	_mat("folded paper", { density: 800.0, bounce: 0.15, friction: 0.45, look: "folded paper",
		source: "Copy paper 80 g/m², about 0.1 mm (800 kg/m³); an A4 sheet 4.99 g. The plane's weight is set from its sheet." })
	_mat("balsa", { density: 160.0, bounce: 0.2, friction: 0.45, look: "balsa",
		source: "Balsa 100-200 kg/m³ (Wood Handbook, FPL-GTR-190); a hand-launched glider about 8 g with its nose weight." })
	_mat("suction cup vinyl", { density: 1300.0, bounce: 0.1, friction: 1.0, rolling: 0.05, look: "cup vinyl",
		source: "Soft PVC 1200-1400 kg/m³; a 5 cm suction cup weighs about 5 g." })
	_mat("can aluminium", { density: 2700.0, bounce: 0.2, friction: 0.4, rolling: 0.002, look: "can paint",
		source: "A 355 mL aluminium can: 14.9 g empty, its wall 0.097 mm (3004 alloy, E 69 GPa); with 15 mL of water in it, 30 g." })
	_mat("index card", { density: 700.0, bounce: 0.2, friction: 0.5, look: "index card",
		source: "Index card stock about 0.19 mm, 2 g for a 10 × 10 cm piece (provisional); cardboard and a plastic lid heavier." })
}

// ---------------------------------------------------------------- small helpers
const _r5 = (v) => pyRound(v, 5)
function _upright(c) {
	c.ca = 1.0
	c.sa = 0.0
	c.a = 0.0
}
function _child(c, part, parent, body, at, material, look, words, color = null) {
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look, body, material, at: { x: _r5(at[0]), y: _r5(at[1]) }, parent,
		placeholder: { fill: truthy(color) ? color : LOOK_FILL[look] }, render: { kind: "procedural", shade: LOOK_SHADE[look] }, depth: 2
	}
	if (truthy(color)) s.color = color
	c.sb.solids.push(s)
	return s.id
}
const _name = (c) => (truthy(c.item.name) ? c.item.name : TYPES[c.item.type].name)
function _wp(c, lx, ly) {
	const [x, y] = c.world(lx, ly)
	return { x: pyRound(x, 6) + 0.0, y: pyRound(y, 6) + 0.0 }
}

// ---------------------------------------------------------------- balloons
function _balloons() {
	function build(c, P) {
		const D = P.size
		const r0 = D / 2 / RUBBER_FULL
		const gas = P.gas
		const T = c.settings.room_temp + KELVIN
		// (drawn as it was filled, at the room's pressure, even in no air: the engine swells and bursts it within 0.3 s of the release)
		const pout = ATM
		const n = (ATM * (P.fill_l / 1000)) / (GAS_R * 293.15)
		const r = _r5(balloon_radius(n, T, pout, r0, r0 * RUBBER_BURST))
		const rubber = BALLOON_RUBBER * (D / 0.28) * (D / 0.28)
		const wall = pyRound(Math.max(1e-6, rubber / (920.0 * 4 * Math.PI * r * r)), 7)
		const color = COLORS[P.color]
		const what = `a ${P.color} party balloon of ${gas === "helium" ? "helium" : "air"}`
		const sid = c.ball("balloon", r, 0.0, 0.0, { wall, look: "latex", color, words: what })
		const rec = {
			role: "balloon", solid: sid, name: _name(c), r0: pyRound(r0, 7), rdoc: r, rubber: pyRound(rubber, 7), moles: pyRound(n, 9), molar: MOLAR[gas], neck: NECK,
			tied: truthy(P.tied), prick: P.prick_at, leak: LEAK[gas]
		}
		if (P.pump_lps > 0) {
			const steel = c.mat({ base: "ABS plastic", overrides: {} })
			c.slab("nozzle", 0.012, 0.03, 0.012, 0.0, -r - 0.015, { kind: "static", material: steel, look: "plastic", words: "the pump's nozzle" })
			c.slab("pump", 0.05, 0.28, 0.05, 0.0, -r - 0.03 - 0.14, { kind: "static", material: steel, look: "plastic", words: "a hand pump's barrel" })
			c.slab("foot", 0.16, 0.02, 0.08, 0.0, -r - 0.31 - 0.01, { kind: "static", material: steel, look: "plastic", words: "the pump's foot" })
			Object.assign(rec, { pump: pyRound((P.pump_lps / 1000) * ATM / (GAS_R * 293.15), 9), nozzle: _wp(c, 0.0, -r), up: { x: pyRound(-c.sa, 6) + 0.0, y: pyRound(c.ca, 6) + 0.0 } })
		} else if (P.string_m > 0) {
			const L = P.string_m
			const wg = P.weight_g
			if (wg > 0) {
				const dens = wg / 1000 / (0.03 * 0.025 * 0.03)
				c.slab("weight", 0.03, 0.025, 0.03, 0.0, -r - L - 0.0125, { material: c.mat({ base: "ABS plastic", density: pyRound(dens, 3), overrides: {} }), look: "plastic", words: "a balloon weight" })
			} else {
				c.slab("weight", 0.02, 0.025, 0.02, 0.0, -r - L - 0.0125, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "a hook the string is tied to" })
			}
			c.joint("rope", "string", { a: "balloon", b: "weight", anchorA: [0.0, -r], anchorB: [0.0, 0.0125], length: _r5(L), thickness: 0.001 })
		}
		c.process("air", "air", rec)
	}
	register(new ItemType("party-balloon", "Party balloon", CAT, build, {
		material: "balloon latex", materials: ["balloon latex"], module: MODULE,
		props: [
			new Prop("gas", "Filled with", "air", { kind: "choice", choices: ["air", "helium"], help: "Blown up with air it sinks slowly; helium is so light it floats up" }),
			new Prop("fill_l", "Gas in it", 8.0, 0.0, 40.0, 0.5, "L", "Litres of gas put in (measured at 20 °C and 1 atm). A 28 cm balloon holds 11.5 L at its rated size and pops past about 25 L"),
			new Prop("size", "Rated size", 0.28, 0.12, 0.45, 0.01, "m", "Its diameter blown up as its maker means (an 11-inch balloon is 28 cm); it pops at about 1.3 times that"),
			new Prop("tied", "Tied", true, { kind: "bool", help: "Untied, the air rushes out of its neck and it shoots off the other way (a balloon rocket)" }),
			new Prop("pump_lps", "Pump", 0.0, 0.0, 2.0, 0.05, "L/s", "A hand pump in its neck adds this much air every second: it grows until it pops"),
			new Prop("prick_at", "Pricked at", -1.0, -1.0, 20.0, 0.1, "s", "A pin pricks it then (at the release if that is later) and it pops (-1: never)"),
			new Prop("string_m", "String", 0.0, 0.0, 2.0, 0.05, "m", "A string from its neck down to a weight (0: no string)"),
			new Prop("weight_g", "Weight on the string", 20.0, 0.0, 500.0, 1.0, "g", "The weight the string is tied to (0: tied to a fixed hook)"),
			new Prop("color", "Colour", "red", { kind: "choice", choices: COLOR_NAMES })
		],
		readouts: [
			new Readout("diameter_cm", "Diameter", { unit: "cm", digits: 1 }), new Readout("pressure_kpa", "Pressure inside", { unit: "kPa", digits: 2, help: "Above the air's outside it" }),
			new Readout("volume_l", "Volume", { unit: "L", digits: 2 }), new Readout("lift_g", "Net lift", { unit: "g", digits: 1, help: "The air's push up minus its weight (+: it rises)" }),
			new Readout("thrust_n", "Jet thrust", { unit: "N", digits: 3, help: "An untied balloon's push from its jet" }), new Readout("popped", "Popped", { unit: "", digits: 0, words: { 0: "no", 1: "yes" } }),
			new Readout("gas_c", "Gas inside", { unit: "°C", digits: 1, help: "It warms or cools toward the air round it (over a hot plate, by ice): warmer gas, a bigger balloon" })
		],
		tags: ["balloon", "party balloon", "helium", "inflate", "deflate", "pop", "burst", "air has mass", "rocket", "air pressure", "latex"],
		description: "A latex party balloon. The gas inside (air or helium) fills it until its pressure (the room's + the rubber's) matches the gas law " +
			"PV = nRT: more gas, a warmer room or less air outside (a vacuum jar) make it bigger, and past 1.3 times its rated size it pops. " +
			"Air in it is heavier than the air it pushes aside, so it sinks slowly; helium floats it up (on a string it pulls up on its weight). " +
			"Untied, its jet sends it flying the way its neck does not point; on a pump it grows until it pops; pricked, it pops. " +
			"Its gas warms or cools toward the air round it (over a hot plate it swells a little, by ice it shrinks); it pops on a surface " +
			"over about 150 °C. In no air, or over-filled, it swells and bursts as soon as it is let go.",
		source: "Ideal gas law with the room's pressure 101.325 kPa; rubber after Merritt & Weinhaus (1978), 3 kPa at its rated size (provisional); " +
			"air 1.2 kg/m³, helium 0.166 kg/m³ at 20 °C.",
		anchor: "its middle", facts: "11-inch latex · 8 L of air · 25 cm · 3 g of rubber"
	}))
}

// ---------------------------------------------------------------- a model hot-air balloon
const ENVELOPES = { "tissue paper": 0.017 * 1.15, "plastic bag": 0.011 }
const STRIPES = ["red and yellow", "blue and white", "green and white", "rainbow"]

function _hot_air() {
	function build(c, P) {
		_upright(c)
		const D = P.size
		const R = D / 2
		const a = 0.18 * D
		const below = Math.sqrt(R * R - a * a)
		const ring_y = 0.30
		const env_y = ring_y + below
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		const steel = c.mat({ base: "steel", overrides: {} })
		c.slab("base", 0.36, 0.02, 0.24, 0.0, 0.01, { kind: "static", material: wood, look: "wood", words: "the launch stand's base" })
		for (const [side, part] of [[-1, "post-left"], [1, "post-right"]]) {
			c.slab(part, 0.008, ring_y - 0.003 - 0.02, 0.008, side * (a + 0.004), 0.02 + (ring_y - 0.003 - 0.02) / 2, { kind: "static", material: steel,
				look: "steel", words: "a wire post of the launch stand" })
		}
		c.slab("gun", 0.07, 0.20, 0.09, 0.0, 0.12, { kind: "static", material: c.mat({ base: "ABS plastic", overrides: {} }), look: "plastic", words: "a heat gun standing on its end" })
		c.slab("gun-nozzle", 0.04, 0.04, 0.04, 0.0, 0.24, { kind: "static", material: steel, look: "steel", words: "the heat gun's nozzle" })
		const gsm = ENVELOPES[P.envelope]
		const area = 4 * Math.PI * R * R
		const m_env = area * gsm
		const wall = 0.00004
		const shell = (4 / 3) * Math.PI * (cube(R) - cube(R - wall))
		const env = c.ball("envelope", R, 0.0, env_y, { wall, material: c.mat({ base: "envelope tissue", density: pyRound(m_env / shell, 3), overrides: {} }),
			look: "tissue", words: `a ${P.envelope} hot-air balloon` })
		const ring_m = 0.003 + P.payload_g / 1000
		const w = 2 * a + 0.02
		_child(c, "ring", env, { kind: "slab", width: _r5(w), height: 0.006, depth: _r5(w) }, [0.0, -below],
			c.mat({ base: "steel", density: pyRound(ring_m / (w * 0.006 * w), 3), overrides: {} }), "steel", "the wire ring round its mouth")
		if (P.tether_m > 0) {
			c.joint("rope", "tether", { a: "ring", b: "base", anchorA: [0.0, 0.0], anchorB: [0.0, 0.01], length: _r5(ring_y - 0.02 + P.tether_m), thickness: 0.001 })
		}
		const inner = R - wall
		c.process("air", "air", {
			role: "hotair", solid: env, ring: c.sid("ring"), name: _name(c), volume: pyRound((4 / 3) * Math.PI * cube(inner), 7), area: pyRound(area, 6),
			U: 3.5, power: P.heater_w, heater: _wp(c, 0.0, 0.26), reach: 0.6, mouth: _r5(a), until: P.heater_off_s, eta: 0.6, start: P.start_c,
			dry: pyRound(m_env + ring_m, 7)
		})
	}
	register(new ItemType("hot-air-balloon", "Model hot-air balloon", CAT, build, {
		dynamic: true, material: "envelope tissue", materials: ["envelope tissue"], module: MODULE,
		props: [
			new Prop("size", "Envelope", 0.9, 0.4, 1.6, 0.05, "m", "Its diameter: a bigger one holds more hot air for its paper"),
			new Prop("envelope", "Made of", "tissue paper", { kind: "choice", choices: Object.keys(ENVELOPES), help: "Tissue paper 17 g/m² (with glued seams) or a thin plastic bag 11 g/m²" }),
			new Prop("heater_w", "Heat gun", 1500.0, 0.0, 2000.0, 50.0, "W", "The heat gun under its mouth (about 60 % of its heat goes in while the mouth is close)"),
			new Prop("heater_off_s", "Heat gun off at", 20.0, 0.0, 20.0, 0.1, "s"),
			new Prop("start_c", "Air inside at the start", 65.0, -20.0, 120.0, 1.0, "°C", "Already warmed by the heat gun before the run starts"),
			new Prop("payload_g", "Payload", 0.0, 0.0, 100.0, 1.0, "g", "Extra weight hung from its ring"),
			new Prop("tether_m", "Tether", 0.0, 0.0, 3.0, 0.05, "m", "A thread from its ring to the stand: how far it can rise (0: free)"),
			new Prop("color", "Stripes", "red and yellow", { kind: "choice", choices: STRIPES })
		],
		readouts: [
			new Readout("inside_c", "Air inside", { unit: "°C", digits: 1 }), new Readout("lift_n", "Hot air's lift", { unit: "N", digits: 3, help: "(ρ_room − ρ_inside)·g·V" }),
			new Readout("net_g", "Net lift", { unit: "g", digits: 1, help: "Hot air's lift minus the envelope, ring and payload (+: it rises)" }),
			new Readout("heating_w", "Heating", { unit: "W", digits: 0 }), new Readout("height_m", "Height", { unit: "m", digits: 2, help: "Its mouth above where it started" })
		],
		tags: ["hot air balloon", "hot air rises", "convection", "density", "warm air", "sky lantern", "heat", "buoyancy", "charles law"],
		description: "A tissue-paper (or plastic-bag) hot-air balloon on a launch stand over a heat gun. Hot air is lighter than the room's air " +
			"(ρ ∝ 1/T at the same pressure), so once the air inside is hot enough its lift beats the envelope's weight and it rises; " +
			"away from the heat gun it cools through its skin and sinks back. Bigger, lighter or hotter rises faster.",
		source: "Ideal gas at constant pressure: ρ_inside = 1.2 kg/m³ × T_room/T_inside; heat loss U·A·ΔT, U 3.5 W/(m²·K) (free convection and " +
			"radiation through a thin skin, provisional); the heat gun's share 60 % within 60 cm (provisional).",
		anchor: "the middle of the launch stand's base", facts: "0.9 m tissue envelope · 50 g · rises above about 58 °C inside"
	}))
}

// ---------------------------------------------------------------- smoke
const SMOKE = { light: [6.0, 4.0], normal: [10.0, 4.8], thick: [12.0, 5.3] }

function _smoke() {
	function build(c, P) {
		_upright(c)
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		c.slab("holder", 0.10, 0.012, 0.025, 0.0, 0.006, { kind: "static", material: wood, look: "wood", words: "an incense holder" })
		c.slab("stick", 0.0025, 0.22, 0.0025, 0.0, 0.012 + 0.11, { kind: "static", material: wood, look: "wood", words: "a burning incense stick" })
		const [rate, life] = SMOKE[P.amount]
		c.process("air", "air", { role: "smoke", name: _name(c), tip: _wp(c, 0.0, 0.232), rate, life, count: Math.min(48, pyRoundInt(rate * life)), lit: P.lit_at, power: 1.5 })
	}
	register(new ItemType("incense-stick", "Incense stick (smoke)", CAT, build, {
		dynamic: false, material: "varnished hardwood", materials: ["varnished hardwood"], module: MODULE,
		props: [new Prop("amount", "Smoke", "normal", { kind: "choice", choices: Object.keys(SMOKE) }), new Prop("lit_at", "Lit at", 0.0, 0.0, 10.0, 0.1, "s")],
		readouts: [
			new Readout("drift_m", "Smoke drifts", { unit: "m", digits: 2, help: "How far its smoke has gone sideways on average (+: to the right)" }),
			new Readout("rise_m", "Smoke rises", { unit: "m", digits: 2, help: "How high above the tip its smoke is on average" })
		],
		tags: ["smoke", "incense", "convection", "air current", "wind", "draft", "see the air", "plume", "rising air"],
		description: "A burning incense stick whose smoke shows how the air moves: it rises in its own warm plume, is carried off by a fan's " +
			"stream or a breeze, rises faster over hot things (a hot plate, a lamp, a hot drink, a heat gun) and sinks over cold ones " +
			"(ice). No air, no smoke.",
		source: "Plumes after Morton, Taylor & Turner (1956): a 1.5 W stick rises about 0.2 m/s 10 cm up; mixing as a random walk " +
			"(eddy diffusivity 0.0005 + 0.01·|wind| m²/s, provisional).",
		anchor: "the middle of its holder's bottom", facts: "10 puffs a second, each lasting 4.8 s"
	}))
}

// ---------------------------------------------------------------- anemometer
function _anemometer() {
	function build(c, P) {
		_upright(c)
		const H = P.height
		const steel = c.mat({ base: "steel", overrides: {} })
		c.slab("base", 0.12, 0.015, 0.12, 0.0, 0.0075, { kind: "static", material: steel, look: "steel", words: "the wind meter's foot" })
		c.slab("pole", 0.012, H, 0.012, 0.0, 0.015 + H / 2, { kind: "static", material: steel, look: "steel", words: "the wind meter's pole" })
		c.slab("head", 0.03, 0.03, 0.03, 0.0, 0.015 + H + 0.015, { kind: "static", material: c.mat({ base: "ABS plastic", overrides: {} }), look: "plastic",
			words: "a cup anemometer's hub" })
		c.process("air", "air", { role: "anemometer", name: _name(c), at: _wp(c, 0.0, 0.015 + H + 0.03), arm: 0.06 })
	}
	register(new ItemType("anemometer", "Wind meter (anemometer)", CAT, build, {
		dynamic: false, material: "steel", materials: ["steel"], module: MODULE,
		props: [new Prop("height", "Cups at", 0.4, 0.1, 1.5, 0.01, "m", "How high its cups are above its foot")],
		readouts: [new Readout("wind_ms", "Wind", { unit: "m/s", digits: 2 }), new Readout("turns", "Cup turns", { unit: "", digits: 1 })],
		tags: ["wind", "wind speed", "anemometer", "measure wind", "weather", "breeze", "fan speed"],
		description: "A cup anemometer on a pole: it reads the air's speed at its cups (a fan's stream, a breeze) and its cups spin with it.",
		source: "Cups turn at about a third of the wind's speed (Robinson's cup factor 2-3).", anchor: "the middle of its foot",
		facts: "reads m/s at its cups"
	}))
}

// ---------------------------------------------------------------- wind tunnel
function _tunnel() {
	function build(c, P) {
		_upright(c)
		const L = P.length
		const H = P.height
		const D = 0.3
		const s = P.blows === "to the right" ? 1.0 : -1.0
		c.slab("floor", L, 0.012, D, 0.0, -0.006, { kind: "static", material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood",
			words: "the wind tunnel's floor" })
		c.slab("roof", L, 0.006, D, 0.0, H + 0.003, { kind: "static", material: c.mat({ base: "glass", overrides: {} }), look: "glass", words: "the wind tunnel's clear top" })
		c.slab("fan-box", 0.12, H + 0.018, D, -s * (L / 2 + 0.06), H / 2, { kind: "static", material: c.mat({ base: "ABS plastic", overrides: {} }), look: "plastic",
			words: "the wind tunnel's fan box" })
		const [x, y] = c.world(-s * L / 2, H / 2)
		c.sb.animated.push({
			kind: "animated", id: `${c.item.id}/wind`, words: "the wind tunnel's stream", sprite: "breeze", item: c.item.id,
			vector: [{ id: "wind", tag: "rect", attrs: { x: 0, y: 0, width: 0.01, height: 0.01, fill: "none" } }],
			at: { x: pyRound(x, 5), y: pyRound(y, 5) }, keys: [{ t: 0.0, angle: 0.0 }],
			airflow: { from: P.on_at, at: { x: 0.0, y: 0.0 }, direction: s > 0 ? 0.0 : pyRound(Math.PI, 6), diameter: _r5(2 * H), speed: P.speed,
				source: "A wind tunnel's fan and straightener: the engine's round jet, 2 × the duct's height across (even within 16 % across it)." },
			depth: 3
		})
	}
	register(new ItemType("wind-tunnel", "Wind tunnel", CAT, build, {
		dynamic: false, material: "glass", materials: ["glass"], module: MODULE,
		props: [
			new Prop("length", "Length", 1.2, 0.5, 2.5, 0.05, "m"), new Prop("height", "Inside height", 0.3, 0.15, 0.6, 0.01, "m"),
			new Prop("speed", "Wind speed", 5.0, 0.0, 15.0, 0.5, "m/s"), new Prop("blows", "Blows", "to the right", { kind: "choice", choices: ["to the right", "to the left"] }),
			new Prop("on_at", "Fan on at", 0.0, 0.0, 10.0, 0.1, "s")
		],
		tags: ["wind tunnel", "wind", "air flow", "drag", "lift", "test", "fan", "aerodynamics", "streamline"],
		description: "A clear-topped wind tunnel with a fan at its upwind end: an even stream of air through it at `speed`. Put things inside it to " +
			"test them in a steady wind: a wind meter reads it, smoke shows it, a kite or a paper airplane on its floor meets it, light things " +
			"blow along.",
		source: "Rajaratnam, Turbulent Jets (1976): a round jet keeps its speed for 6.2 diameters; made 2 × the duct's height across.",
		anchor: "the middle of its floor's top", facts: "1.2 m × 30 cm · 5 m/s"
	}))
}

// ---------------------------------------------------------------- vacuum jar
function _jar() {
	function build(c, P) {
		_upright(c)
		const W = P.width
		const H = P.height
		const steel = c.mat({ base: "steel", overrides: {} })
		const glass = c.mat({ base: "glass", overrides: {} })
		c.slab("plate", W + 0.08, 0.02, W + 0.08, 0.0, 0.01, { kind: "static", material: steel, look: "steel", words: "the vacuum pump's plate" })
		for (const [side, part] of [[-1, "glass-left"], [1, "glass-right"]]) {
			c.slab(part, 0.004, H, W, side * (W / 2 + 0.002), 0.02 + H / 2, { kind: "static", material: glass, look: "glass", words: "the bell jar's glass" })
		}
		c.slab("glass-top", W + 0.008, 0.004, W, 0.0, 0.02 + H + 0.002, { kind: "static", material: glass, look: "glass", words: "the bell jar's glass top" })
		const [x0, y0] = c.world(-W / 2, 0.02)
		const [x1, y1] = c.world(W / 2, 0.02 + H)
		c.process("air", "air", { role: "jar", name: _name(c), x0: pyRound(x0, 6), x1: pyRound(x1, 6), y0: pyRound(y0, 6), y1: pyRound(y1, 6), pump_at: P.pump_at, tau: P.pump_s,
			low: pyRound(P.lowest_kpa * 1000, 3), vent: P.vent_at })
	}
	register(new ItemType("vacuum-jar", "Vacuum jar", CAT, build, {
		dynamic: false, material: "glass", materials: ["glass"], module: MODULE,
		props: [
			new Prop("width", "Inside width", 0.3, 0.15, 0.6, 0.01, "m"), new Prop("height", "Inside height", 0.35, 0.15, 0.8, 0.01, "m"),
			new Prop("pump_at", "Pump starts", 0.5, 0.0, 20.0, 0.1, "s"),
			new Prop("pump_s", "Pumping time", 2.0, 0.2, 20.0, 0.1, "s", "The pressure falls by 63 % every this many seconds"),
			new Prop("lowest_kpa", "Lowest pressure", 2.0, 0.1, 90.0, 0.1, "kPa", "What the pump can get down to (the room is 101.3)"),
			new Prop("vent_at", "Air let back in at", -1.0, -1.0, 20.0, 0.1, "s", "-1: never")
		],
		readouts: [new Readout("pressure_kpa", "Pressure inside", { unit: "kPa", digits: 2 })],
		tags: ["vacuum", "bell jar", "air pressure", "pump", "low pressure", "no air", "vacuum chamber"],
		description: "A glass bell jar on a vacuum pump's plate. From `pump_at` the pump takes the air out: the pressure inside falls toward its " +
			"lowest. Things inside feel it: a balloon swells and pops, a card falls off an upside-down glass of water, a suction cup lets go.",
		source: "A pumped-down volume: P = P_low + (P_room − P_low)·e^(−t/τ), τ = volume ÷ pump speed (a classroom pump: seconds; " +
			"2 kPa lowest, provisional).", anchor: "the middle of its plate's bottom", facts: "30 × 35 cm inside · pumps from 0.5 s"
	}))

	function build_tube(c, P) {
		_upright(c)
		const W = P.width
		const H = P.length
		const steel = c.mat({ base: "steel", overrides: {} })
		const glass = c.mat({ base: "glass", overrides: {} })
		c.slab("base", W + 0.1, 0.03, W + 0.1, 0.0, 0.015, { kind: "static", material: steel, look: "steel", words: "the tube's base, its valve to the pump" })
		for (const [side, part] of [[-1, "wall-left"], [1, "wall-right"]]) {
			c.slab(part, 0.005, H, W, side * (W / 2 + 0.0025), 0.03 + H / 2, { kind: "static", material: glass, look: "glass", words: "the clear tube's wall" })
		}
		c.slab("cap", W + 0.01, 0.01, W, 0.0, 0.03 + H + 0.005, { kind: "static", material: steel, look: "steel", words: "the tube's top cap" })
		const [x0, y0] = c.world(-W / 2, 0.03)
		const [x1, y1] = c.world(W / 2, 0.03 + H)
		// (not pumped: the control, its air the room's; its pump's lowest is the room's own pressure, so nothing changes)
		const low = truthy(P.pumped) ? pyRound(P.lowest_kpa * 1000, 3) : ATM
		c.process("air", "air", { role: "jar", name: _name(c), x0: pyRound(x0, 6), x1: pyRound(x1, 6), y0: pyRound(y0, 6), y1: pyRound(y1, 6), pump_at: P.pump_at,
			tau: P.pump_s, low, vent: P.vent_at })
	}
	register(new ItemType("vacuum-tube", "Vacuum tube (coin and feather)", CAT, build_tube, {
		dynamic: false, material: "glass", materials: ["glass"], module: MODULE,
		props: [
			new Prop("length", "Tube height", 1.5, 0.5, 2.0, 0.05, "m"), new Prop("width", "Inside width", 0.3, 0.06, 0.5, 0.01, "m"),
			new Prop("pumped", "Air pumped out", true, { kind: "bool", help: "Off: the control, the tube keeps the room's air" }),
			new Prop("pump_at", "Pump starts", 0.0, 0.0, 20.0, 0.1, "s"),
			new Prop("pump_s", "Pumping time", 0.4, 0.1, 10.0, 0.1, "s", "The pressure falls by 63 % every this many seconds"),
			new Prop("lowest_kpa", "Lowest pressure", 0.1, 0.01, 90.0, 0.01, "kPa", "What the pump gets down to (the room is 101.3; 0.1 kPa: a feather falls like a coin)"),
			new Prop("vent_at", "Air let back in at", -1.0, -1.0, 20.0, 0.1, "s", "-1: never")
		],
		readouts: [new Readout("pressure_kpa", "Pressure inside", { unit: "kPa", digits: 2 })],
		tags: ["vacuum tube", "coin and feather", "guinea and feather", "feather and coin", "free fall", "falling", "air resistance", "vacuum",
			"galileo", "drag", "fall together"],
		description: "A tall clear tube on a vacuum pump's base: its pump takes the air out of it from `pump_at`. Inside it the air's drag and " +
			"buoyancy fall with the pressure, so a feather and a coin let go together at its top (held, released after the pump is done) " +
			"fall together in the pumped tube; with its air (pumped false) the feather drifts down far behind the coin. Only the " +
			"inside of the tube is a vacuum: the room keeps its air.",
		source: "A pumped-down volume: P = P_low + (P_room − P_low)·e^(−t/τ) (a classroom 'guinea and feather' tube pumps down in seconds: " +
			"0.1 kPa lowest, provisional); drag and buoyancy ∝ the air's density, ∝ its pressure at the room's temperature.",
		anchor: "the middle of its base's bottom", facts: "1.5 m × 30 cm inside · pumped down from 0 s"
	}))
}

// ---------------------------------------------------------------- air pressure: a card under a glass of water, a suction cup, a steam can
const CARDS = { "index card": 0.002, "playing card": 0.0018, cardboard: 0.006, "plastic lid": 0.004 }
const SURFACES = { glass: 35000.0, "glazed tile": 30000.0, "painted wall": 10000.0, wood: 0.0 }

function _pressure() {
	function build_card(c, P) {
		_upright(c)
		const Dg = P.diameter
		const Hg = P.height
		const S = P.stand_height
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		const steel = c.mat({ base: "steel", overrides: {} })
		const glass = c.mat({ base: "glass", overrides: {} })
		const mouth = 0.02 + S
		c.slab("base", 0.22, 0.02, 0.16, 0.0, 0.01, { kind: "static", material: wood, look: "wood", words: "a stand's base" })
		c.slab("post", 0.016, S + Hg + 0.02, 0.016, -0.09, 0.02 + (S + Hg + 0.02) / 2, { kind: "static", material: steel, look: "steel", words: "the stand's post" })
		c.slab("clamp", 0.09 - Dg / 2 + 0.01, 0.015, 0.02, -0.09 + (0.09 - Dg / 2 + 0.01) / 2, mouth + Hg - 0.02, { kind: "static", material: steel, look: "steel",
			words: "a clamp holding the glass" })
		for (const [side, part] of [[-1, "glass-left"], [1, "glass-right"]]) {
			c.slab(part, 0.003, Hg, Dg, side * (Dg / 2 - 0.0015), mouth + Hg / 2, { kind: "static", material: glass, look: "glass", words: "an upside-down drinking glass" })
		}
		const top = c.slab("glass-top", Dg, 0.006, Dg, 0.0, mouth + Hg - 0.003, { kind: "static", material: glass, look: "glass", words: "the glass's bottom, upside down" })
		const w = Dg + 0.02
		const m = CARDS[P.card]
		const card = c.slab("card", w, 0.0015, w, 0.0, mouth - 0.00125, { material: c.mat({ base: "index card", density: pyRound(m / (w * 0.0015 * w), 3), overrides: {} }),
			look: "index card", words: `a ${P.card} over the glass's mouth` })
		const inner = Dg - 0.006
		const area = (Math.PI * inner * inner) / 4
		const col = (Hg - 0.006) * P.water
		c.process("air", "air", {
			role: "card", solid: card, glass: top, name: _name(c), area: pyRound(area, 8), water_h: pyRound(col, 6),
			air_v: pyRound(Math.max(1e-7, (Hg - 0.006 - col) * area), 9), seal: 0.002, water: P.water, axis: { x: 0.0, y: 1.0 },
			at: _wp(c, 0.0, mouth - 0.00125), mouth_down: true
		})
	}
	register(new ItemType("card-glass", "Upside-down glass of water and card", CAT, build_card, {
		dynamic: true, material: "glass", materials: ["glass"], module: MODULE,
		props: [
			new Prop("water", "Water", 0.8, 0.0, 1.0, 0.05, "", "How full the glass is (1 = full, 0 = empty)"),
			new Prop("diameter", "Glass width", 0.07, 0.05, 0.10, 0.005, "m"), new Prop("height", "Glass height", 0.12, 0.08, 0.16, 0.005, "m"),
			new Prop("card", "Card", "index card", { kind: "choice", choices: Object.keys(CARDS) }),
			new Prop("stand_height", "Glass's mouth above the base", 0.3, 0.1, 0.6, 0.01, "m")
		],
		readouts: [
			new Readout("holding", "Card held up", { unit: "", digits: 0, words: { 0: "no", 1: "yes" } }), new Readout("push_n", "Air's push on the card", { unit: "N", digits: 1 }),
			new Readout("inside_kpa", "Trapped air", { unit: "kPa", digits: 2 }), new Readout("outside_kpa", "Air outside", { unit: "kPa", digits: 2 }),
			new Readout("water", "Water left", { unit: "", digits: 2 })
		],
		tags: ["air pressure", "card trick", "upside down glass", "water", "atmospheric pressure", "vacuum", "glass of water"],
		description: "A glass of water held upside down by a clamp with a card over its mouth. The air pushes up on the card far harder than the " +
			"water weighs (about 390 N on a 7 cm mouth), so the card stays: the trapped air stretches only a fraction of a millimetre. " +
			"With no water (no seal), or with the air gone (a vacuum, a vacuum jar pumped down), the card falls and the water pours out.",
		source: "P_room·A against ρ·g·h·A + the card's weight; the trapped air expands as P·V = const; the water bridges about a 2 mm gap " +
			"(about water's capillary length, provisional).", anchor: "the middle of the stand's base", facts: "7 cm glass · 80 % full · index card"
	}))

	function build_cup(c, P) {
		_upright(c)
		const D = P.diameter
		const H = P.height
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		const steel = c.mat({ base: "steel", overrides: {} })
		const surf = P.surface
		const panel_mat = surf === "glass" || surf === "glazed tile" ? c.mat({ base: "glass", overrides: {} }) : wood
		const look = { glass: "glass", "glazed tile": "ceramic", "painted wall": "paperboard", wood: "wood" }[surf]
		c.slab("base", 0.30, 0.02, 0.20, 0.0, 0.01, { kind: "static", material: wood, look: "wood", words: "a stand's base" })
		c.slab("post", 0.025, H, 0.025, -0.12, 0.02 + H / 2, { kind: "static", material: steel, look: "steel", words: "the stand's post" })
		const yp = 0.02 + H
		const panel = c.slab("panel", 0.30, 0.008, 0.20, 0.0, yp + 0.004, { kind: "static", material: panel_mat, look, words: `a sheet of ${surf}` })
		const pts = [[-0.1 * D, -0.38 * D], [0.1 * D, -0.38 * D], [0.3 * D, -0.25 * D], [0.5 * D, -0.03 * D], [0.5 * D, 0.0], [-0.5 * D, 0.0], [-0.5 * D, -0.03 * D],
			[-0.3 * D, -0.25 * D]]
		const cup_m = 0.005 * (D / 0.05) * (D / 0.05)
		let area_side = 0.0
		for (let k = 0; k < pts.length; k++) {
			const [x1, y1] = pts[k]
			const [x2, y2] = pts[(k + 1) % pts.length]
			area_side += x1 * y2 - x2 * y1
		}
		area_side = Math.abs(area_side) / 2
		const cup = c.poly("cup", pts, _r5(D), 0.05, yp, { material: c.mat({ base: "suction cup vinyl", density: pyRound(cup_m / (area_side * D), 3), overrides: {} }),
			look: "cup vinyl", words: "a suction cup pressed on the sheet" })
		const load = P.load_kg + 0.05
		const w = load <= 2 ? 0.06 : 0.06 + 0.012 * (load - 2)
		const h = load / (7850.0 * w * w)
		const knob = yp - 0.38 * D
		// (the weight on its 12 cm string: one rigid body with the cup, the string drawn by the cup's model: machines/mod_air.py)
		_child(c, "weight", cup, { kind: "slab", width: _r5(w), height: _r5(h), depth: _r5(w) }, [0.0, -0.38 * D - 0.12 - h / 2],
			c.mat({ base: "steel", density: 7850.0, overrides: {} }), "steel", "a weight on a hanger")
		void knob
		c.process("air", "air", { role: "cup", solid: cup, plate: panel, name: _name(c), area: pyRound((Math.PI * D * D) / 4, 8), dp: SURFACES[surf], axis: { x: 0.0, y: 1.0 },
			at: _wp(c, 0.05, yp) })
	}
	register(new ItemType("suction-cup", "Suction cup holding a weight", CAT, build_cup, {
		dynamic: true, material: "suction cup vinyl", materials: ["suction cup vinyl"], module: MODULE,
		props: [
			new Prop("diameter", "Cup diameter", 0.05, 0.02, 0.10, 0.005, "m"),
			new Prop("surface", "Stuck to", "glass", { kind: "choice", choices: Object.keys(SURFACES), help: "Smooth glass and tile seal well; paint leaks; wood is too rough to stick" }),
			new Prop("load_kg", "Weight hung on it", 1.0, 0.0, 10.0, 0.1, "kg"), new Prop("height", "Sheet height", 0.6, 0.25, 1.2, 0.01, "m")
		],
		readouts: [
			new Readout("holding", "Holding", { unit: "", digits: 0, words: { 0: "no", 1: "yes" } }), new Readout("hold_n", "Most it can hold", { unit: "N", digits: 1, help: "The air's push on it: the vacuum under it × its area" }),
			new Readout("pull_n", "Pull on it", { unit: "N", digits: 1 })
		],
		tags: ["suction cup", "air pressure", "vacuum", "sticks", "hook", "atmospheric pressure", "weight"],
		description: "A suction cup pressed onto the underside of a sheet (glass, tile, painted board or wood) with a weight hanging from it. It " +
			"is held up by the air's push on it (the room's pressure over the partial vacuum under it): a 5 cm cup on glass holds " +
			"about 69 N (7 kg). Heavier, it lets go; on wood it never sticks; in a vacuum jar it falls.",
		source: "Holding force Δp·A, Δp the working vacuum of a push-on cup: glass 35 kPa, glazed tile 30, painted wall 10, wood 0 " +
			"(pull tests hold 30-60 % of 1 atm × area: provisional).", anchor: "the middle of the stand's base", facts: "5 cm cup on glass · holds about 7 kg"
	}))

	function build_can(c, P) {
		_upright(c)
		const gap = P.gap
		const steel = c.mat({ base: "steel", overrides: {} })
		const glass = c.mat({ base: "glass", overrides: {} })
		c.slab("stove", 0.20, 0.06, 0.20, 0.0, 0.03, { kind: "static", material: steel, look: "steel", words: "a camping stove, burning" })
		const Hc = 0.122
		const Dc = 0.066
		const mass = 0.0149 + 0.015
		const can = c.slab("can", Dc, Hc, Dc, 0.0, 0.06 + Hc / 2, { material: c.mat({ base: "can aluminium", density: pyRound(mass / (Dc * Hc * Dc), 3), overrides: {} }),
			look: "can paint", words: "a soda can with a little water in it" })
		c.slab("bowl", 0.26, 0.01, 0.2, gap, 0.005, { kind: "static", material: glass, look: "glass", words: "a glass dish of cold water" })
		for (const [side, part] of [[-1, "bowl-left"], [1, "bowl-right"]]) {
			c.slab(part, 0.006, 0.09, 0.2, gap + side * 0.127, 0.01 + 0.045, { kind: "static", material: glass, look: "glass", words: "the dish's side" })
		}
		const water = 0.01 + 0.06
		const top = 0.06 + Hc / 2
		c.process("air", "air", {
			role: "can", solid: can, name: _name(c), dip: P.dip_at, boil_s: P.boil_s, boiled: P.boil_s > 0, bath: P.bath_c,
			lift: _wp(c, 0.0, top + 0.16), over: _wp(c, gap, top + 0.16), dunk: _wp(c, gap, water - 0.03 + Hc / 2), water_y: pyRound(c.world(0.0, water)[1], 6),
			dish: { x0: pyRound(c.world(gap - 0.124, 0.0)[0], 6), x1: pyRound(c.world(gap + 0.124, 0.0)[0], 6) }, height: Hc, diameter: Dc, length: 0.115, wall: 0.000097, E_gpa: 69.0, nu: 0.33
		})
	}
	register(new ItemType("steam-can", "Can crushed by air pressure", CAT, build_can, {
		dynamic: true, material: "can aluminium", materials: ["can aluminium"], module: MODULE,
		props: [
			new Prop("boil_s", "Boiled for", 30.0, 0.0, 120.0, 1.0, "s", "How long its little water boiled on the stove: the steam pushes the air out (0: not heated)"),
			new Prop("bath_c", "Dish water", 2.0, 0.0, 90.0, 1.0, "°C"), new Prop("dip_at", "Dunked at", 1.0, 0.2, 10.0, 0.1, "s"),
			new Prop("gap", "Dish from the stove", 0.35, 0.25, 0.6, 0.01, "m")
		],
		readouts: [
			new Readout("crushed", "Crushed", { unit: "", digits: 2, help: "The share of its volume pushed in" }), new Readout("inside_kpa", "Pressure inside", { unit: "kPa", digits: 1 }),
			new Readout("temp_c", "Inside", { unit: "°C", digits: 1 }), new Readout("steaming", "Steaming", { unit: "", digits: 0, words: { 0: "no", 1: "yes" } })
		],
		tags: ["can crush", "air pressure", "steam", "condensation", "implosion", "atmospheric pressure", "vacuum", "soda can"],
		description: "A soda can with a little water boiled in it on a camping stove: its steam pushes the air out. At `dip_at` tongs turn it " +
			"mouth-down into a dish of cold water: the steam condenses, the pressure inside falls to a few kPa, and the room's air " +
			"(101 kPa) crushes it with a bang. Not boiled, nothing happens.",
		source: "Water's vapour pressure (Buck); the air left after boiling e^(−t/8 s), at least 3 % (provisional); the wall buckles at 8.7 kPa " +
			"below the room (Windenburg & Trilling, 0.097 mm aluminium); cooling under water τ 0.15 s (provisional).",
		anchor: "the middle of the stove's foot", facts: "355 mL can · boiled 30 s · dunked at 1 s into 2 °C water"
	}))
}

// ---------------------------------------------------------------- things that fly: paper airplanes, gliders, kites
// (machines/mod_air.py DESIGNS: each surface's aerodynamic centre from the balance point, chord, share of the wing area, aspect ratio)
export const DESIGNS = {
	dart: { span: 0.13, S: 0.0164, sheet: 0.06237, mass: null, cd0: 0.03, depth: 0.006, wing: [0.0113, 0.16, 0.75, 1.03], tail: [-0.11, 0.048, 0.25, 1.03],
		outline: [[0.132, 0.0015], [-0.148, 0.004], [-0.148, -0.006], [0.0, -0.022]] },
	glider: { span: 0.22, S: 0.028, sheet: 0.06237, mass: null, cd0: 0.03, depth: 0.006, wing: [0.0138, 0.15, 0.78, 1.73], tail: [-0.12, 0.05, 0.22, 1.73],
		outline: [[0.13, 0.0015], [-0.15, 0.004], [-0.15, -0.006], [0.02, -0.018]] },
	"balsa glider": { span: 0.30, S: 0.0192, sheet: null, mass: 0.008, cd0: 0.02, depth: 0.004, wing: [0.01155, 0.05, 0.78, 6.0], tail: [-0.17, 0.035, 0.22, 3.4],
		outline: [[0.12, 0.002], [-0.16, 0.004], [-0.16, -0.004], [0.10, -0.008]] }
}
/** The x of a polygon's centroid (machines/mod_air.py _centroid_x). */
function _centroid_x(pts) {
	let a = 0.0
	let cx = 0.0
	const n = pts.length
	for (let k = 0; k < n; k++) {
		const [x1, y1] = pts[k]
		const [x2, y2] = pts[(k + 1) % n]
		const cr = x1 * y2 - x2 * y1
		a += cr
		cx += (x1 + x2) * cr
	}
	return cx / (3 * a)
}
const PAPER = ["white", "yellow", "pink", "blue", "green"]

function _flyers() {
	function build_plane(c, P) {
		const d = DESIGNS[P.design]
		const face = P.facing === "right" ? 1.0 : -1.0
		const a = P.launch_angle * D2R
		c.a = face * a
		c.ca = cos(c.a)
		c.sa = sin(c.a)
		let pts = d.outline.map(([x, y]) => [face * x, y])
		if (face < 0) pts = [pts[0], ...pts.slice(1).reverse()]
		const mass = d.mass !== null ? d.mass : (d.sheet * P.paper_gsm) / 1000
		let area = 0.0
		for (let k = 0; k < pts.length; k++) {
			const [x1, y1] = pts[k]
			const [x2, y2] = pts[(k + 1) % pts.length]
			area += x1 * y2 - x2 * y1
		}
		area = Math.abs(area) / 2
		const base = P.design === "balsa glider" ? "balsa" : "folded paper"
		const look = base === "balsa" ? "balsa" : "folded paper"
		const color = base === "balsa" ? null : COLORS[P.color]
		const extra = truthy(color) ? { color } : {}
		const sid = c.poly("plane", pts, d.depth, 0.0, 0.0, { material: c.mat({ base, density: pyRound(mass / (area * d.depth), 3), overrides: {} }), look,
			words: `a ${P.design}`, ...extra })
		const parts = [sid]
		const clips = Math.trunc(P.nose_clips)
		if (clips > 0) {
			parts.push(_child(c, "clips", sid, { kind: "slab", width: 0.03, height: 0.004, depth: 0.008 }, [face * 0.105, -0.004],
				c.mat({ base: "steel", density: pyRound((clips * 0.0005) / (0.03 * 0.004 * 0.008), 3), overrides: {} }), "steel", `${clips} paper clip${clips > 1 ? "s" : ""} on its nose`))
		}
		const surfaces = []
		const cx = _centroid_x(d.outline)
		for (const [key, inc] of [["wing", 0.0], ["tail", -P.elevator * D2R]]) {
			const [ac, chord, share, AR] = d[key]
			const lx = cx + ac + 0.25 * chord // its leading edge, a quarter chord ahead of its aerodynamic centre
			const ang = face > 0 ? inc : Math.PI - inc
			surfaces.push({ lx: pyRound(face * lx, 6) + 0.0, ly: 0.003, ang: pyRound(ang, 6) + 0.0, c: chord, S: pyRound(d.S * share, 6), AR, cd0: d.cd0 })
		}
		const v = P.launch_speed
		c.process("air", "air", { role: "glider", solid: sid, parts, name: _name(c), surfaces, launch: { x: pyRound(face * v * cos(a), 6) + 0.0, y: pyRound(v * sin(a), 6) + 0.0 } })
	}
	register(new ItemType("paper-airplane", "Paper airplane", CAT, build_plane, {
		material: "folded paper", materials: ["folded paper"], module: MODULE,
		props: [
			new Prop("design", "Design", "dart", { kind: "choice", choices: Object.keys(DESIGNS), help: "A narrow dart, a broad-winged paper glider, or a balsa glider" }),
			new Prop("launch_speed", "Thrown at", 5.0, 0.0, 15.0, 0.1, "m/s"),
			new Prop("launch_angle", "Thrown up at", 5.0, -30.0, 60.0, 0.5, "°", "Its nose and its throw this far above the level"),
			new Prop("elevator", "Tail flaps up", 5.0, -15.0, 15.0, 0.5, "°", "Bent up, its nose rises and it flies slower; down, it dives"),
			new Prop("nose_clips", "Paper clips on the nose", 0, 0, 4, 1, "", "Each 0.5 g: more weight in front makes it steadier and faster", { kind: "int" }),
			new Prop("paper_gsm", "Paper", 80.0, 60.0, 160.0, 5.0, "g/m²", "A4 copy paper is 80 g/m² (a 5 g plane)"),
			new Prop("facing", "Flies to the", "right", { kind: "choice", choices: ["right", "left"] }),
			new Prop("color", "Paper colour", "white", { kind: "choice", choices: PAPER })
		],
		readouts: [
			new Readout("distance_m", "Distance", { unit: "m", digits: 2, help: "How far along the floor from where it was thrown to where it landed" }),
			new Readout("speed_ms", "Speed", { unit: "m/s", digits: 2 }), new Readout("height_m", "Height", { unit: "m", digits: 2, help: "Above where it was thrown from" }),
			new Readout("flying", "Flying", { unit: "", digits: 0, words: { 0: "no", 1: "yes" } }), new Readout("aoa_deg", "Wing's angle to the air", { unit: "°", digits: 1 })
		],
		tags: ["paper airplane", "paper plane", "glider", "lift", "drag", "flight", "wings", "balsa glider", "aerodynamics", "dart"],
		description: "A folded paper airplane (or a balsa glider) thrown at the release: its wings' lift holds it up while drag slows it, so it " +
			"glides down and lands some metres away. Throwing faster or a little higher, a glider's broad wings, a little up-bent tail " +
			"or a paper clip on the nose (steadier) change how far it goes. It needs air: in a vacuum it falls like a stone.",
		source: "Flat-plate wings: Helmbold's lift slope, crossflow (Polhamus), stall (Torres & Mueller 2004), centre of pressure 25 % → 50 % " +
			"of the chord (Hoerner); skin friction 0.03 (paper). A 5 g A4 dart glides at about 4-5 m/s.",
		anchor: "its balance point (where it is thrown from)", facts: "A4 dart · 5 g · thrown at 5 m/s"
	}))

	function build_kite(c, P) {
		_upright(c)
		const Lk = P.size
		const W = 0.85 * Lk
		const line = P.line_m
		const right = P.toward === "right"
		c.slab("stake", 0.012, 0.06, 0.012, 0.0, 0.03, { kind: "static", material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood",
			words: "a stake the kite's line is tied to" })
		const elev = 50 * D2R
		const bx = (right ? 1.0 : -1.0) * line * cos(elev)
		const by = 0.06 + line * sin(elev)
		const th = right ? (180 - 30) * D2R : 30 * D2R
		const xb = Lk / 2 - P.bridle * Lk
		const ox = bx - xb * cos(th)
		const oy = by - xb * sin(th)
		const S = 0.5 * Lk * W
		const m = S * 0.04 + (Lk + W) * 0.010
		const pts = [[-Lk / 2, -0.004], [Lk / 2, -0.004], [Lk / 2, 0.004], [-Lk / 2, 0.004]]
		const kite = c.poly("kite", pts, 0.008, ox, oy, th / D2R, { material: c.mat({ base: "kite (spars and ripstop)", density: pyRound(m / (Lk * 0.008 * 0.008), 3), overrides: {} }),
			look: "ripstop", color: COLORS[P.color], words: "a diamond kite" })
		c.joint("rope", "line", { a: "kite", b: "stake", anchorA: [_r5(xb), 0.0], anchorB: [0.0, 0.03], length: _r5(line), thickness: 0.001 })
		c.process("air", "air", {
			role: "kite", solid: kite, name: _name(c), surface: { lx: _r5(Lk / 2), ly: 0.0, ang: 0.0, c: _r5(Lk), S: pyRound(S, 6), AR: pyRound((W * W) / S, 6), cd0: 0.02 },
			tail: { lx: _r5(-Lk / 2), ly: 0.0, area: pyRound(P.tail_m * 0.03, 6), cd: 0.1 }, stake: _wp(c, 0.0, 0.06), line
		})
	}
	register(new ItemType("kite", "Kite", CAT, build_kite, {
		dynamic: true, material: "kite (spars and ripstop)", materials: ["kite (spars and ripstop)"], module: MODULE,
		props: [
			new Prop("size", "Height", 0.7, 0.4, 1.2, 0.05, "m", "A diamond kite this tall, 85 % as wide"),
			new Prop("line_m", "Line", 1.5, 0.5, 4.0, 0.05, "m"), new Prop("tail_m", "Tail", 1.0, 0.0, 3.0, 0.1, "m", "A 3 cm ribbon: its drag keeps the kite pointing into the wind"),
			new Prop("bridle", "Line tied at", 0.3, 0.15, 0.5, 0.01, "", "Where along its spine the line pulls, from its nose (a share of its height)"),
			new Prop("toward", "Flies to the", "right", { kind: "choice", choices: ["right", "left"], help: "Downwind: the wind must blow that way" }),
			new Prop("color", "Colour", "red", { kind: "choice", choices: COLOR_NAMES })
		],
		readouts: [
			new Readout("height_m", "Height", { unit: "m", digits: 2, help: "Above its stake" }), new Readout("line_angle_deg", "Line's angle", { unit: "°", digits: 0 }),
			new Readout("pull_n", "Pull on the line", { unit: "N", digits: 2 }), new Readout("wind_ms", "Wind at the kite", { unit: "m/s", digits: 2 }),
			new Readout("flying", "Flying", { unit: "", digits: 0, words: { 0: "no", 1: "yes" } })
		],
		tags: ["kite", "wind", "lift", "drag", "flying", "tail", "string", "breeze", "aerodynamics"],
		description: "A diamond kite on a line tied to a stake. Wind on its face lifts it and pushes it downwind; its line holds it, so it climbs until " +
			"lift, drag, its weight and the line's pull balance; its tail keeps it steady. It needs wind blowing toward `toward` (a breeze, " +
			"or a big fan): no wind, it falls.",
		source: "Low-aspect-ratio flat plate (Polhamus's normal force with Helmbold's slope; crossflow 1.2, Hoerner); centre of pressure 25 % → " +
			"50 % of its height; tail ribbon C_d 0.1 on its area (provisional); a 70 cm kite about 25 g.",
		anchor: "the foot of its stake", facts: "70 cm diamond · 1.5 m line · 1 m tail"
	}))
}

// ---------------------------------------------------------------- goals (machines/mod_air.py reports the same, number for number)
const _when = (by) => (by === null ? "" : ` by ${fmtF(by, 2).replace(/0+$/, "").replace(/\.$/, "")} s`)
const _num_text = (v) => fmtF(v, 2).replace(/0+$/, "").replace(/\.$/, "")
function _last(ctx, iid, key) {
	const v = ctx.state(iid, key)
	return v && v.length ? v[v.length - 1] : null
}
const _label = (g, text) => (truthy(g.label) ? g.label : text)
// (for the AI's label of a goal without one, the same words as these summaries: a number or null, and a length as web/sim/items.js _short_m)
const _fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
function _m_text(m) {
	let t = m >= 1 ? fmtF(m, 2) : fmtF(m * 100, 1)
	if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, "")
	return m >= 1 ? `${t} m` : `${t} cm`
}

export function pops(ctx, g) {
	if (!ctx.known(g.item)) return null
	const by = ctx.num(g.before_s)
	const t = ctx.first_time(g.item, "popped", (v) => v >= 1)
	const happened = t !== null && (by === null || t <= by)
	if (g.expect === false) return { label: _label(g, `${ctx.name(g.item)} does not pop${_when(by)}`), ok: !happened, kind: "pops", item: g.item, t: t === null ? null : pyRound(t, 3) }
	return { label: _label(g, `${ctx.name(g.item)} pops${_when(by)}`), ok: happened, kind: "pops", item: g.item, t: t === null ? null : pyRound(t, 3) }
}
export function rises(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.at_least_m)
	least = least === null ? 0.2 : least
	const sids = ctx.solids(g.item, true).map((s) => s.id)
	let best = 0.0
	if (sids.length) {
		const mean = (f) => {
			let s = 0
			for (const i of sids) s += f.placements[i].y
			return s / sids.length
		}
		const y0 = mean(ctx.frames[0])
		for (const f of ctx.frames) {
			const y = mean(f)
			if (y - y0 > best) best = y - y0
		}
	}
	const up = sids.length > 0 && best >= least
	if (g.expect === false) return { label: _label(g, `${ctx.name(g.item)} does not rise ${ctx.short_m(least)}`), ok: !up, kind: "lifts_off", item: g.item, rose_m: pyRound(best, 4) }
	return { label: _label(g, `${ctx.name(g.item)} rises at least ${ctx.short_m(least)}`), ok: up, kind: "lifts_off", item: g.item, rose_m: pyRound(best, 4) }
}
export function crushes(ctx, g) {
	if (!ctx.known(g.item)) return null
	const by = ctx.num(g.before_s)
	const t = ctx.first_time(g.item, "crushed", (v) => v >= 0.05)
	const happened = t !== null && (by === null || t <= by)
	if (g.expect === false) return { label: _label(g, `${ctx.name(g.item)} is not crushed${_when(by)}`), ok: !happened, kind: "crushes", item: g.item, t: t === null ? null : pyRound(t, 3) }
	return { label: _label(g, `${ctx.name(g.item)} is crushed${_when(by)}`), ok: happened, kind: "crushes", item: g.item, t: t === null ? null : pyRound(t, 3) }
}
export function holds(ctx, g) {
	if (!ctx.known(g.item)) return null
	const v = _last(ctx, g.item, "holding")
	return { label: _label(g, `${ctx.name(g.item)} holds to the end`), ok: v === 1, kind: "stays_held", item: g.item }
}
export function lets_go(ctx, g) {
	if (!ctx.known(g.item)) return null
	const by = ctx.num(g.before_s)
	const t = ctx.first_time(g.item, "holding", (v) => v < 0.5)
	return { label: _label(g, `${ctx.name(g.item)} lets go${_when(by)}`), ok: t !== null && (by === null || t <= by), kind: "lets_go", item: g.item, t: t === null ? null : pyRound(t, 3) }
}
export function glides(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.at_least_m)
	least = least === null ? 1.0 : least
	const v = _last(ctx, g.item, "distance_m")
	return { label: _label(g, `${ctx.name(g.item)} flies at least ${ctx.short_m(least)}`), ok: v !== null && v >= least, kind: "glides", item: g.item, distance_m: v === null ? null : pyRound(v, 3) }
}
export function kite_flies(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.at_least_m)
	least = least === null ? 0.5 : least
	const v = ctx.state(g.item, "height_m")
	let low = null
	if (v && v.length) {
		let tail = v.slice(Math.trunc(v.length * 0.7))
		if (!tail.length) tail = v.slice(-1)
		low = Math.min(...tail)
	}
	const up = low !== null && low >= least
	if (g.expect === false) return { label: _label(g, `${ctx.name(g.item)} does not stay up ${ctx.short_m(least)} above its stake`), ok: !up, kind: "kite_flies", item: g.item,
		low_m: low === null ? null : pyRound(low, 3) }
	return { label: _label(g, `${ctx.name(g.item)} stays up at least ${ctx.short_m(least)} above its stake`), ok: up, kind: "kite_flies", item: g.item,
		low_m: low === null ? null : pyRound(low, 3) }
}
export function wind_reads(ctx, g) {
	if (!ctx.known(g.item)) return null
	const lo = ctx.num(g.at_least)
	const hi = ctx.num(g.at_most)
	const v = _last(ctx, g.item, "wind_ms")
	const ok = v !== null && (lo === null || v >= lo - 1e-9) && (hi === null || v <= hi + 1e-9)
	const bounds = (lo !== null ? ` at least ${_num_text(lo)} m/s` : "") + (hi !== null ? ` at most ${_num_text(hi)} m/s` : "")
	return { label: _label(g, `${ctx.name(g.item)} reads${bounds || " a wind"}`), ok, kind: "wind_reads", item: g.item, wind_ms: v === null ? null : pyRound(v, 2) }
}
export function smoke_drifts(ctx, g) {
	if (!ctx.known(g.item)) return null
	const way = ["left", "right", "up", "down"].includes(g.toward) ? g.toward : "up"
	const dx = _last(ctx, g.item, "drift_m")
	const dy = _last(ctx, g.item, "rise_m")
	let ok = false
	if (dx !== null && dy !== null) ok = (way === "right" && dx >= 0.05) || (way === "left" && dx <= -0.05) || (way === "up" && dy >= 0.1 && Math.abs(dx) < dy) || (way === "down" && dy <= -0.03)
	return { label: _label(g, `${ctx.name(g.item)}'s smoke drifts ${way}`), ok, kind: "smoke_drifts", item: g.item, toward: way, drift_m: dx === null ? null : pyRound(dx, 3),
		rise_m: dy === null ? null : pyRound(dy, 3) }
}
export function glides_farther(ctx, g) {
	const a = g.a
	const b = g.b
	if (!(ctx.known(a) && ctx.known(b))) return null
	const by = ctx.num(g.by_m)
	const margin = by === null ? 0.05 : Math.max(0.0, by)
	const da = _last(ctx, a, "distance_m")
	const db = _last(ctx, b, "distance_m")
	// (b must have landed, its distance final; a may still be flying, already farther)
	const ok = da !== null && db !== null && _last(ctx, b, "flying") === 0 && da >= db + margin
	const more = by === null ? "" : ` by at least ${ctx.short_m(margin)}`
	return { label: _label(g, `${ctx.name(a)} flies farther than ${ctx.name(b)}${more}`), ok, kind: "glides_farther", a, b, item: a,
		distance_a: da === null ? null : pyRound(da, 3), distance_b: db === null ? null : pyRound(db, 3) }
}
export function rises_faster(ctx, g) {
	const a = g.a
	const b = g.b
	if (!(ctx.known(a) && ctx.known(b))) return null
	const ra = _rise(ctx, a)
	const rb = _rise(ctx, b)
	const ok = ra !== null && rb !== null && ra >= rb + Math.max(RISE_MARGIN, 0.2 * Math.abs(rb))
	return { label: _label(g, `${ctx.name(a)} rises faster than ${ctx.name(b)}`), ok, kind: "rises_faster", a, b, item: a,
		rise_a: ra === null ? null : pyRound(ra, 3), rise_b: rb === null ? null : pyRound(rb, 3) }
}
export function jets(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const way = ["left", "right", "up", "down"].includes(g.toward) ? g.toward : null
	let least = ctx.num(g.at_least_m)
	least = least === null ? 0.5 : least
	const untied = (ctx.doc.processes ?? []).some((p) => p.kind === "air" && p.role === "balloon" && p.item === iid && p.tied === false)
	const th = ctx.state(iid, "thrust_n") ?? []
	const push = th.length ? Math.max(...th) : 0.0
	const best = _travel(ctx, iid, way)
	let ok = untied && push > 0 && best !== null && best >= least
	const where = way ? ` ${way}` : " sideways"
	let label = `${ctx.name(iid)} jets${where} at least ${ctx.short_m(least)} on its own air`
	if (g.expect === false) {
		ok = !ok
		label = `${ctx.name(iid)} does not jet${where} ${ctx.short_m(least)}`
	}
	return { label: _label(g, label), ok, kind: "jets", item: iid,
		toward: way, untied, travel_m: best === null ? null : pyRound(best, 3), thrust_n: pyRound(push, 4) }
}
export const swells = (ctx, g) => _size_goal(ctx, g, true)
export const shrinks = (ctx, g) => _size_goal(ctx, g, false)
// how much more one thing must rise than another to rise faster: 5 cm and 20 % more (machines/mod_air.py RISE_MARGIN)
const RISE_MARGIN = 0.05
function _mean(v) {
	let t = 0.0
	for (const y of v) t += y
	return t / v.length
}
function _rise(ctx, iid) {
	const v = ctx.state(iid, "rise_m")
	if (v && v.length) {
		let tail = v.slice(Math.trunc(v.length / 2))
		if (!tail.length) tail = v.slice(-1)
		return _mean(tail)
	}
	const sids = ctx.solids(iid, true).map((s) => s.id)
	if (!sids.length || !ctx.frames.length) return null
	const y0 = _mean(sids.map((i) => ctx.frames[0].placements[i].y))
	const y1 = _mean(sids.map((i) => ctx.frames[ctx.frames.length - 1].placements[i].y))
	return y1 - y0
}
function _travel(ctx, iid, way) {
	const sids = ctx.solids(iid, true).map((s) => s.id)
	if (!sids.length || !ctx.frames.length) return null
	const sid = sids[0]
	const p0 = ctx.frames[0].placements[sid]
	let best = 0.0
	for (const f of ctx.frames) {
		const q = f.placements[sid]
		if (q === undefined || q === null) continue
		const dx = q.x - p0.x
		const dy = q.y - p0.y
		const d = way === "right" ? dx : way === "left" ? -dx : way === "up" ? dy : way === "down" ? -dy : Math.abs(dx)
		if (d > best) best = d
	}
	return best
}
function _size_goal(ctx, g, grow) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let x = ctx.num(g.at_least_x)
	x = x === null || x <= 1 ? 1.05 : x
	const measure = g.measure === "diameter" ? "diameter" : "volume"
	const key = measure === "volume" && ctx.state(iid, "volume_l") ? "volume_l" : "diameter_cm"
	const v = ctx.state(iid, key) ?? []
	const gone = ctx.state(iid, "popped") ?? []
	// (its size until it popped, if it did: a balloon that swelled and then burst did swell)
	const vals = v.filter((y, k) => !(k < gone.length && gone[k] >= 1) && y > 0)
	const ratio = vals.length >= 1 && vals[0] > 0 ? vals[vals.length - 1] / vals[0] : null
	const ok = ratio !== null && (grow ? ratio >= x - 1e-9 : ratio <= 1 / x + 1e-9)
	const what = key === "volume_l" ? "its volume" : "its width"
	const label = grow ? `${ctx.name(iid)} swells to at least ${_num_text(x)}× ${what}` : `${ctx.name(iid)} shrinks to ${_num_text(100 / x)} % of ${what} or less`
	return { label: _label(g, label), ok, kind: grow ? "swells" : "shrinks", item: iid, measure: key,
		from: !vals.length ? null : pyRound(vals[0], 4), to: !vals.length ? null : pyRound(vals[vals.length - 1], 4), ratio: ratio === null ? null : pyRound(ratio, 4) }
}
const GOALS = { pops, lifts_off: rises, crushes, stays_held: holds, lets_go, glides, kite_flies, wind_reads, smoke_drifts, glides_farther, rises_faster, jets, swells, shrinks }
function _goals() {
	// (the summary's goal kinds are registered from `plugin.goals` by web/sim/modules/index.js; this module's tests register them by hand)
	void register_goal_kind
}

// ---------------------------------------------------------------- the build hook: jars round things, heat guns under smoke
// worlds whose air is next to none (machines/mod_air.py AIRLESS: the Moon none, Mars 1.6 % of Earth's air's density), by their gravity preset
const AIRLESS = { moon: 1.62, mars: 3.71 }
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
function _airless(raw) {
	if (!isObj(raw) || (raw.air !== undefined && raw.air !== null)) return false
	const gv = raw.gravity
	if (typeof gv === "string") return hasOwn(AIRLESS, gv.trim().toLowerCase())
	return typeof gv === "number" && Object.values(AIRLESS).includes(gv)
}
const _solid_at = (sb, sid) => sb.solids.find((s) => s.id === sid) ?? null
function _bell_box(sb, iid) {
	const [left, right, top, plate] = ["glass-left", "glass-right", "glass-top", "plate"].map((p) => _solid_at(sb, `${iid}/${p}`))
	if (!left || !right || !top || !plate) return null
	return { x0: pyRound(left.at.x + left.body.width / 2, 6), x1: pyRound(right.at.x - right.body.width / 2, 6),
		y0: pyRound(plate.at.y + plate.body.height / 2, 6), y1: pyRound(top.at.y - top.body.height / 2, 6) }
}
function _hook(sb, scene) {
	const recs = sb.processes.filter((p) => p.kind === "air")
	if (!recs.length) return
	if (_airless(scene.settings)) sb.settings.air = false
	// the waves module's bell jar is a jar too: its own straight-line pump-down, as an air jar record (machines/mod_air.py _hook)
	for (const p of sb.processes.filter((q) => q.kind === "sound" && q.role === "source" && isObj(q.jar))) {
		const box = _bell_box(sb, p.item)
		if (box === null) continue
		const j = p.jar
		const it = sb.scene_items.get(p.item) ?? {}
		const rec = { kind: "air", id: `${p.item}/air-jar`, item: p.item, role: "jar", name: truthy(it.name) ? it.name : TYPES["bell-jar"].name, ...box,
			linear: { from: j.from ?? 100.0, to: j.to ?? 100.0, t0: j.t0 ?? 0.0, t1: j.t1 ?? 0.0 } }
		sb.processes.push(rec)
		recs.push(rec)
	}
	const jars = recs.filter((p) => p.role === "jar").map((p) => ({ item: p.item, x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1 }))
	if (jars.length) {
		for (const p of recs) if (["balloon", "card", "cup"].includes(p.role)) p.jars = jars.map((j) => ({ ...j }))
		// a sound source inside one of this module's jars is heard less as it is pumped down (the jar's e^(−t/τ) as a straight line over 3τ)
		const own = recs.filter((p) => p.role === "jar" && !hasOwn(p, "linear"))
		for (const q of sb.processes) {
			if (q.kind !== "sound" || q.role !== "source" || hasOwn(q, "jar")) continue
			const s = _solid_at(sb, q.solid)
			if (s === null || hasOwn(s, "parent")) continue
			const x = s.at.x + (q.at?.x ?? 0.0)
			const y = s.at.y + (q.at?.y ?? 0.0)
			const j = own.find((p) => p.x0 <= x && x <= p.x1 && p.y0 <= y && y <= p.y1)
			if (j === undefined) continue
			q.jar = { from: 100.0, to: pyRound((100 * j.low) / ATM, 6), t0: pyRound(j.pump_at, 6), t1: pyRound(j.pump_at + 3 * j.tau, 6), glass: 20.0, base: 55.0 }
		}
	}
	const guns = recs.filter((p) => p.role === "hotair" && (p.power ?? 0) > 0).map((p) => ({ x: p.heater.x, y: p.heater.y, w: 1.5, half: 0.025 }))
	if (guns.length) {
		for (const p of recs) if (p.role === "smoke") p.heaters = guns.map((h) => ({ ...h }))
	}
	const planes = recs.filter((p) => p.role === "glider")
	if (planes.length >= 2) {
		// (paper planes pass through each other: in this side view, planes thrown side by side share one flight path)
		for (const p of planes) p.pass = planes.filter((q) => q !== p).flatMap((q) => q.parts)
	}
}

// ================================================================ the AI's plug-ins (web/sim/plugins.js)
const trimNum = (v, d = 2) => {
	const t = Number(v).toFixed(d)
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t
}
const series = (run, id, key) => {
	const v = run?.track?.state?.[id]?.[key]
	return Array.isArray(v) && v.length ? v : null
}
const endOf = (run, id, key) => series(run, id, key)?.at(-1) ?? null
const startOf = (run, id, key) => series(run, id, key)?.[0] ?? null
const maxOf = (run, id, key) => {
	const v = series(run, id, key)
	return v ? Math.max(...v) : null
}
/** The run's time at which a reading first passes a test, or null. */
const firstAt = (run, id, key, test) => {
	const v = series(run, id, key)
	const fr = run?.track?.frames ?? []
	if (!v) return null
	const i = v.findIndex(test)
	return i >= 0 && fr[i] ? fr[i].t : null
}
const cm = (m) => `${trimNum(m * 100, 1)} cm`
const AIR_TYPES = ["party-balloon", "hot-air-balloon", "incense-stick", "anemometer", "wind-tunnel", "vacuum-jar", "vacuum-tube", "card-glass", "suction-cup", "steam-can", "paper-airplane", "kite"]
const pick2 = (scene, types, pick) => {
	const xs = (scene?.items ?? []).filter((i) => types.includes(i.type))
	if (xs.length < 2) return null
	const a = pick(xs)
	const b = pick(xs.filter((i) => i !== a))
	return [a, b]
}
const pick1 = (scene, types, pick) => {
	const xs = (scene?.items ?? []).filter((i) => types.includes(i.type))
	return xs.length ? pick(xs) : null
}

// ---------------------------------------------------------------- the make-it-work search's aims (web/sim/plugins.js GOAL KINDS aim)
const propOf = (it, k) => {
	const v = it?.props?.[k]
	if (v !== undefined && v !== null) return v
	return (TYPES[it?.type]?.props ?? []).find((q) => q.key === k)?.default
}
const specOf = (type, k) => (TYPES[type]?.props ?? []).find((q) => q.key === k) ?? null
/** The air pressure round a scene item in a run (Pa): the lowest a jar holding its anchor read, else the room's (0 in no air). */
function lowestRound(it, run) {
	if (run?.doc?.settings?.air === false) return 0
	let p = ATM
	for (const j of (run?.doc?.processes ?? []).filter((q) => q.kind === "air" && q.role === "jar")) {
		if (!(it.x >= j.x0 && it.x <= j.x1 && it.y >= j.y0 && it.y <= j.y1)) continue
		const v = run?.track?.state?.[j.item]?.pressure_kpa
		if (Array.isArray(v) && v.length) p = Math.min(p, Math.min(...v) * 1000)
	}
	return p
}
/** A balloon that should pop and did not: the gas that bursts it at the lowest pressure round it in the run (10 % and 25 % more), in litres. */
export function aim_pops(g, entry, scene, run) {
	if (g.expect === false || entry?.ok !== false) return []
	const b = (scene?.items ?? []).find((i) => i.id === g.item && i.type === "party-balloon")
	if (!b) return []
	const size = Number(propOf(b, "size"))
	const fill = Number(propOf(b, "fill_l"))
	if (!(size > 0) || !Number.isFinite(fill)) return []
	const rb = (size / 2 / RUBBER_FULL) * RUBBER_BURST
	const T = (Number.isFinite(scene?.settings?.room_temp) ? scene.settings.room_temp : 20) + KELVIN
	const n = ((lowestRound(b, run) + skin_pressure(RUBBER_BURST)) * sphere_volume(rb)) / (GAS_R * T)
	const litres = ((n * GAS_R * 293.15) / ATM) * 1000
	const hi = specOf("party-balloon", "fill_l")?.max ?? 40
	// (its size as built, at the room's pressure: a bigger balloon is set up by as much as it grew, so it rests where it rested and fits where it was)
	const r0 = size / 2 / RUBBER_FULL
	const built = (l) => balloon_radius((ATM * (l / 1000)) / (GAS_R * 293.15), T, ATM, r0, r0 * RUBBER_BURST)
	const out = []
	for (const [k, cost] of [[1.1, 0.4], [1.25, 0.6]]) {
		const to = Math.min(hi, Math.ceil(litres * k * 20) / 20)
		if (!(to > fill + 1e-9) || out.some((c) => c.changes[0].to === to)) continue
		const dy = Math.round((built(to) - built(fill)) * 1e5) / 1e5
		const changes = [{ kind: "prop", id: b.id, key: "fill_l", from: fill, to }]
		if (dy > 0.0005 && Number(propOf(b, "pump_lps")) <= 0) changes.push({ kind: "move", ids: [b.id], dx: 0, dy })
		out.push({ changes, cost })
	}
	return out
}
/** A balloon in a vacuum jar that should swell more: the jar pumped further down (Boyle: V ∝ 1/P), the pressure that gives at_least_x with 10 % to spare. */
export function aim_swells(g, entry, scene, run) {
	if (entry?.ok !== false || !(entry?.ratio > 0)) return []
	const b = (scene?.items ?? []).find((i) => i.id === g.item)
	if (!b) return []
	const x = Number.isFinite(g.at_least_x) && g.at_least_x > 1 ? g.at_least_x : 1.05
	const jarRec = (run?.doc?.processes ?? []).find((q) => q.kind === "air" && q.role === "jar" && !q.linear && b.x >= q.x0 && b.x <= q.x1 && b.y >= q.y0 && b.y <= q.y1)
	const jar = jarRec ? (scene.items ?? []).find((i) => i.id === jarRec.item) : null
	if (!jar) return []
	const low = Number(propOf(jar, "lowest_kpa"))
	const now = lowestRound(b, run)
	const vol = entry.measure === "volume_l"
	const want = (now * (vol ? entry.ratio : entry.ratio ** 3)) / (vol ? x : x ** 3) / 1.1 / 1000
	const lo = specOf(jar.type, "lowest_kpa")?.min ?? 0.1
	const to = Math.max(lo, Math.round(want * 10) / 10)
	return to < low - 1e-9 ? [{ changes: [{ kind: "prop", id: jar.id, key: "lowest_kpa", from: low, to }], cost: 0.5 }] : []
}

export const plugin = {
	title: "Air and gases: balloons, air pressure, hot air, smoke, wind, flight",
	howto: [
		"Air items (category Air) and how to set them up. The room's air is 101.3 kPa at the scene's room_temp; settings {air: false} makes a vacuum (balloons pop, cards fall, suction cups let go, smoke stops, planes and kites drop like stones). Wind comes from a fan (its stream keeps full speed for about 5.6 fan diameters, then fades) or a breeze (fluids module: a steady wind over the whole table from where it stands; put it at the upwind edge).",
		"party-balloon (anchor: its middle; a ball 25 cm across with the default 8 L of air): gas air|helium, fill_l litres put in (an 11-inch, 28 cm balloon holds 11.5 L at its rated size and pops past about 25 L), size (rated diameter), tied (false = it lets its air out of its neck and flies the other way: its neck points along its own −y, so angle −90 sends it RIGHT, 90 LEFT, 0 UP), pump_lps (a hand pump in its neck from t = 0: it grows until it pops; put it on the table with place {on: table}: its pump stands under it), prick_at (s: a pin pops it), string_m + weight_g (a string down to a weight; 0 g = tied to a fixed hook). Air balloons sink slowly (about −3 g net), helium ones rise (+5 g net for 8 L) and on a string pull up on their weight: a 3 g weight is carried away, a 20 g one holds. A small balloon (size 0.12, fill_l 0.3) fits in a vacuum jar: put it in with place {inside: <jar id>} (it rests on the jar's floor, no drop); pumped down it swells (Boyle: at 50 kPa its gas takes about twice the room), and below about 25 kPa it pops (fill_l 0.3 in size 0.12; more gas pops it at a higher pressure). In the jar's thin air its lift is the jar's: even swollen it does not float up. Its gas also warms or cools toward the air round it (Charles: over a hot plate, beside ice): it swells or shrinks a little over some seconds (a 15 s time constant); on a surface over 150 °C it pops. In no air or over-filled it is shown as filled while held, then swells and bursts within 0.3 s of the release. Goals: swells {item, at_least_x} / shrinks {item, at_least_x} (its volume, end against start), pops, jets {item, toward} for an UNTIED balloon flying on its own air (balloon rocket: tied false, place angle_deg -90 to go right; a tied balloon never passes jets: never check a balloon rocket with a plain distance goal). (A balloon rocket riding a string line is the mechanics module's balloon-rocket; an untied party-balloon flies free.)",
		"hot-air-balloon (anchor: the middle of its launch stand's base, on the table; the envelope (0.9 m) sits over a heat gun on two wire posts, its top about 1.12 m above the table): it lifts off once the air inside is hot enough (tissue paper 0.9 m: above about 58 °C; start_c 65 by default, heater_w 1500 keeps heating it while its mouth is within 60 cm of the gun), rises, cools through its skin and sinks back. tether_m holds it at that height; heater_off_s switches the gun off; payload_g weighs it down; envelope 'plastic bag' is lighter (lifts above about 39 °C). An unheated one (heater_w 0, start_c = room) stays on its stand.",
		"incense-stick (anchor: its holder's bottom, on the table; the smoke leaves its tip 23 cm up): its smoke shows the air moving: it rises in still air, is blown along a fan's stream (put the stick 0.3-0.8 m in front of the fan, the tip at the fan's height or within its stream) and rises fast over hot things (a hot plate, a pan of hot water, the hot-air balloon's heat gun: put the stick right beside it, its tip within a few cm of its edge, so the smoke drifts into its plume) or sinks under cold ones (ice). To show smoke rising faster over a hot thing than in the room, use two sticks lit at the same time, one by the hot thing and one far from it, and the goal rises_faster {a: the stick by the hot thing, b: the room's stick}; start the water hot (a saucepan's water_temp_c 80-90): a hot plate takes minutes to warm (time_lapse) and barely changes the smoke in a few seconds. With ice water in the pan instead the smoke beside it rises about as in the room (cold air sinks down and off the pan, under the smoke, not through it): say so, and do not plan a goal that the cold pan's stick rises slower; smoke_drifts {item, toward} only says which way one stick's smoke goes. anemometer (anchor: its foot; cups at `height`): reads the wind there (put its cups at the fan's height: fan centre y − 0.03 − the anemometer's own y).",
		"wind-tunnel (anchor: the middle of its floor's top, on the table; 1.2 m long, 0.3 m inside, its fan box at the upwind end): an even stream at `speed` blowing `blows` through it from t = on_at: a container: put a wind meter, an incense stick, light things or a kite in it with place {inside: <tunnel id>}. vacuum-jar (anchor: its plate's bottom, on the table; inside 30 × 35 cm by default): a container: put things in it with place {inside: <jar id>}: they are set on its floor under its glass top (a small balloon; a card-glass with stand_height 0.1, its stand and all, in a jar at least 0.3 wide and 0.35 high; a suction-cup with height 0.25 and load_kg 1 or less: they must fit inside). From pump_at the pressure falls (by 63 % every pump_s seconds) toward lowest_kpa; vent_at lets the air back in. Inside it the engine's drag and buoyancy follow its pressure too (a feather falls like a coin in a hard vacuum), and a sound source in it (the waves module's buzzers and bells) is heard less as it is pumped; the waves module's own bell-jar is a jar for air items too (a balloon in it swells as it is pumped). vacuum-tube (anchor: its base's bottom, on the table; 1.5 m tall, 30 cm inside, pumped from 0 s down to 0.1 kPa with pump_s 0.4): the coin-and-feather tube: a feather (mechanics' feather, kind craft) and a coin (coin-flat) side by side inside it near its top with place {on: air, x: the tube's x − 0.07 for the feather (it is 15 cm long) and + 0.09 for the coin, y_m: tube height − 0.15}, NOT held (nothing moves before the scene's release, and a held thing gets a pull-pin post drawn inside the tube), and the scene's release after the pump is done (release 2.5 for pump_s 0.4): pumped they land together (goal lands_together {a: feather, b: coin}); a second tube with pumped false (the control, its air the room's) lets the feather drift down far behind (goal lands_first {a: coin, b: feather}). Only the inside of a jar or tube is a vacuum; settings {air: false} makes the whole scene one.",
		"card-glass (anchor: its stand's base; the glass's mouth stand_height above it): the air's push (about 330 N on a 7 cm mouth) holds the card up under an upside-down glass of water; with water 0 (no seal) the card falls at the release; in a vacuum jar it falls when the pressure drops to about 10 kPa. suction-cup (anchor: its stand's base): a cup stuck under a sheet with load_kg hanging from it; it holds about 35 kPa × its area on glass (5 cm: 69 N, about 7 kg; 8 cm: 176 N), 30 kPa on glazed tile, 10 kPa on a painted wall, nothing on wood; heavier, it lets go at the release. steam-can (anchor: its stove's foot; its dish of cold water `gap` m to the right): a can boiled boil_s seconds (steam drives its air out) is dunked mouth-down at dip_at by tongs (it takes 1.3 s) and crushed by the air; boil_s 0 = the control, it is not crushed. A warm bath crushes it too: the can buckles once its inside is about 8.7 kPa under the room's 101.3 kPa (92.6 kPa), and the steam in it condenses to water's vapour pressure at the bath's temperature, 2.3 kPa at 20 °C, 47 kPa at 80 °C, 70 kPa at 90 °C, 85 kPa at 95 °C: every bath up to about 95 °C crushes a boiled can (a hotter bath crushes it less hard); only a nearly boiling bath (97 °C or more) or an unheated can (boil_s 0) stays whole. So a cold vs warm bath comparison is crushed both times (the cold one harder); plan 'crushes' for both, never 'is not crushed' for the warm one.",
		"paper-airplane (anchor: its balance point; place {on: air, y_m: the throw height, e.g. 1.2-2.0}): thrown at the release at launch_speed (5 m/s) and launch_angle (5°) toward `facing`; it glides and lands (distance_m: where it touched down; it stops within about 15 cm there, so a measuring tape on the floor reads the same): from 1.5 m a dart flies about 4-5 m, a glider (broad wings) 8-11 m, a balsa glider 10-14 m (give it room: a wide table or floor and a wide stage). elevator (tail flaps up, 5°) trims it: more up = slower and flatter until it stalls; nose_clips make it nose-heavy: steadier, faster, shorter. To compare two planes (a fair test: one thing different), stage them on ONE floor lane: both thrown from the same height (the same y_m) toward the same side, one 0.3 m behind the other (or one after the other), never one lane floating in mid-air (a raised lane needs real supports under it): in this side view two planes share one flight path, and they pass through each other (they never collide). Goal glides_farther {a, b} (a lands farther than b), plus a glides goal for each if you like; add plan.tune knobs for a plane that must reach a mark: launch_speed (3-8 m/s), launch_angle (0-15°), elevator (0-10°). kite (anchor: the foot of the stake its line is tied to, on the table): it flies downwind (`toward`, right by default) on line_m of line when a wind of 2.5 m/s or more reaches it: add a breeze blowing toward that side (place the breeze at the upwind edge of the table); no wind, it falls. bridle 0.3 (where the line pulls, from its nose); too far back (0.45) it flips and falls.",
		"Readings: balloon diameter_cm, pressure_kpa (over the outside air), volume_l, lift_g (net: + rises, in the air round it), thrust_n, popped, gas_c; hot-air inside_c, lift_n, net_g, height_m; smoke drift_m (+ right), rise_m; anemometer wind_ms; jar and tube pressure_kpa; card holding (1/0), push_n, inside_kpa, outside_kpa, water; cup holding, hold_n (most it can hold), pull_n; can crushed (0…0.7 of its volume), inside_kpa, temp_c; plane distance_m, speed_ms, height_m, flying, aoa_deg; kite height_m, line_angle_deg, pull_n, wind_ms, flying."
	].join(" "),
	prompt: {
		plan: [
			"Air: a balloon rising or sinking, hot air rising, smoke drifting, a plane gliding, a kite flying, a card held up, a cup holding, a can crushing, a balloon popping: use the air module's items (party-balloon, hot-air-balloon, incense-stick, anemometer, vacuum-jar, card-glass, suction-cup, steam-can, paper-airplane, kite) and its goals: lifts_off {item, at_least_m?} (a helium balloon, a hot-air balloon going UP in air: never fluids' floats, which is for liquids, nor mechanics' rises), pops {item, before_s?}, swells / shrinks {item, at_least_x?} (a balloon's volume, end against start: Boyle in a vacuum jar, Charles by heat or cold), jets {item, toward, at_least_m?} (an untied balloon flying on its own air), crushes {item}, stays_held {item} / lets_go {item, before_s?} (card-glass, suction-cup), glides {item, at_least_m?} and glides_farther {a, b} (paper-airplane), kite_flies {item, at_least_m?}, wind_reads {item, at_least?, at_most?} (anemometer), smoke_drifts {item, toward: left|right|up|down} and rises_faster {a, b} (incense-stick smoke over a hot thing vs in the room). A comparison or a control gets a comparison goal (glides_farther, rises_faster, lands_together / lands_first), never two goals that both pass whatever happens.",
			"Wind for kites and smoke: a breeze (steady, whole table) or a fan; a kite needs the wind blowing toward its `toward` side. Things go inside a vacuum-jar with place {inside: <jar>} (set on its floor, under its glass top). A coin and a feather in a vacuum-tube: near its top (not held), the scene's release after its pump is done. A vacuum everywhere: settings {air: false} (gravity moon or mars alone means no air too). A comparison (helium vs air balloon, heated vs unheated can, empty vs full glass, light vs heavy load, two planes) is two items side by side, identical but for that one thing: a fair test changes ONE setting. Expect what the physics gives (a boiled can in an 80 °C bath is still crushed: 47 kPa of vapour inside against 101 kPa outside)."
		].join("\n"),
		edit: "Air: change a balloon with fill_l / gas / size / tied / string_m / weight_g; a hot-air balloon with heater_w / start_c / payload_g / tether_m; a plane with launch_speed / launch_angle / elevator / nose_clips / design; a kite with line_m / bridle / tail_m (and the breeze's speed); a suction cup with load_kg / diameter / surface; the card trick with water; the can with boil_s / bath_c; a vacuum jar with pump_s / lowest_kpa; a vacuum tube with pumped / lowest_kpa. When the person changes or stops the wind (a fan's or a breeze's speed, a wind tunnel's), re-aim the wind_reads, smoke_drifts and kite_flies goals to what the new wind gives (an anemometer in a 6 m/s fan's stream reads about 5.9 m/s within 5 fan diameters; no wind: smoke rises straight up, a kite falls) and switch the wind off as it really goes off: a wind tunnel or a breeze with speed 0; the catalog's fan has no off switch (its slowest is 0.5 m/s), so a fan switched off for the whole run gets its on_at after the run's end (it never starts) and the goals say no wind (wind_reads at_most 0.1, smoke_drifts up); never leave a goal that still expects the old wind. In a comparison (two cans, two planes, two balloons) change both items alike unless the person asks for one. Say what that does in real units (litres, °C, m/s, N, kPa).",
		refine: "Air: a helium or hot-air balloon must go up (lifts_off); a popped balloon is gone (its pieces fall); a kite must have wind toward its side at its height (wind_ms well above 2); a plane needs room in front of it to land in (distance_m); a card or cup that should hold must read holding 1 at the end. Fix a failing air goal with the module's own settings, never by fixing items in place; never fix a comparison or a control by changing a setting on just one of the two items it holds equal (a boiled can's boil_s, a plane's design): if the physics says the expected result is wrong (a boiled can in a warm bath IS crushed), say so and change the goal instead. Two planes compared fly on one floor lane from the same height, not one in mid-air."
	},
	examples: [
		{ ask: "Show that a helium balloon rises but a balloon of air sinks.", how: "two party-balloons side by side in the air at y 1.0 (gas helium vs air); goals lifts_off {helium one, at_least_m 0.5} and moves {air one}",
			plan: { items: [{ id: "he", type: "party-balloon", props: { gas: "helium", color: "yellow" }, place: { on: "air", x: 1.8, y_m: 1.0 } }, { id: "air", type: "party-balloon", props: { color: "blue" }, place: { on: "air", x: 0.8, y_m: 1.0 } }], goals: [{ kind: "lifts_off", item: "he", at_least_m: 0.5 }] } },
		{ ask: "Blow up a balloon with a pump until it pops.", how: "a party-balloon with pump_lps 2 on the table, seconds 10; goal pops {item}",
			plan: { items: [{ id: "b", type: "party-balloon", props: { pump_lps: 2.0 }, place: { on: "table", x: 1.3 } }], goals: [{ kind: "pops", item: "b" }], seconds: 10 } },
		{ ask: "Hot air rises: a tissue-paper hot-air balloon over a heat gun.", how: "a hot-air-balloon on the table (tether_m 1 to keep it in view); goal lifts_off {item, at_least_m 0.5}",
			plan: { items: [{ id: "hab", type: "hot-air-balloon", props: { tether_m: 1.0 }, place: { on: "table", x: 1.2 } }], goals: [{ kind: "lifts_off", item: "hab", at_least_m: 0.5 }], seconds: 8 } },
		{ ask: "Air pressure holds a card under an upside-down glass of water; with no water the card falls.", how: "two card-glass items (water 0.8 vs 0); goals stays_held {full}, lets_go {empty}",
			plan: { items: [{ id: "full", type: "card-glass", place: { on: "table", x: 0.8 } }, { id: "empty", type: "card-glass", props: { water: 0 }, place: { on: "table", x: 1.8 } }], goals: [{ kind: "stays_held", item: "full" }, { kind: "lets_go", item: "empty" }] } },
		{ ask: "A kite flies in the wind.", how: "a breeze (speed 4) at the table's left edge and a kite (toward right) staked at x 0.4; goal kite_flies {item, at_least_m 0.8}",
			plan: { items: [{ id: "wind", type: "breeze", props: { speed: 4 }, place: { on: "table", x: -0.45 } }, { id: "k", type: "kite", place: { on: "table", x: 0.4 } }], goals: [{ kind: "kite_flies", item: "k", at_least_m: 0.8 }], seconds: 6 } },
		{ ask: "Steam in a can condenses and the air crushes it.", how: "a steam-can (boil_s 30) and an unheated control (boil_s 0) side by side; goal crushes {hot can}",
			plan: { items: [{ id: "hot", type: "steam-can", place: { on: "table", x: 0.4 } }, { id: "cold", type: "steam-can", props: { boil_s: 0 }, place: { on: "table", x: 1.8 } }], goals: [{ kind: "crushes", item: "hot" }], seconds: 4 } },
		{ ask: "Pump the air out of a jar with a small balloon in it: it swells, then pops.", how: "a vacuum-jar and a small party-balloon (size 0.12, fill_l 0.3) inside it on its floor; goals swells {balloon, at_least_x 1.5} and pops {balloon}",
			plan: { items: [{ id: "jar", type: "vacuum-jar", place: { on: "table", x: 1.2 } }, { id: "b", type: "party-balloon", props: { size: 0.12, fill_l: 0.3 }, place: { inside: "jar" } }], goals: [{ kind: "swells", item: "b", at_least_x: 1.5 }, { kind: "pops", item: "b" }], seconds: 8 } },
		{ ask: "Does the card stay on the glass of water in a vacuum?", how: "a vacuum-jar (0.3 wide, 0.35 high) with a card-glass inside it (stand_height 0.1: it fits, stand and all); goal lets_go {card-glass}",
			plan: { items: [{ id: "jar", type: "vacuum-jar", props: { width: 0.34, height: 0.4 }, place: { on: "table", x: 1.2 } }, { id: "cg", type: "card-glass", props: { stand_height: 0.1 }, place: { inside: "jar" } }], goals: [{ kind: "lets_go", item: "cg" }], seconds: 8 } },
		{ ask: "Which paper plane flies farther, a dart or a glider?", how: "a dart and a glider on one floor lane, thrown from the same height 1.5 m, the glider 0.3 m behind the dart (they pass through each other); a wide stage; goal glides_farther {a: glider, b: dart}",
			plan: { items: [{ id: "glider", type: "paper-airplane", props: { design: "glider" }, place: { on: "air", x: 0.0, y_m: 1.5 } }, { id: "dart", type: "paper-airplane", props: { design: "dart" }, place: { on: "air", x: 0.3, y_m: 1.5 } }], goals: [{ kind: "glides_farther", a: "glider", b: "dart" }], seconds: 5 } },
		{ ask: "A coin and a feather fall together in a vacuum tube.", how: "a pumped vacuum-tube and a control tube (pumped false), each with a craft feather and a coin side by side near its top (not held); release 2.5 s (after the pump); goals lands_together {feather, coin} in the pumped tube, lands_first {coin, feather} in the control",
			plan: { items: [{ id: "tube", type: "vacuum-tube", place: { on: "table", x: 0.6 } }, { id: "f1", type: "feather", props: { kind: "craft" }, place: { on: "air", x: 0.53, y_m: 1.35 } }, { id: "c1", type: "coin-flat", place: { on: "air", x: 0.69, y_m: 1.35 } }, { id: "tube2", type: "vacuum-tube", props: { pumped: false }, place: { on: "table", x: 1.8 } }, { id: "f2", type: "feather", props: { kind: "craft" }, place: { on: "air", x: 1.73, y_m: 1.35 } }, { id: "c2", type: "coin-flat", place: { on: "air", x: 1.89, y_m: 1.35 } }], goals: [{ kind: "lands_together", a: "f1", b: "c1" }, { kind: "lands_first", a: "c2", b: "f2" }], release: 2.5, seconds: 5 } },
		{ ask: "Smoke rises faster over a pan of hot water than in the room.", how: "a saucepan of water already hot (water_temp_c 90), an incense stick right beside it (its tip 9 cm from the pan's middle edge), another incense stick far off in the room, lit at the same time; goal rises_faster {a: the pan's stick, b: the room's} (about 0.77 against 0.37 m)",
			plan: { items: [{ id: "pan", type: "saucepan", props: { water_temp_c: 90 }, place: { on: "table", x: 0.6 } }, { id: "s1", type: "incense-stick", place: { on: "table", x: 0.78 } }, { id: "s2", type: "incense-stick", place: { on: "table", x: 2.2 } }], goals: [{ kind: "rises_faster", a: "s1", b: "s2" }], seconds: 8 } },
		{ ask: "Let go of a blown-up balloon without tying it: it shoots off.", how: "an untied party-balloon (tied false, place angle_deg -90 so its neck points left and it flies right) in the air; goal jets {item, toward right, at_least_m 1}",
			plan: { items: [{ id: "b", type: "party-balloon", props: { tied: false, fill_l: 10 }, place: { on: "air", x: 0.4, y_m: 1.0, angle_deg: -90 } }], goals: [{ kind: "jets", item: "b", toward: "right", at_least_m: 1 }], seconds: 3 } }
	],
	goals: [
		{ kind: "pops", aliases: ["pop", "bursts", "burst", "popped", "balloon_pops"], fields: { item: "item", before_s: "number?", expect: "bool?" },
			about: "pops {item, before_s?, expect?}: a party-balloon pops (overfilled, pricked, or in a vacuum), by before_s if given; expect false: it must NOT pop (a control)",
			label: (g, n) => `${n(g.item)} ${g.expect === false ? "does not pop" : "pops"}${_when(_fin(g.before_s))}`, summarize: pops, aim: aim_pops,
			sample: (scene, pick) => {
				const b = pick1(scene, ["party-balloon"], pick)
				return b ? { kind: "pops", item: b.id, ...(pick([true, false]) ? { before_s: pick([1, 3, 9]) } : {}) } : null
			} },
		{ kind: "lifts_off", aliases: ["rises_in_air", "floats_up", "goes_up", "ascends", "floats_away", "balloon_rises"], fields: { item: "item", at_least_m: "number?", expect: "bool?" },
			about: "lifts_off {item, at_least_m?, expect?}: it goes UP in the air: its moving parts rise at least at_least_m (default 0.2 m) above where they started, at some time (a helium balloon, a hot-air balloon; not mechanics' rises, which is a machine lifting its load); expect false: it must NOT rise that much (an unheated or air-filled control)",
			label: (g, n) => (g.expect === false ? `${n(g.item)} does not rise ${_m_text(_fin(g.at_least_m) ?? 0.2)}` : `${n(g.item)} rises at least ${_m_text(_fin(g.at_least_m) ?? 0.2)}`), summarize: rises,
			sample: (scene, pick) => {
				const b = pick1(scene, ["party-balloon", "hot-air-balloon", "kite"], pick)
				return b ? { kind: "lifts_off", item: b.id, ...(pick([true, false]) ? { at_least_m: pick([0.1, 0.5, 2]) } : {}) } : null
			} },
		{ kind: "crushes", aliases: ["crush", "crushed", "implodes", "is_crushed", "can_crushes"], fields: { item: "item", before_s: "number?", expect: "bool?" },
			about: "crushes {item, before_s?, expect?}: a steam-can is crushed by the air (at least 5 % of its volume pushed in); expect false: it must NOT be (the unheated control)",
			label: (g, n) => `${n(g.item)} ${g.expect === false ? "is not crushed" : "is crushed"}${_when(_fin(g.before_s))}`, summarize: crushes,
			sample: (scene, pick) => {
				const b = pick1(scene, ["steam-can"], pick)
				return b ? { kind: "crushes", item: b.id } : null
			} },
		{ kind: "stays_held", aliases: ["card_stays", "cup_holds", "cup_stays_stuck", "air_holds", "held_up", "card_holds"], fields: { item: "item" },
			about: "stays_held {item}: a card-glass's card or a suction-cup is still held up by the air at the end (magnetism's holds is for magnets)",
			label: (g, n) => `${n(g.item)} holds`, summarize: holds,
			sample: (scene, pick) => {
				const b = pick1(scene, ["card-glass", "suction-cup"], pick)
				return b ? { kind: "stays_held", item: b.id } : null
			} },
		{ kind: "lets_go", aliases: ["let_go", "unsticks", "card_falls", "cup_falls", "cup_lets_go"], fields: { item: "item", before_s: "number?" },
			about: "lets_go {item, before_s?}: a card-glass's card falls or a suction-cup lets go (by before_s if given)",
			label: (g, n) => `${n(g.item)} lets go`, summarize: lets_go,
			sample: (scene, pick) => {
				const b = pick1(scene, ["card-glass", "suction-cup"], pick)
				return b ? { kind: "lets_go", item: b.id, ...(pick([true, false]) ? { before_s: 2 } : {}) } : null
			} },
		{ kind: "glides", aliases: ["glide", "flies_far", "flight_distance", "plane_flies", "flies_at_least"], fields: { item: "item", at_least_m: "number?" },
			about: "glides {item, at_least_m?}: a paper-airplane flies at least at_least_m (default 1 m) along the floor before it lands (to compare two planes use measure's farther {a, b} or two glides goals)",
			label: (g, n) => `${n(g.item)} flies far`, summarize: glides,
			sample: (scene, pick) => {
				const b = pick1(scene, ["paper-airplane"], pick)
				return b ? { kind: "glides", item: b.id, at_least_m: pick([0.5, 2, 6]) } : null
			} },
		{ kind: "kite_flies", aliases: ["kite_aloft", "kite_stays_up", "flies_kite", "kite_flies_high"], fields: { item: "item", at_least_m: "number?", expect: "bool?" },
			about: "kite_flies {item, at_least_m?, expect?}: a kite stays at least at_least_m (default 0.5 m) above its stake through the last 30 % of the run; expect false: it must NOT (no wind)",
			label: (g, n) => (g.expect === false ? `${n(g.item)} does not stay up ${_m_text(_fin(g.at_least_m) ?? 0.5)} above its stake` : `${n(g.item)} stays up at least ${_m_text(_fin(g.at_least_m) ?? 0.5)} above its stake`), summarize: kite_flies,
			sample: (scene, pick) => {
				const b = pick1(scene, ["kite"], pick)
				return b ? { kind: "kite_flies", item: b.id, ...(pick([true, false]) ? { at_least_m: pick([0.3, 1]) } : {}) } : null
			} },
		{ kind: "wind_reads", aliases: ["wind_speed", "anemometer_reads", "reads_wind", "measures_wind"], fields: { item: "item", at_least: "number?", at_most: "number?" },
			about: "wind_reads {item, at_least?, at_most?}: an anemometer's reading at the end is within those m/s",
			label: (g, n) => `${n(g.item)} reads the wind`, summarize: wind_reads,
			sample: (scene, pick) => {
				const b = pick1(scene, ["anemometer"], pick)
				return b ? { kind: "wind_reads", item: b.id, ...(pick([true, false]) ? { at_least: pick([1, 4]) } : { at_most: pick([0.5, 3]) }) } : null
			} },
		{ kind: "glides_farther", aliases: ["flies_farther", "glides_further", "plane_flies_farther", "flies_further"], fields: { a: "item", b: "item", by_m: "number?" }, subject: ["a"],
			about: "glides_farther {a, b, by_m?}: paper-airplane a lands farther from where it was thrown than paper-airplane b (b must have landed; by at least by_m, default 5 cm): a fair test of two planes",
			label: (g, n) => `${n(g.a)} flies farther than ${n(g.b)}`, summarize: glides_farther,
			sample: (scene, pick) => {
				const ab = pick2(scene, ["paper-airplane"], pick)
				return ab ? { kind: "glides_farther", a: ab[0].id, b: ab[1].id, ...(pick([true, false]) ? { by_m: pick([0.1, 1]) } : {}) } : null
			} },
		{ kind: "rises_faster", aliases: ["smoke_rises_faster", "rises_higher", "rises_quicker", "goes_up_faster"], fields: { a: "item", b: "item" }, subject: ["a"],
			about: "rises_faster {a, b}: a rises faster than b over the same run: two incense-sticks' smoke (a's mean rise over the run's second half at least 5 cm and 20 % more: smoke by a hot pan vs in the room), or two balloons (a higher at the end)",
			label: (g, n) => `${n(g.a)} rises faster than ${n(g.b)}`, summarize: rises_faster,
			sample: (scene, pick) => {
				const ab = pick2(scene, ["incense-stick", "party-balloon", "hot-air-balloon"], pick)
				return ab ? { kind: "rises_faster", a: ab[0].id, b: ab[1].id } : null
			} },
		{ kind: "jets", aliases: ["balloon_rocket", "shoots_off", "jets_away", "rockets_away", "air_jet"], fields: { item: "item", toward: "string?", at_least_m: "number?", expect: "bool?" },
			about: "jets {item, toward?: left|right|up|down, at_least_m?, expect?}: an UNTIED party-balloon (tied false) flies on its own air's jet at least at_least_m (default 0.5 m) toward that side (sideways either way if not given); a tied one never passes; expect false: it must NOT (the tied control)",
			label: (g, n) => {
				const where = ["left", "right", "up", "down"].includes(g.toward) ? ` ${g.toward}` : " sideways"
				const least = _m_text(_fin(g.at_least_m) ?? 0.5)
				return g.expect === false ? `${n(g.item)} does not jet${where} ${least}` : `${n(g.item)} jets${where} at least ${least} on its own air`
			}, summarize: jets,
			sample: (scene, pick) => {
				const b = pick1(scene, ["party-balloon"], pick)
				return b ? { kind: "jets", item: b.id, ...(pick([true, false]) ? { toward: pick(["left", "right", "up", "down"]) } : {}), ...(pick([true, false]) ? { at_least_m: pick([0.1, 0.5, 2]) } : {}) } : null
			} },
		{ kind: "swells", aliases: ["grows", "expands", "inflates", "gets_bigger", "balloon_swells", "swells_up"], fields: { item: "item", at_least_x: "number?", measure: "string?" },
			about: "swells {item, at_least_x?, measure?: volume|diameter}: a balloon (or another thing with a volume reading) ends at least at_least_x times (default 1.05) its starting volume (or width), or was just before it popped: Boyle (a vacuum jar pumped down), Charles (warmed)",
			label: (g, n) => `${n(g.item)} swells`, summarize: swells, aim: aim_swells,
			sample: (scene, pick) => {
				const b = pick1(scene, ["party-balloon"], pick)
				return b ? { kind: "swells", item: b.id, ...(pick([true, false]) ? { at_least_x: pick([1.02, 1.5, 3]) } : {}), ...(pick([true, false]) ? { measure: pick(["volume", "diameter"]) } : {}) } : null
			} },
		{ kind: "shrinks", aliases: ["deflates", "contracts", "gets_smaller", "shrivels", "balloon_shrinks"], fields: { item: "item", at_least_x: "number?", measure: "string?" },
			about: "shrinks {item, at_least_x?, measure?: volume|diameter}: it ends at 1/at_least_x (default 1/1.05, 95 %) of its starting volume (or width) or less: cooled (ice), its air let out, a jar let back up",
			label: (g, n) => `${n(g.item)} shrinks`, summarize: shrinks,
			sample: (scene, pick) => {
				const b = pick1(scene, ["party-balloon"], pick)
				return b ? { kind: "shrinks", item: b.id, ...(pick([true, false]) ? { at_least_x: pick([1.02, 1.5]) } : {}) } : null
			} },
		{ kind: "smoke_drifts", aliases: ["smoke_blows", "smoke_moves", "smoke_rises", "smoke_goes"], fields: { item: "item", toward: "string?" },
			about: "smoke_drifts {item, toward: left|right|up|down}: an incense-stick's smoke goes that way on average (right/left: 5 cm or more sideways; up: 10 cm or more up and more up than sideways; down: it sinks)",
			label: (g, n) => `${n(g.item)}'s smoke drifts ${g.toward ?? "up"}`, summarize: smoke_drifts,
			sample: (scene, pick) => {
				const b = pick1(scene, ["incense-stick"], pick)
				return b ? { kind: "smoke_drifts", item: b.id, toward: pick(["left", "right", "up", "down"]) } : null
			} }
	],
	knobs: [
		{ type: "party-balloon", key: "fill_l", how: "abs", steps: [0.25, 0.5, 1, 2, 4, 8], cost: 0.5, more: "blow more air into {it}", less: "let some air out of {it}", why: "more gas makes it bigger (and nearer popping: it bursts past about 1.3 × its rated size, so in a weaker vacuum it needs more gas to pop); more helium lifts more" },
		{ type: "party-balloon", key: "tied", how: "bool", cost: 3, more: "tie {it}'s neck", less: "untie {it}'s neck", why: "untied, its air rushes out of its neck and it flies the other way (a balloon rocket); tied, it keeps its air" },
		{ type: "party-balloon", key: "gas", how: "choice", cost: 3, more: "fill {it} with another gas", less: "fill {it} with another gas", why: "helium (0.17 kg/m³) is far lighter than air (1.2 kg/m³): a helium balloon rises, an air one sinks" },
		{ type: "party-balloon", key: "weight_g", how: "rel", more: "hang a heavier weight on {it}", less: "hang a lighter weight on {it}", why: "the string's weight holds a helium balloon down only if it outweighs the balloon's net lift (about 5 g for 8 L)" },
		{ type: "party-balloon", key: "size", how: "rel", more: "use a bigger balloon for {it}", less: "use a smaller balloon for {it}", why: "a bigger balloon holds more gas before it pops" },
		{ type: "party-balloon", key: "pump_lps", how: "rel", more: "pump {it} faster", less: "pump {it} slower", why: "a faster pump fills it sooner, so it pops sooner" },
		{ type: "hot-air-balloon", key: "heater_w", how: "rel", more: "turn {it}'s heat gun up", less: "turn {it}'s heat gun down", why: "more heat warms the air inside faster: hot air is lighter, so it lifts off sooner" },
		{ type: "hot-air-balloon", key: "start_c", how: "abs", steps: [5, 10, 20, 30], cost: 0.1, more: "heat {it}'s air more before the start", less: "start {it} cooler", why: "the hotter the air inside, the lighter it is (ρ ∝ 1/T) and the more it lifts; in a short run this is what counts, since even a 1500 W heat gun warms its air only about 1.5 °C a second" },
		{ type: "hot-air-balloon", key: "size", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a bigger envelope holds more hot air for its paper (lift grows as the volume, weight as the area)" },
		{ type: "hot-air-balloon", key: "payload_g", how: "abs", steps: [5, 10, 20], more: "load {it} more", less: "take load off {it}", why: "every gram it carries needs more hot air to lift" },
		{ type: "hot-air-balloon", key: "envelope", how: "choice", cost: 2, more: "make {it} of another material", less: "make {it} of another material", why: "a plastic-bag envelope (11 g/m²) is lighter than tissue paper with its seams (20 g/m²)" },
		{ type: "paper-airplane", key: "launch_speed", how: "rel", more: "throw {it} faster", less: "throw {it} slower", why: "a faster throw carries it farther, up to a point: too fast and it climbs, stalls and dips" },
		{ type: "paper-airplane", key: "launch_angle", how: "deg", more: "throw {it} higher", less: "throw {it} more level", why: "a slightly upward throw stretches its glide; too steep and it stalls" },
		{ type: "paper-airplane", key: "elevator", how: "deg", more: "bend {it}'s tail flaps up more", less: "bend {it}'s tail flaps down", why: "up flaps raise its nose: slower, flatter glides until it stalls; down flaps make it dive" },
		{ type: "paper-airplane", key: "nose_clips", how: "abs", steps: [1], more: "clip a paper clip on {it}'s nose", less: "take a paper clip off {it}'s nose", why: "weight on the nose makes it steadier but faster and steeper" },
		{ type: "paper-airplane", key: "design", how: "choice", cost: 3, more: "fold {it} another way", less: "fold {it} another way", why: "broad glider wings or a balsa glider glide much farther than a narrow dart" },
		{ type: "kite", key: "line_m", how: "rel", more: "let out more line for {it}", less: "reel in {it}'s line", why: "a longer line flies it higher (if the wind reaches up there)" },
		{ type: "kite", key: "bridle", how: "abs", steps: [0.02, 0.05], more: "tie {it}'s line further back", less: "tie {it}'s line nearer its nose", why: "the line's point sets its angle to the wind: near 0.25-0.35 it flies; too far back it flips over" },
		{ type: "kite", key: "tail_m", how: "rel", more: "give {it} a longer tail", less: "give {it} a shorter tail", why: "a tail's drag keeps it pointing into the wind (steadier)" },
		{ type: "suction-cup", key: "load_kg", how: "rel", more: "hang more weight on {it}", less: "hang less weight on {it}", why: "it lets go once the weight's pull beats the air's push on it (Δp × its area)" },
		{ type: "suction-cup", key: "diameter", how: "rel", more: "use a bigger cup for {it}", less: "use a smaller cup for {it}", why: "the air's push grows as the cup's area: an 8 cm cup holds 2.6 times a 5 cm one" },
		{ type: "suction-cup", key: "surface", how: "choice", cost: 2, more: "stick {it} to another surface", less: "stick {it} to another surface", why: "smooth glass or tile seals well; paint leaks; rough wood does not seal at all" },
		{ type: "card-glass", key: "water", how: "abs", steps: [0.1, 0.2, 0.5], more: "put more water in {it}", less: "pour water out of {it}", why: "with no water nothing seals the card and it falls; any water seals it and the air holds it" },
		{ type: "steam-can", key: "boil_s", how: "abs", steps: [10, 20, 30], more: "boil {it} longer", less: "boil {it} shorter", why: "the steam pushes the air out: with no boiling there is only air inside and the can is not crushed" },
		{ type: "steam-can", key: "bath_c", how: "abs", steps: [10, 20, 40], more: "use warmer water for {it}", less: "use colder water for {it}", why: "colder water condenses the steam to a lower pressure: a harder crush" },
		{ type: "vacuum-jar", key: "lowest_kpa", how: "rel", more: "pump {it} less", less: "pump {it} down further", why: "the lower the pressure inside, the more a balloon swells and the sooner a card or cup lets go" },
		{ type: "vacuum-jar", key: "pump_s", how: "rel", more: "pump {it} slower", less: "pump {it} faster", why: "a faster pump takes the air out sooner" },
		{ type: "vacuum-tube", key: "lowest_kpa", how: "rel", more: "pump {it} less", less: "pump {it} down further", why: "the less air is left in it, the less drag a feather in it meets: at 0.1 kPa it falls with the coin" },
		{ type: "vacuum-tube", key: "pump_s", how: "rel", more: "pump {it} slower", less: "pump {it} faster", why: "a faster pump empties it before the drop" },
		{ type: "wind-tunnel", key: "speed", how: "rel", more: "turn {it}'s fan up", less: "turn {it}'s fan down", why: "the air through it moves at this speed: drag and lift grow as its square" },
		{ type: "anemometer", key: "height", how: "m", more: "raise {it}'s cups", less: "lower {it}'s cups", why: "its cups read the air where they are: put them in the fan's stream" }
	],
	place: {
		containers: ["vacuum-jar", "wind-tunnel", "vacuum-tube"],
	inside: { "party-balloon": ["vacuum-jar", "vacuum-tube"], "card-glass": ["vacuum-jar"], "suction-cup": ["vacuum-jar"], "anemometer": ["wind-tunnel"], "incense-stick": ["wind-tunnel"], kite: ["wind-tunnel"] },
		/** A vacuum jar's inside in its own frame (m from its anchor, the middle of its plate's bottom); a wind tunnel's (from the middle of its floor's top). */
		interior(type, props) {
			if (type === "wind-tunnel") {
				const L = Number.isFinite(props?.length) ? props.length : 1.2
				const H = Number.isFinite(props?.height) ? props.height : 0.3
				return { x0: -L / 2, x1: L / 2, floor: 0.0, rim: H }
			}
			if (type === "vacuum-tube") {
			const W = Number.isFinite(props?.width) ? props.width : 0.3
			const H = Number.isFinite(props?.length) ? props.length : 1.5
			return { x0: -W / 2, x1: W / 2, floor: 0.03, rim: 0.03 + H }
		}
		if (type !== "vacuum-jar") return null
			const W = Number.isFinite(props?.width) ? props.width : 0.3
			const H = Number.isFinite(props?.height) ? props.height : 0.35
			return { x0: -W / 2, x1: W / 2, floor: 0.02, rim: 0.02 + H }
		}
	},
	digest(item, run) {
		if (!AIR_TYPES.includes(item?.type)) return null
		const id = item.id
		const P = run?.resolved?.[id] ?? item.props ?? {}
		const out = []
		if (item.type === "party-balloon") {
			const popped = firstAt(run, id, "popped", (v) => v >= 1)
			const d0 = startOf(run, id, "diameter_cm")
			const lift = startOf(run, id, "lift_g")
			if (d0 !== null) out.push(`${P.gas ?? "air"}, ${trimNum(P.fill_l ?? 8, 1)} L put in: ${trimNum(d0, 1)} cm across at the start (${trimNum(startOf(run, id, "pressure_kpa"), 2)} kPa over the air outside; it pops past about ${trimNum((P.size ?? 0.28) * 130, 0)} cm); net lift ${trimNum(lift, 1)} g (${lift > 0 ? "it rises" : "it sinks slowly"})`)
			if (popped !== null) out.push(`it POPPED at ${trimNum(popped, 2)} s`)
			else if (d0 !== null) out.push(`at the end ${trimNum(endOf(run, id, "diameter_cm"), 1)} cm across, ${trimNum(endOf(run, id, "volume_l"), 2)} L`)
			if (P.tied === false) out.push(`untied: its jet pushed ${trimNum(maxOf(run, id, "thrust_n") ?? 0, 3)} N at most (it flies away from where its neck points)`)
		} else if (item.type === "hot-air-balloon") {
			const t0 = startOf(run, id, "inside_c")
			if (t0 !== null) out.push(`air inside ${trimNum(t0, 1)} → ${trimNum(endOf(run, id, "inside_c"), 1)} °C (most ${trimNum(maxOf(run, id, "inside_c"), 1)}); net lift at the end ${trimNum(endOf(run, id, "net_g"), 1)} g; it rose ${trimNum(maxOf(run, id, "height_m") ?? 0, 2)} m at most (${trimNum(endOf(run, id, "height_m"), 2)} m at the end)`)
		} else if (item.type === "paper-airplane") {
			const d = endOf(run, id, "distance_m")
			const flying = endOf(run, id, "flying")
			if (d !== null) out.push(flying === 1 ? `still flying at the end, ${trimNum(d, 2)} m from where it was thrown (give it more room or time)` : `flew ${trimNum(d, 2)} m before it landed; top speed ${trimNum(maxOf(run, id, "speed_ms"), 1)} m/s`)
		} else if (item.type === "kite") {
			const w = maxOf(run, id, "wind_ms")
			if (w !== null && w < 1) out.push(`NO wind reaches it (${trimNum(w, 2)} m/s): add a breeze blowing toward its side (${P.toward ?? "right"}) or a big fan`)
			else if (w !== null) out.push(`at the end ${trimNum(endOf(run, id, "height_m"), 2)} m above its stake, line at ${trimNum(endOf(run, id, "line_angle_deg"), 0)}°, wind there ${trimNum(endOf(run, id, "wind_ms"), 1)} m/s, pull ${trimNum(endOf(run, id, "pull_n"), 2)} N`)
		} else if (item.type === "incense-stick") {
			const dx = endOf(run, id, "drift_m")
			if (dx !== null) out.push(`its smoke drifts ${trimNum(Math.abs(dx), 2)} m ${dx >= 0 ? "right" : "left"} and rises ${trimNum(endOf(run, id, "rise_m"), 2)} m on average`)
		} else if (item.type === "anemometer") {
			const w = endOf(run, id, "wind_ms")
			if (w !== null) out.push(`reads ${trimNum(w, 2)} m/s at the end (most ${trimNum(maxOf(run, id, "wind_ms"), 2)})${w < 0.1 ? ": no stream reaches its cups" : ""}`)
		} else if (item.type === "wind-tunnel") {
			out.push(`blows ${trimNum(P.speed ?? 5, 1)} m/s ${P.blows ?? "to the right"} through its ${trimNum((P.length ?? 1.2) * 100, 0)} × ${trimNum((P.height ?? 0.3) * 100, 0)} cm duct from ${trimNum(P.on_at ?? 0, 1)} s`)
		} else if (item.type === "vacuum-jar") {
			const p = endOf(run, id, "pressure_kpa")
			if (p !== null) out.push(`pressure inside ${trimNum(startOf(run, id, "pressure_kpa"), 1)} → ${trimNum(p, 2)} kPa`)
		} else if (item.type === "card-glass") {
			const fell = firstAt(run, id, "holding", (v) => v < 0.5)
			const push = startOf(run, id, "push_n")
			if (push !== null) out.push(fell === null ? `the card HOLDS: the air pushes up on it with ${trimNum(push, 0)} N` : `the card FELL at ${trimNum(fell, 2)} s (water ${trimNum((P.water ?? 0.8) * 100, 0)} %, the air outside ${trimNum(endOf(run, id, "outside_kpa"), 1)} kPa)`)
		} else if (item.type === "suction-cup") {
			const fell = firstAt(run, id, "holding", (v) => v < 0.5)
			const hold = startOf(run, id, "hold_n")
			if (hold !== null) out.push(fell === null ? `it HOLDS ${trimNum(maxOf(run, id, "pull_n"), 1)} N of the most ${trimNum(hold, 1)} N the air can hold` : `it LET GO at ${trimNum(fell, 2)} s (${trimNum(P.load_kg ?? 1, 1)} kg pulls about ${trimNum(((P.load_kg ?? 1) + 0.055) * 9.81, 1)} N; the air could hold ${trimNum(hold, 1)} N)`)
		} else if (item.type === "steam-can") {
			const t = firstAt(run, id, "crushed", (v) => v >= 0.05)
			if (series(run, id, "crushed")) out.push(t === null ? `NOT crushed (inside ${trimNum(endOf(run, id, "inside_kpa"), 1)} kPa at the end)` : `crushed at ${trimNum(t, 2)} s, ${trimNum(endOf(run, id, "crushed") * 100, 0)} % of its volume pushed in (inside ${trimNum(endOf(run, id, "inside_kpa"), 1)} kPa against the room's 101.3)`)
		}
		return out.length ? out : null
	},
	words: {
		change(type, key, a, b) {
			const n = (v) => (typeof v === "number" ? trimNum(v, 2) : String(v))
			if (type === "party-balloon" && key === "fill_l") return `gas in it ${n(a)} → ${n(b)} L`
			if (type === "party-balloon" && key === "size") return `rated size ${cm(a)} → ${cm(b)}`
			if (type === "party-balloon" && key === "weight_g") return `weight on its string ${n(a)} → ${n(b)} g`
			if (type === "party-balloon" && key === "string_m") return `string ${cm(a)} → ${cm(b)}`
			if (type === "party-balloon" && key === "pump_lps") return `pump ${n(a)} → ${n(b)} L/s`
			if (type === "party-balloon" && key === "tied") return b ? "tied its neck" : "untied its neck"
			if (type === "hot-air-balloon" && key === "heater_w") return `heat gun ${n(a)} → ${n(b)} W`
			if (type === "hot-air-balloon" && key === "start_c") return `air inside at the start ${n(a)} → ${n(b)} °C`
			if (type === "hot-air-balloon" && key === "payload_g") return `payload ${n(a)} → ${n(b)} g`
			if (type === "hot-air-balloon" && key === "size") return `envelope ${cm(a)} → ${cm(b)} across`
			if (type === "hot-air-balloon" && key === "tether_m") return `tether ${cm(a)} → ${cm(b)}`
			if (type === "paper-airplane" && key === "launch_speed") return `thrown at ${n(a)} → ${n(b)} m/s`
			if (type === "paper-airplane" && key === "launch_angle") return `thrown up at ${n(a)}° → ${n(b)}°`
			if (type === "paper-airplane" && key === "elevator") return `tail flaps up ${n(a)}° → ${n(b)}°`
			if (type === "paper-airplane" && key === "nose_clips") return `paper clips on its nose ${n(a)} → ${n(b)}`
			if (type === "kite" && key === "line_m") return `line ${n(a)} → ${n(b)} m`
			if (type === "kite" && key === "bridle") return `line tied ${trimNum(a * 100, 0)} → ${trimNum(b * 100, 0)} % down from its nose`
			if (type === "kite" && key === "tail_m") return `tail ${n(a)} → ${n(b)} m`
			if (type === "suction-cup" && key === "load_kg") return `weight on it ${n(a)} → ${n(b)} kg`
			if (type === "suction-cup" && key === "diameter") return `cup ${cm(a)} → ${cm(b)} across (holds ${trimNum((35 * Math.PI * a * a) / 4 * 1000, 0)} → ${trimNum((35 * Math.PI * b * b) / 4 * 1000, 0)} N on glass)`
			if (type === "card-glass" && key === "water") return `water ${trimNum(a * 100, 0)} → ${trimNum(b * 100, 0)} % full`
			if (type === "steam-can" && key === "boil_s") return `boiled ${n(a)} → ${n(b)} s`
			if (type === "steam-can" && key === "bath_c") return `dish water ${n(a)} → ${n(b)} °C`
			if (type === "vacuum-jar" && key === "lowest_kpa") return `pumped down to ${n(a)} → ${n(b)} kPa`
			if (type === "vacuum-jar" && key === "pump_s") return `pumping time ${n(a)} → ${n(b)} s`
			return null
		},
		keys: {
			"party-balloon.fill_l": "air|blow\\w*|inflat\\w*|fill\\w*|litre\\w*|liter\\w*|gas",
			"party-balloon.gas": "helium|air",
			"party-balloon.tied": "tie|tied|tying|untie\\w*|knot\\w*|neck",
			"party-balloon.weight_g": "weight|heav\\w*|light\\w*",
			"hot-air-balloon.heater_w": "heat\\w*|hotter|power|watt\\w*",
			"hot-air-balloon.payload_g": "payload|load|weight|cargo",
			"paper-airplane.launch_speed": "throw\\w*|fast\\w*|speed|harder",
			"paper-airplane.launch_angle": "angle|upward\\w*|higher|tilt\\w*",
			"paper-airplane.elevator": "flap\\w*|elevator|tail",
			"paper-airplane.nose_clips": "clip\\w*|nose|weight",
			"kite.line_m": "line|string|longer|shorter",
			"suction-cup.load_kg": "weight|kg|kilo\\w*|load|heav\\w*",
			"card-glass.water": "water|empty|full",
			"steam-can.boil_s": "boil\\w*|heat\\w*|steam"
		}
	}
}
