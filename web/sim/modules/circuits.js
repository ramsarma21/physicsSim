// The circuits module's port (machines/mod_circuits.py, line for line: the same document, number for number) and its plug-ins for the AI
// (goal kinds, how-to, prompt lines, the edit step's readings, the make-it-work knobs, change words). It imports nothing: everything comes
// from the framework object register_all gets (web/sim/items.js FRAMEWORK; F.py is pymath.js).
//
// Every circuit item's builder lists its electrical parts and terminals; a build hook gathers them and every wire into ONE engine process
// {kind: "circuit", ...} (tooling/src/sim/modules/circuits.ts), solved every 480 Hz step. Terminals: every part has a first ("+": on its right:
// a battery's +, an LED's anode, a bulb's or a switch's a) and a second ("-": on its left). A wire's ends name an item (links a, b) and which
// of its terminals ("+" or "-"). Sources: see the Python file's header (Energizer, ASTM B258, CRC, IES, Kingbright, Mabuchi).
let F = null
let register, ItemType, Prop, Link, Readout, register_goal_kind, register_build_hook, MATERIALS, add_look, define_material, props_of, TYPES, CATEGORIES, Ctx
let pyRound, truthy, fmtF, pySum, maxOf, minOf, cos, sin

const CAT = "Electricity"
const BASE_H = 0.012
const POST_W = 0.008
const POST_H = 0.01
const WIRE_OHM_M = 0.053
const SWITCH_OHM = 0.01
const WIRE_COLORS = ["red", "black", "blue", "yellow", "green", "white"]
const CELL_CURVE = [[0.0, 0.9], [10.0, 1.1], [50.0, 1.3], [100.0, 1.58]]
const BATTERY_KINDS = {
	"AA": { cells: 1, r: 0.2, w: 0.0505, h: 0.0145, d: 0.0145, mass: 0.023 },
	"D": { cells: 1, r: 0.1, w: 0.0615, h: 0.0342, d: 0.0342, mass: 0.14 },
	"9V": { cells: 6, r: 1.7, w: 0.0265, h: 0.0485, d: 0.0175, mass: 0.045 },
	"lantern 6V": { cells: 4, r: 0.3, w: 0.067, h: 0.115, d: 0.067, mass: 0.6 }
}
const BULB_RATINGS = { "2.5V 0.3A": [2.5, 0.3], "2.25V 0.25A": [2.25, 0.25], "3.8V 0.3A": [3.8, 0.3], "6V 0.06A": [6.0, 0.06] }
const LED_COLORS = { red: [2.0, 10.0, "#ff2a1a"], yellow: [2.1, 10.0, "#ffc81a"], green: [2.2, 10.0, "#2aff3a"], blue: [3.2, 15.0, "#2a6aff"], white: [3.2, 15.0, "#f4f6ff"] }
const LED_I_RATED = 0.02
const LED_I_MAX = 0.03
let MOTORS = null
const RESISTIVITY = {
	"copper": 1.68e-8, "brass": 6.4e-8, "aluminium": 2.65e-8, "aluminium can": 2.65e-8, "glass & aluminium": 2.65e-8, "steel": 1.43e-7,
	"steel weight": 1.43e-7, "cupronickel": 3.8e-7, "graphite": 1e-5,
	"fruit": 20.0,
	"ice": 1e6, "glass": 1e12, "glass marble": 1e12, "solid rubber": 1e13, "rubber mat": 1e13, "tyre rubber": 1e13, "vinyl rubber": 1e13,
	"varnished hardwood": 1e14, "domino wood": 1e14, "dark wood": 1e14, "hollow plastic": 1e15, "ABS plastic": 1e15, "polypropylene": 1e15,
	"modeling clay": 1e10
}
const TYPES_OF = ["battery", "bulb", "led", "switch", "buzzer", "motor", "resistor", "dimmer", "tester", "meter", "solar-panel", "hand-generator",
	"electromagnet", "coil", "straight-wire", "wind-turbine", "generator"]
// what drives current round a loop (a wire end whose terminal is not said is joined + of a source to + of a load: _ends); the energy module's wind
// turbine and small generator are sources too (web/sim/modules/energy.js puts their parts and terminals in this module's store)
const SOURCES = ["battery", "solar-panel", "hand-generator", "wind-turbine", "generator"]
// a battery car (a motor that drives "wheels"): the cars it may ride on, and each motor's own weight (the Python file's CARS, MOTOR_MASS)
const CARS = ["toy-car", "cart", "truck", "dynamics-cart"]
const MOTOR_MASS = { hobby: 0.018, solar: 0.022, geared: 0.03 }
// electromagnetism (the Python file's sources: ASTM B258 enamelled and bare copper, Chikazumi's low-carbon steel, a school galvanometer)
const AWG24_D = 0.000511
const AWG24_OHM = 0.0842
const AWG28_D = 0.000321
const AWG28_OHM = 0.2129
const AWG14_D = 0.001628
const AWG14_OHM = 0.00828
const NAIL_MS = 1.6e6
const NAIL_CHI = 1000.0
const GALVO_FS = 0.0005
const GALVO_OHM = 50.0
const COIL_TUBE = 0.002
// a solar panel's cells' electric efficiency per optics band (the Python file's PV_EFF)
const PV_EFF = [0.0399, 0.0532, 0.0606, 0.0662, 0.0713, 0.0759, 0.0868, 0.0553]

export function register_all(f) {
	F = f
	;({ register, ItemType, Prop, Link, Readout, register_goal_kind, register_build_hook, MATERIALS, add_look, define_material, props_of, TYPES, CATEGORIES, Ctx } = f)
	;({ pyRound, truthy, fmtF, pySum, maxOf, minOf, cos, sin } = f.py)
	MOTORS = {
		hobby: { k: pyRound((3 - 0.2 * (3 / 2.2)) / ((9100 * 2 * Math.PI) / 60), 7), r: pyRound(3 / 2.2, 4), eff: 1.0, fric: pyRound((0.2 * (3 - 0.2 * (3 / 2.2))) / ((9100 * 2 * Math.PI) / 60), 7), can: [0.038, 0.02] },
		solar: { k: 0.0085, r: 12.0, eff: 1.0, fric: 0.00021, can: [0.026, 0.024] },
		geared: { k: 0.26, r: 2.5, eff: 0.6, fric: 0.004, can: [0.07, 0.022] }
	}
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
	_materials()
	_types()
	register_build_hook(_mount_on_cars) // (before _gather: a battery car's motor rides on its car, its terminals there)
	register_build_hook(_gather)
	// (stays_dark and glows_brighter, not dark and brighter: the optics module's light-meter goals have those names)
	for (const [kind, fn] of [["lights", goal_lights], ["stays_dark", goal_dark], ["glows_brighter", goal_brighter], ["buzzes", goal_buzzes], ["spins", goal_spins], ["current", goal_current], ["conducts", goal_conducts], ["deflects", goal_deflects], ["induces", goal_induces]])
		register_goal_kind(kind, fn)
}

/** Whether another module is loaded (its type is in the catalog): checked at build time, when every module has registered. */
function _module_on(typeKey, module) {
	const t = Object.prototype.hasOwnProperty.call(TYPES, typeKey) ? TYPES[typeKey] : undefined
	return t !== undefined && t.module === module
}

/** Whether the scene has light the optics module traces: one of its items, or the heat module's desk lamp. */
function _lit_scene(c) {
	if (!_module_on("flashlight", "optics")) return false
	for (const it of c.sb.scene_items.values()) {
		const t = Object.prototype.hasOwnProperty.call(TYPES, it.type) ? TYPES[it.type] : undefined
		if (t !== undefined && (t.module === "optics" || (it.type === "lamp" && t.module === "heat"))) return true
	}
	return false
}

function _materials() {
	if (!(Object.prototype.hasOwnProperty.call(MATERIALS, "copper"))) {
		add_look("copper", { fill: "#c8743c", shade: "#8f4f24", roughness: 0.3, metalness: 1.0, clearcoat: 0.0 })
		define_material("copper", { density: 8960, bounce: 0.6, friction: 0.4, rolling: 0.002, side: 0.0, look: "copper", source: "Copper 8960 kg/m³; resistivity 1.68e-8 Ω·m at 20 °C (CRC)." }, ["density"])
	}
	if (!(Object.prototype.hasOwnProperty.call(MATERIALS, "brass"))) {
		add_look("brass", { fill: "#c9a640", shade: "#8d7226", roughness: 0.3, metalness: 1.0, clearcoat: 0.0 })
		define_material("brass", { density: 8500, bounce: 0.6, friction: 0.4, rolling: 0.002, side: 0.0, look: "brass", source: "Brass 8400-8700 kg/m³; resistivity about 6.4e-8 Ω·m (CRC)." }, ["density"])
	}
	if (!(Object.prototype.hasOwnProperty.call(MATERIALS, "graphite"))) {
		add_look("graphite", { fill: "#3b3d40", shade: "#1f2022", roughness: 0.45, metalness: 0.3, clearcoat: 0.0 })
		define_material("graphite", { density: 2000, bounce: 0.3, friction: 0.2, rolling: 0.01, side: 0.0, look: "graphite", source: "A pencil's lead: graphite and clay, about 2000 kg/m³ (provisional); resistivity about 1e-5 Ω·m (CRC, graphite)." }, ["density"])
	}
	if (!(Object.prototype.hasOwnProperty.call(MATERIALS, "circuit plastic"))) {
		add_look("circuit plastic", { fill: "#2b2d31", shade: "#151618", roughness: 0.4, metalness: 0.0, clearcoat: 0.3 })
		define_material("circuit plastic", { density: 1100, bounce: 0.5, friction: 0.4, rolling: 0.01, side: 0.0, look: "circuit plastic", source: "ABS and polycarbonate cases, 1050-1200 kg/m³ (provisional)." }, ["density"])
	}
}

// ---------------------------------------------------------------- helpers
const _num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)

function _store(sb) {
	if (!sb.circuit) sb.circuit = { parts: [], terminals: {}, wires: [], boards: [] }
	return sb.circuit
}
const _name = (c) => (truthy(c.item.name) ? c.item.name : TYPES[c.item.type].name)
const _on_board = (c, P) => P.mount === "board"
const _kind = (c, P) => (_on_board(c, P) ? "static" : null)

function _weld(c, parent, lx, ly, plx = 0.0, ply = 0.0) {
	const s = c.sb.solids[c.sb.solids.length - 1]
	s.parent = parent
	s.at = { x: pyRound(lx - plx, 5), y: pyRound(ly - ply, 5) }
	delete s.angle
	return s.id
}

function _terminal(c, name, solid, x, y) {
	_store(c.sb).terminals[`${c.item.id}/${name}`] = { solid, at: { x: pyRound(x, 5), y: pyRound(y, 5) } }
}

function _part(c, kind, role, fields = {}) {
	const iid = c.item.id
	const p = { kind, id: `${iid}/${role ?? kind}`, item: iid, name: _name(c), a: `${iid}/+`, b: `${iid}/-` }
	if (role) p.role = role
	Object.assign(p, fields)
	_store(c.sb).parts.push(p)
	return p
}

function _base(c, P, w, d, kind = null) {
	kind = kind ?? _kind(c, P)
	const wood = c.mat({ base: "varnished hardwood", overrides: {} })
	const base = c.slab("base", w, BASE_H, d, 0.0, 0.0, { material: wood, look: "wood", words: "a small wooden base board", kind })
	const brass = c.mat({ base: "brass", overrides: {} })
	for (const [name, sx] of [["+", 1], ["-", -1]]) {
		const x = sx * (w / 2 - 0.009)
		c.slab(sx > 0 ? "post_plus" : "post_minus", POST_W, POST_H, 0.008, x, BASE_H / 2 + POST_H / 2, { material: brass, look: "brass", words: "a brass terminal", kind })
		_weld(c, base, x, BASE_H / 2 + POST_H / 2)
		_terminal(c, name, base, x, BASE_H / 2 + POST_H)
	}
	return base
}

const _mount_prop = () =>
	new Prop("mount", "Stands on", "table", { kind: "choice", choices: ["table", "board"], help: "table: on its own base board, free to be knocked; board: clipped to a circuit board (fixed where it is put), drawn on the board behind it" })

function _cell_volts(pct) {
	pct = Math.max(0.0, Math.min(100.0, pct))
	for (let i = 0; i + 1 < CELL_CURVE.length; i++) {
		const [p0, v0] = CELL_CURVE[i]
		const [p1, v1] = CELL_CURVE[i + 1]
		if (pct <= p1) return v0 + ((v1 - v0) * (pct - p0)) / (p1 - p0)
	}
	return CELL_CURVE[CELL_CURVE.length - 1][1]
}

// ---------------------------------------------------------------- the types
function _types() {
	const common = { module: "circuits", material: null }

	// --- battery
	function build_battery(c, P) {
		const kind = BATTERY_KINDS[P.kind]
		const n = P.kind === "AA" || P.kind === "D" ? Math.trunc(P.cells) : 1
		const { w, h, d } = kind
		const cells_in_holder = P.kind === "AA" || P.kind === "D"
		const plastic = c.mat({ base: "circuit plastic", density: pyRound(kind.mass / (w * h * d), 2), overrides: {} })
		const depth = pyRound(d * n + (n > 1 || cells_in_holder ? 0.004 : 0.0), 5)
		const hold_h = h + (cells_in_holder ? 0.003 : 0.0)
		const body = c.slab("body", w + (cells_in_holder ? 0.008 : 0.0), hold_h, depth, 0.0, 0.0, { material: plastic, look: "circuit plastic", words: "a battery", kind: _kind(c, P) })
		const brass = c.mat({ base: "brass", overrides: {} })
		const top = hold_h / 2
		const tx = cells_in_holder ? w / 2 - 0.006 : P.kind === "9V" ? 0.006 : w / 2 - 0.012
		for (const [name, sx] of [["+", 1], ["-", -1]]) {
			c.slab(sx > 0 ? "post_plus" : "post_minus", 0.006, 0.006, 0.006, sx * tx, top + 0.003, { material: brass, look: "brass", words: "a battery terminal", kind: _kind(c, P) })
			_weld(c, body, sx * tx, top + 0.003)
			_terminal(c, name, body, sx * tx, top + 0.006)
		}
		const pct = P.charge_pct
		const cells = kind.cells * n
		const emf = pyRound(_cell_volts(pct) * cells, 5)
		const r = pyRound(kind.r * n * (2 - pct / 100), 5)
		_part(c, "battery", null, { emf, r })
	}
	register(new ItemType("battery", "Battery", CAT, build_battery, {
		...common,
		props: [
			new Prop("kind", "Kind", "AA", { kind: "choice", choices: Object.keys(BATTERY_KINDS), help: "AA or D cells in a holder; a 9 V battery; a 6 V lantern battery" }),
			new Prop("cells", "Cells in the holder", 2, 1, 6, 1, "", "AA or D cells in series (2 x AA = 3 V)", { kind: "int" }),
			new Prop("charge_pct", "Charge", 100.0, 0.0, 100.0, 1.0, "%", "A fresh battery is 100 %; a run-down one gives less voltage and has more resistance inside"),
			_mount_prop()
		],
		readouts: [new Readout("voltage", "Voltage at its terminals", { unit: "V", digits: 2 }), new Readout("current", "Current out of +", { unit: "A", digits: 3 })],
		tags: ["cell", "AA", "power", "electricity", "battery pack", "9 volt", "D cell", "energy", "source", "holder"],
		description: "Alkaline cells in a holder (2 x AA = 3 V). Its + terminal is on the right, − on the left; wires join them to the rest of a circuit.",
		source: "Alkaline AA: 1.58 V fresh on open circuit, about 0.2 Ω inside, falling to about 1.3 V at half charge and 1.1 V near empty; 9 V about 1.7 Ω (Energizer E91 and 522 data sheets).",
		anchor: "the middle of the holder", facts: "2 x AA · 3.2 V fresh · 0.4 Ω inside"
	}))

	// --- wire
	function build_wire(c, P) {
		const own = c.item.props ?? {}
		const has = (k) => Object.prototype.hasOwnProperty.call(own, k)
		_store(c.sb).wires.push({
			item: c.item.id, name: _name(c), a: c.link("a"), a_end: P.a_end, b: c.link("b"), b_end: P.b_end, a_auto: !has("a_end"), b_auto: !has("b_end"),
			length: has("length") ? _num(own.length) : null, color: P.color, P
		})
	}
	register(new ItemType("wire", "Wire", CAT, build_wire, {
		dynamic: false, ...common,
		props: [
			new Prop("a_end", "End a on terminal", "+", { kind: "choice", choices: ["+", "-"], help: "+ is a part's first terminal (a battery's +, an LED's long leg, a bulb's right screw); - its second. Not set: joined as current flows (a battery's + to a part's +, a part's − on to the next part's + or the battery's −)" }),
			new Prop("b_end", "End b on terminal", "-", { kind: "choice", choices: ["+", "-"], help: "Which terminal of the second item (not set: as current flows from end a's)" }),
			new Prop("length", "Length", 0.3, 0.05, 3.0, 0.01, "m", "Automatic: a little longer than the gap between its ends at the start. Pulled farther apart than this, it comes off", { auto: true }),
			new Prop("color", "Colour", "red", { kind: "choice", choices: WIRE_COLORS })
		],
		links: [new Link("a", "End a clips to", { types: [...TYPES_OF], help: "The part its end a is clipped to" }), new Link("b", "End b clips to", { types: [...TYPES_OF], help: "The part its end b is clipped to" })],
		readouts: [new Readout("current", "Current", { unit: "A", digits: 3 }), new Readout("off", "Pulled off", { unit: "", digits: 0 })],
		tags: ["lead", "cable", "connector", "crocodile clip", "alligator", "conductor", "connect", "circuit", "copper", "jumper"],
		description: "A copper lead with crocodile clips. Clip end a and end b to two terminals (+ or −) of two parts; an end clipped to nothing leaves the circuit open.",
		source: "22 AWG copper hookup wire: 0.053 Ω per metre at 20 °C (ASTM B258 wire tables).",
		anchor: "(it has no place of its own: it runs between its two ends)", facts: "22 AWG copper · 0.053 Ω/m"
	}))

	// --- bulb
	function build_bulb(c, P) {
		const [v, i] = BULB_RATINGS[P.rating]
		const board = _on_board(c, P)
		const glass = "glass" in MATERIALS ? c.mat({ base: "glass", overrides: {} }) : c.mat({ base: "steel", overrides: {} })
		const brass = c.mat({ base: "brass", overrides: {} })
		let holder
		let hy
		let root
		if (board) {
			holder = c.slab("holder", 0.024, 0.016, 0.024, 0.0, 0.0, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "a bulb holder", kind: "static" })
			hy = 0.0
			root = holder
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, holder, sx * 0.012, 0.0)
		} else {
			root = _base(c, P, 0.06, 0.045)
			hy = BASE_H / 2 + 0.008
			holder = c.slab("holder", 0.024, 0.016, 0.024, 0.0, hy, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "a bulb holder" })
			_weld(c, root, 0.0, hy)
		}
		const cy = hy + 0.008 + 0.005
		c.slab("cap", 0.009, 0.01, 0.009, 0.0, cy, { material: brass, look: "brass", words: "a bulb's screw cap", kind: _kind(c, P) })
		_weld(c, root, 0.0, cy)
		const gy = cy + 0.005 + 0.0055
		c.ball("glass", 0.0055, 0.0, gy, { material: glass, look: "glass", words: "a small light bulb", kind: _kind(c, P) })
		_weld(c, root, 0.0, gy)
		_terminal(c, "glow", root, 0.0, gy)
		_part(c, "bulb", null, { v_rated: v, i_rated: i })
	}
	register(new ItemType("bulb", "Bulb", CAT, build_bulb, {
		...common,
		props: [new Prop("rating", "Rating", "2.5V 0.3A", { kind: "choice", choices: Object.keys(BULB_RATINGS), help: "The voltage it is made for and the current it then takes" }), _mount_prop()],
		readouts: [
			new Readout("light", "Brightness", { unit: "x full", digits: 2, help: "Its light against its light at its rated voltage" }), new Readout("current", "Current", { unit: "A", digits: 3 }),
			new Readout("voltage", "Voltage across it", { unit: "V", digits: 2 }), new Readout("temp_c", "Filament", { unit: "°C", digits: 0 }), new Readout("broken", "Burnt out", { unit: "", digits: 0 })
		],
		tags: ["lamp", "light bulb", "torch bulb", "MES", "filament", "glow", "light", "incandescent", "circuit", "brightness"],
		description: "A small torch bulb (2.5 V 0.3 A) in a holder with two screw terminals. It glows when current flows through it: brighter with more voltage, dull orange on too little, and it burns out on far too much.",
		source: "A tungsten filament: its resistance rises about 13 times from cold to its 2500 K glow, so it is not a fixed resistor; light ∝ V^3.4 (IES Lighting Handbook); it heats and cools in a few hundredths of a second.",
		anchor: "the middle of its base board", facts: "2.5 V 0.3 A · 8.3 Ω hot, 0.6 Ω cold"
	}))

	// --- LED
	function build_led(c, P) {
		const [vf, rs, glow] = LED_COLORS[P.color]
		const board = _on_board(c, P)
		let holder
		let hy
		let root
		if (board) {
			holder = c.slab("holder", 0.014, 0.008, 0.014, 0.0, 0.0, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "an LED holder", kind: "static" })
			hy = 0.0
			root = holder
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, holder, sx * 0.007, 0.0)
		} else {
			root = _base(c, P, 0.05, 0.04)
			hy = BASE_H / 2 + 0.004
			holder = c.slab("holder", 0.014, 0.008, 0.014, 0.0, hy, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "an LED holder" })
			_weld(c, root, 0.0, hy)
		}
		const ly = hy + 0.004 + 0.003
		c.slab("body", 0.005, 0.006, 0.005, 0.0, ly, { material: c.mat({ base: "hollow plastic", overrides: {} }), look: "plastic", words: "a light-emitting diode", kind: _kind(c, P), color: glow })
		_weld(c, root, 0.0, ly)
		c.ball("dome", 0.0025, 0.0, ly + 0.003, { material: c.mat({ base: "hollow plastic", overrides: {} }), look: "plastic", words: "an LED's domed top", kind: _kind(c, P), color: glow })
		_weld(c, root, 0.0, ly + 0.003)
		_terminal(c, "glow", root, 0.0, ly + 0.003)
		_part(c, "led", null, { vf, i_rated: LED_I_RATED, rs, i_max: LED_I_MAX })
	}
	register(new ItemType("led", "LED", CAT, build_led, {
		...common,
		props: [new Prop("color", "Colour", "red", { kind: "choice", choices: Object.keys(LED_COLORS) }), _mount_prop()],
		readouts: [
			new Readout("light", "Brightness", { unit: "x full", digits: 2, help: "Its light against its light at 20 mA" }), new Readout("current", "Current", { unit: "A", digits: 4 }),
			new Readout("voltage", "Voltage across it", { unit: "V", digits: 2 }), new Readout("broken", "Burnt out", { unit: "", digits: 0 })
		],
		tags: ["light emitting diode", "diode", "indicator", "lamp", "glow", "light", "polarity", "one way", "circuit", "resistor"],
		description: "A 5 mm LED. Current goes through it only one way, from its + (anode, long leg) to its − (cathode); it needs a resistor in series, or over 30 mA burns it out.",
		source: "Typical 5 mm LED data sheets (Kingbright WP7113): 2.0 V (red) to 3.2 V (blue, white) at 20 mA, 30 mA the most continuous current; light ∝ current.",
		anchor: "the middle of its base board", facts: "red · 2.0 V at 20 mA · 30 mA most"
	}))

	// --- switch
	function build_switch(c, P) {
		const board = _on_board(c, P)
		const style = P.style
		const plastic = c.mat({ base: "circuit plastic", overrides: {} })
		let top
		let parent
		let py0
		if (board) {
			const body = c.slab("body", 0.05, 0.012, 0.03, 0.0, 0.0, { material: plastic, look: "circuit plastic", words: "a switch", kind: "static" })
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, body, sx * 0.025, 0.0)
			top = 0.006
			parent = body
			py0 = 0.0
		} else {
			parent = _base(c, P, 0.07, 0.04)
			top = BASE_H / 2
			py0 = 0.0
		}
		if (style === "push") {
			c.slab("housing", 0.024, 0.01, 0.024, 0.0, top + 0.005, { material: plastic, look: "circuit plastic", words: "a push switch", kind: _kind(c, P) })
			_weld(c, parent, 0.0, top + 0.005, 0.0, py0)
			const button = c.slab("button", 0.018, 0.006, 0.018, 0.0, top + 0.013, { material: c.mat({ base: "solid rubber", overrides: {} }), look: "rubber", words: "a push button", kind: _kind(c, P), color: "#d02020" })
			_weld(c, parent, 0.0, top + 0.013, 0.0, py0)
			const flips = [P.press_from, P.press_to].filter((t) => t > 0)
			_part(c, "switch", null, { closed: false, r: SWITCH_OHM, flips: P.press_from > 0 ? flips : [], press: { solid: button, force: P.force } })
			return
		}
		if (style === "knife") {
			c.slab("hinge", 0.01, 0.012, 0.016, -0.02, top + 0.006, { material: c.mat({ base: "brass", overrides: {} }), look: "brass", words: "a knife switch's hinge", kind: _kind(c, P) })
			_weld(c, parent, -0.02, top + 0.006, 0.0, py0)
			c.slab("clip", 0.008, 0.012, 0.016, 0.022, top + 0.006, { material: c.mat({ base: "brass", overrides: {} }), look: "brass", words: "a knife switch's clip", kind: _kind(c, P) })
			_weld(c, parent, 0.022, top + 0.006, 0.0, py0)
		} else {
			c.slab("toggle", 0.024, 0.012, 0.02, 0.0, top + 0.006, { material: plastic, look: "circuit plastic", words: "a toggle switch", kind: _kind(c, P) })
			_weld(c, parent, 0.0, top + 0.006, 0.0, py0)
		}
		const flips = [P.flip_at, P.flip_back_at].filter((t) => t > 0)
		_part(c, "switch", null, { closed: truthy(P.closed), r: SWITCH_OHM, flips })
	}
	register(new ItemType("switch", "Switch", CAT, build_switch, {
		...common,
		props: [
			new Prop("style", "Kind", "knife", { kind: "choice", choices: ["knife", "toggle", "push"], help: "push: closed only while it is pressed (by its time window, or by something resting on it)" }),
			new Prop("closed", "Closed at the start", false, { kind: "bool" }),
			new Prop("flip_at", "Switched at", 1.0, 0.0, 20.0, 0.05, "s", "When it is switched over (closed if it was open); 0: never"),
			new Prop("flip_back_at", "Switched back at", 0.0, 0.0, 20.0, 0.05, "s", "When it is switched back; 0: never"),
			new Prop("press_from", "Pressed from", 0.0, 0.0, 20.0, 0.05, "s", "Push switch: pressed by a finger from this moment; 0: only by what rests on it"),
			new Prop("press_to", "Pressed until", 0.0, 0.0, 20.0, 0.05, "s", "Push switch: let go at this moment"),
			new Prop("force", "Press force", 1.0, 0.05, 20.0, 0.05, "N", "Push switch: what rests on its button must weigh at least this (1 N: about 100 g)"),
			_mount_prop()
		],
		readouts: [new Readout("closed", "Closed", { unit: "", digits: 0 }), new Readout("current", "Current", { unit: "A", digits: 3 })],
		tags: ["knife switch", "toggle", "push button", "doorbell", "on off", "open", "closed", "break", "control", "circuit"],
		description: "A switch: closed, it lets current through; open, it breaks the loop. A knife switch is switched over at its set time (1 s by default); a push switch is closed only while pressed.",
		source: "A closed switch's contacts are about 0.01 Ω (provisional); an open one passes no current at all.",
		anchor: "the middle of its base board", facts: "knife switch · closes at 1 s"
	}))

	// --- buzzer
	function build_buzzer(c, P) {
		const board = _on_board(c, P)
		if (board) {
			const body = c.slab("body", 0.012, 0.0095, 0.012, 0.0, 0.0, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "a buzzer", kind: "static" })
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, body, sx * 0.006, 0.0)
		} else {
			const base = _base(c, P, 0.05, 0.04)
			c.slab("body", 0.012, 0.0095, 0.012, 0.0, BASE_H / 2 + 0.00475, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "a buzzer" })
			_weld(c, base, 0.0, BASE_H / 2 + 0.00475)
		}
		const v = P.volts
		_part(c, "buzzer", null, { r: pyRound((v - 0.7) / 0.025, 4), v_min: pyRound((v * 2) / 3, 4), v_rated: v, pitch: P.pitch })
	}
	register(new ItemType("buzzer", "Buzzer", CAT, build_buzzer, {
		...common,
		props: [new Prop("volts", "Rated voltage", 3.0, 1.5, 24.0, 0.5, "V"), new Prop("pitch", "Tone", 2700.0, 400.0, 5000.0, 50.0, "Hz"), _mount_prop()],
		readouts: [new Readout("sound", "Loudness", { unit: "x full", digits: 2 }), new Readout("pitch", "Tone", { unit: "Hz", digits: 0 }), new Readout("current", "Current", { unit: "A", digits: 3 })],
		tags: ["beeper", "piezo", "alarm", "sound", "noise", "doorbell", "tone", "electricity to sound", "circuit", "buzz"],
		description: "An active buzzer: it beeps (2.7 kHz) while current goes through it from its + to its −. It sounds from about 2 V on a 3 V buzzer; the wrong way round it is silent.",
		source: "Typical active buzzers: 3-12 V, 15-30 mA, 2.3-4 kHz, about 85 dB at 10 cm (makers' data sheets; provisional).",
		anchor: "the middle of its base board", facts: "3 V · 25 mA · 2.7 kHz"
	}))

	// --- motor
	function build_motor(c, P) {
		const m = MOTORS[P.kind]
		let drives = P.drives
		if (drives === "wheels") {
			const car = c.link("car")
			if (car !== null) {
				// a battery car: the motor rides on the car its link names, driving its rear wheel forward (_mount_on_cars puts it there)
				const st = _store(c.sb)
				if (!st.cars) st.cars = []
				st.cars.push({ motor: c.item.id, car, kind: P.kind })
				_part(c, "motor", null, { k: m.k, r: m.r, efficiency: m.eff, friction: m.fric, sense: -1 })
				return
			}
			drives = "none" // (on no car: a motor on its stand, turning nothing)
		}
		const size = P.size
		const board = _on_board(c, P)
		const steel = c.mat({ base: "steel", overrides: {} })
		const [L, D] = m.can
		const reach = drives === "paddle" || drives === "disc" || drives === "propeller" ? size / 2 : D / 2
		const prop = drives === "propeller" || drives === "none"
		const cx = prop ? -0.012 : 0.0
		const sy = board ? 0.0 : prop ? pyRound(BASE_H / 2 + Math.max(D / 2, reach) + 0.004, 5) : pyRound(BASE_H / 2 + POST_H + Math.max(D / 2, reach) + 0.012, 5)
		if (!board) {
			const base = _base(c, P, 0.08, 0.05, "static")
			if (drives === "propeller" || drives === "none") {
				c.slab("bracket", 0.004, sy - D / 2 - BASE_H / 2, 0.03, cx - 0.004, BASE_H / 2 + (sy - D / 2 - BASE_H / 2) / 2, { kind: "static", material: steel, look: "steel", words: "a motor bracket" })
				_weld(c, base, cx - 0.004, BASE_H / 2 + (sy - D / 2 - BASE_H / 2) / 2)
			}
		}
		if (drives === "propeller" || drives === "none") {
			const can = c.slab("can", L, D, D, cx, sy, { kind: "static", material: steel, look: "steel", words: "a small electric motor" })
			if (drives === "none") {
				_part(c, "motor", null, { k: m.k, r: m.r, efficiency: m.eff, friction: m.fric, fan: { inertia: 5e-8, drag: 0.0, solid: can, at: { x: pyRound(L / 2, 5), y: 0.0 }, direction: 0.0, diameter: 0.002, pitch: 0.0 } })
				return
			}
			const pm = pyRound(0.004 * (size / 0.1) * (size / 0.1), 6)
			const inertia = pyRound((pm * size * size) / 40 + 5e-8, 10)
			const drag = pyRound((0.01 * 1.2 * size * size * size * size * size) / (4 * Math.PI * Math.PI), 12)
			_part(c, "motor", null, {
				k: m.k, r: m.r, efficiency: m.eff, friction: m.fric,
				fan: { inertia, drag, solid: can, at: { x: pyRound(L / 2 + 0.006, 5), y: 0.0 }, direction: 0.0, diameter: pyRound(0.7 * size, 5), pitch: pyRound(0.45 * size, 5) }
			})
			return
		}
		const hub = c.ball("can", 0.006, 0.0, sy, { kind: "static", material: steel, look: "steel", words: "a small electric motor's shaft", depth3d: pyRound(L + 0.03, 5), shape: "cylinder" })
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		let rotor = null
		if (drives === "paddle") rotor = c.slab("rotor", size, 0.015, 0.012, 0.0, sy, { material: wood, look: "wood", words: "a paddle on a motor's shaft", pivot: { x: 0.0, y: 0.0 }, parent: hub })
		else if (drives === "disc")
			rotor = c.ball("rotor", size / 2, 0.0, sy, { material: c.mat({ base: "hollow plastic", density: pyRound((950 * 3 * 0.004) / (4 * (size / 2)), 4), overrides: {} }), look: "plastic", words: "a disc on a motor's shaft", pivot: { x: 0.0, y: 0.0 }, parent: hub, shape: "cylinder", length: 0.004, depth3d: 0.004, inertia: 0.5 })
		if (rotor !== null) {
			const s = c.sb.solids[c.sb.solids.length - 1]
			s.at = { x: 0.0, y: 0.0 }
			delete s.angle
			c.joint("pin", "shaft", { a: "can", b: "rotor", anchorA: [0, 0], anchorB: [0, 0], friction: m.fric, render: { hinge: "none" } })
		}
		_part(c, "motor", null, { k: m.k, r: m.r, efficiency: m.eff, friction: m.fric, ...(rotor ? { rotor, stator: hub } : {}) })
	}
	register(new ItemType("motor", "Electric motor", CAT, build_motor, {
		...common,
		props: [
			new Prop("kind", "Motor", "hobby", { kind: "choice", choices: ["hobby", "solar", "geared"], help: "hobby: a fast toy motor (FA-130: about 9000 rpm on 3 V); solar: turns on very little current; geared: a slow, strong 48:1 gear motor (about 100 rpm on 3 V)" }),
			new Prop("drives", "On its shaft", "propeller", { kind: "choice", choices: ["propeller", "paddle", "disc", "none", "wheels"], help: "propeller: a fan that blows to the right; paddle and disc turn facing you; wheels: it rides on the car its `car` link names and drives its rear wheels forward (a battery car: use the geared motor)" }),
			new Prop("size", "Attachment size", 0.1, 0.03, 0.4, 0.01, "m", "The propeller's or disc's diameter, the paddle's length"),
			_mount_prop()
		],
		links: [new Link("car", "Drives the wheels of", { types: [...CARS], help: "With On its shaft: wheels, the toy car, cart or truck it rides on and drives" })],
		readouts: [new Readout("rpm", "Speed", { unit: "rpm", digits: 0 }), new Readout("current", "Current", { unit: "A", digits: 3 }), new Readout("voltage", "Voltage across it", { unit: "V", digits: 2 }), new Readout("air", "Air speed", { unit: "m/s", digits: 2 })],
		tags: ["dc motor", "electric motor", "fan", "propeller", "spin", "rotor", "toy motor", "electricity to motion", "circuit", "turn"],
		description: "A small DC motor on a stand. Current through it from its + to its − turns its shaft counter-clockwise (swap its wires and it turns the other way); with a propeller it blows air to the right.",
		source: "A DC motor: torque = k·I and back-EMF = k·ω, so it speeds up until its back-EMF nearly cancels the battery's voltage. Hobby motor: Mabuchi FA-130 (9100 rpm and 0.2 A at 3 V with no load, 2.2 A stalled).",
		anchor: "the middle of its base board", facts: "FA-130 · 9100 rpm on 3 V · 10 cm propeller"
	}))

	// --- resistor
	function build_resistor(c, P) {
		const board = _on_board(c, P)
		if (board) {
			const body = c.slab("body", 0.016, 0.006, 0.006, 0.0, 0.0, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "a resistor", kind: "static" })
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, body, sx * 0.012, 0.0)
		} else {
			const base = _base(c, P, 0.06, 0.03)
			c.slab("body", 0.016, 0.006, 0.006, 0.0, BASE_H / 2 + 0.006, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "a resistor" })
			_weld(c, base, 0.0, BASE_H / 2 + 0.006)
		}
		_part(c, "resistor", null, { r: P.ohms })
	}
	register(new ItemType("resistor", "Resistor", CAT, build_resistor, {
		...common,
		props: [new Prop("ohms", "Resistance", 100.0, 1.0, 100000.0, 1.0, "Ω", "Its resistance (the colour bands show it)", { slider_max: 1000.0 }), _mount_prop()],
		readouts: [new Readout("current", "Current", { unit: "A", digits: 4 }), new Readout("voltage", "Voltage across it", { unit: "V", digits: 2 })],
		tags: ["ohm", "resistance", "carbon film", "limit", "current limiting", "colour bands", "ohms law", "circuit", "component", "load"],
		description: "A fixed resistor: it lets through current in proportion to the voltage across it (Ohm's law, I = V / R). Put one in series with an LED to keep its current safe.",
		source: "Ohm's law; a ¼ W carbon-film resistor (tolerance ±5 %).",
		anchor: "the middle of its base board", facts: "100 Ω"
	}))

	// --- dimmer
	function build_dimmer(c, P) {
		const board = _on_board(c, P)
		if (board) {
			const body = c.slab("body", 0.03, 0.02, 0.02, 0.0, 0.0, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "a dimmer", kind: "static" })
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, body, sx * 0.015, 0.0)
		} else {
			const base = _base(c, P, 0.07, 0.045)
			c.slab("body", 0.03, 0.016, 0.03, 0.0, BASE_H / 2 + 0.008, { material: c.mat({ base: "circuit plastic", overrides: {} }), look: "circuit plastic", words: "a dimmer" })
			_weld(c, base, 0.0, BASE_H / 2 + 0.008)
		}
		const top = P.max_ohms
		const r0 = pyRound(0.5 + top * P.knob, 5)
		const r1 = pyRound(0.5 + top * P.knob_to, 5)
		const fields = { r: r0 }
		if (P.turn_seconds > 0 && Math.abs(r1 - r0) > 1e-9) fields.turn = { r: r1, from: P.turn_at, to: pyRound(P.turn_at + P.turn_seconds, 5) }
		_part(c, "resistor", null, fields)
	}
	register(new ItemType("dimmer", "Dimmer", CAT, build_dimmer, {
		...common,
		props: [
			new Prop("max_ohms", "Most resistance", 50.0, 1.0, 10000.0, 1.0, "Ω", { slider_max: 500.0 }),
			new Prop("knob", "Knob at the start", 0.0, 0.0, 1.0, 0.01, "", "0: least resistance (brightest), 1: most"),
			new Prop("knob_to", "Knob turned to", 0.0, 0.0, 1.0, 0.01, "", "Where the knob is turned to"),
			new Prop("turn_at", "Turned from", 1.0, 0.0, 20.0, 0.1, "s"),
			new Prop("turn_seconds", "Turned over", 2.0, 0.0, 20.0, 0.1, "s", "0: not turned"),
			_mount_prop()
		],
		readouts: [new Readout("ohms", "Resistance now", { unit: "Ω", digits: 1 }), new Readout("current", "Current", { unit: "A", digits: 3 }), new Readout("voltage", "Voltage across it", { unit: "V", digits: 2 })],
		tags: ["rheostat", "potentiometer", "variable resistor", "knob", "dim", "brightness", "control", "slider", "circuit", "resistance"],
		description: "A variable resistor (rheostat) with a knob: turned up, more resistance and less current (a bulb dims); it can be turned during the run.",
		source: "A wire-wound rheostat, 0.5-50 Ω (provisional); Ohm's law.",
		anchor: "the middle of its base board", facts: "0-50 Ω knob"
	}))

	// --- tester
	function build_tester(c, P) {
		const gap = P.gap
		const board = _on_board(c, P)
		const cu = c.mat({ base: "copper", overrides: {} })
		const plate = 0.035
		let base
		if (board) base = c.slab("base", 2 * plate + gap + 0.01, BASE_H, 0.05, 0.0, 0.0, { material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood", words: "a tester's board", kind: "static" })
		else {
			const wood = c.mat({ base: "varnished hardwood", overrides: {} })
			base = c.slab("base", 2 * plate + gap + 0.01, BASE_H, 0.05, 0.0, 0.0, { material: wood, look: "wood", words: "a tester's board" })
		}
		const y = BASE_H / 2 + 0.0015
		const ids = []
		for (const [name, sx] of [["+", 1], ["-", -1]]) {
			const x = sx * (gap / 2 + plate / 2)
			const sid = c.slab(sx > 0 ? "probe_plus" : "probe_minus", plate, 0.003, 0.03, x, y, { material: cu, look: "copper", words: "a copper probe plate", kind: _kind(c, P) })
			_weld(c, base, x, y)
			_terminal(c, name, base, sx * (gap / 2 + plate - 0.004), y + 0.0015)
			ids.push(sid)
		}
		_part(c, "probe", null, { contacts: [ids[0], ids[1]], gap })
	}
	register(new ItemType("tester", "Conductor tester", CAT, build_tester, {
		...common,
		props: [new Prop("gap", "Gap between the probes", 0.015, 0.005, 0.06, 0.001, "m", "A test object laid across the gap touches both probes"), _mount_prop()],
		readouts: [new Readout("conducts", "Conducts", { unit: "", digits: 0 }), new Readout("current", "Current through the test object", { unit: "A", digits: 4 })],
		tags: ["conductor", "insulator", "continuity", "test", "probe", "metal", "material", "conductivity", "circuit tester", "clips"],
		description: "Two copper probe plates with a gap between them. Wire it in a loop with a battery and a bulb, and lay a test object across the gap: a metal one (a coin, a steel ball) closes the circuit and the bulb lights; plastic, wood, rubber or glass do not.",
		source: "The object closes the gap with R = ρ·L/A of its material (CRC resistivities: copper 1.7e-8, steel 1.4e-7, graphite 1e-5, glass 1e12, rubber 1e13, dry wood 1e14 Ω·m).",
		anchor: "the middle of its board", facts: "probes 1.5 cm apart"
	}))

	// --- meter
	function build_meter(c, P) {
		if (P.mode === "galvanometer") {
			// a centre-zero galvanometer: a wooden box with a big dial facing you, its two terminals on the front at the bottom
			const w = 0.11
			const h = 0.09
			const d = 0.05
			const body = c.slab("body", w, h, d, 0.0, 0.0, {
				material: c.mat({ base: "varnished hardwood", density: pyRound(0.35 / (w * h * d), 1), overrides: {} }), look: "wood", words: "a centre-zero galvanometer", kind: _kind(c, P)
			})
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, body, sx * 0.035, -h / 2 + 0.012)
			_part(c, "meter", null, { mode: "galvanometer", r: GALVO_OHM, fs: GALVO_FS })
			return
		}
		const body = c.slab("body", 0.075, 0.15, 0.035, 0.0, 0.0, {
			material: c.mat({ base: "circuit plastic", density: pyRound(0.3 / (0.075 * 0.15 * 0.035), 1), overrides: {} }), look: "circuit plastic", words: "a multimeter", kind: _kind(c, P), color: "#f2c230"
		})
		for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, body, sx * 0.022, -0.06)
		if (P.mode === "volts") _part(c, "meter", null, { mode: "volts", r: 1e7 })
		else _part(c, "meter", null, { mode: "amps", r: 0.1 })
	}
	register(new ItemType("meter", "Multimeter", CAT, build_meter, {
		...common,
		props: [
			new Prop("mode", "Measures", "volts", {
				kind: "choice", choices: ["volts", "amps", "galvanometer"],
				help: "volts: clip it across a part (it takes almost nothing); amps: put it in the loop, in series; galvanometer: a centre-zero needle meter for tiny currents (0.5 mA full scale either way), in series: it flicks when a magnet moves in a coil"
			}),
			_mount_prop()
		],
		readouts: [
			new Readout("reading", "Reading", { unit: "", digits: 3, help: "Volts across it, or amps through it" }), new Readout("current", "Current through it", { unit: "A", digits: 4 }),
			new Readout("needle", "Needle", { unit: "x full scale", digits: 2, help: "A galvanometer's needle: −1 full left, 0 the middle, +1 full right (it swings and settles; it stops at ±1.2)" })
		],
		tags: ["voltmeter", "ammeter", "multimeter", "measure", "volts", "amps", "current", "voltage", "reading", "instrument", "galvanometer"],
		description: "A digital multimeter standing up, its display facing you. As a voltmeter, clip its + and − across a part; as an ammeter, wire it into the loop. Its reading shows on its display. As a galvanometer it is a centre-zero needle meter for tiny currents (a coil and a magnet).",
		source: "A digital multimeter: 10 MΩ across its volts input; about 0.1 Ω on its amps range (typical). A school galvanometer: centre zero, about 0.5 mA full scale, about 50 Ω (provisional).",
		anchor: "its middle", facts: "volts · 10 MΩ input"
	}))

	// --- solar panel
	function build_solar(c, P) {
		const board = _on_board(c, P)
		const w = 0.09
		const d = 0.06
		const tilt = P.tilt
		const plastic = c.mat({ base: "circuit plastic", overrides: {} })
		// (in a scene with lamps, flashlights or the optics module's sun, its face takes the light the optics module traces)
		const lit = _lit_scene(c) ? { optics: { role: "panel", faces: [1], eff: [...PV_EFF], color: "#1d3b8f" } } : {}
		let panel
		if (board) {
			panel = c.slab("panel", w, 0.006, d, 0.0, 0.0, tilt, { material: plastic, look: "circuit plastic", words: "a solar panel", kind: "static", color: "#1d3b8f", ...lit })
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, panel, (sx * w) / 2, 0.0)
		} else {
			const base = _base(c, P, 0.1, 0.07)
			const hy = BASE_H / 2 + 0.03
			c.slab("post", 0.008, 0.03, 0.02, 0.0, BASE_H / 2 + 0.015, { material: plastic, look: "circuit plastic", words: "a solar panel's stand" })
			_weld(c, base, 0.0, BASE_H / 2 + 0.015)
			panel = c.slab("panel", w, 0.006, d, 0.0, hy, tilt, { material: plastic, look: "circuit plastic", words: "a solar panel", color: "#1d3b8f", ...lit })
			const s = c.sb.solids[c.sb.solids.length - 1]
			s.parent = base
			s.at = { x: 0.0, y: pyRound(hy, 5) }
			if (Math.abs(tilt) > 1e-12) s.angle = pyRound((tilt * Math.PI) / 180, 6)
			else delete s.angle
		}
		_part(c, "solar", null, {
			isc: 0.2, v_knee: 1.8, g_d: 0.9, rsh: 100.0, rs: 0.5,
			face: { solid: panel, at: { x: 0.0, y: 0.003 }, normal: { x: 0.0, y: 1.0 }, width: w },
			sun: { irradiance: P.sun, angle: pyRound((P.sun_angle * Math.PI) / 180, 6) }
		})
	}
	register(new ItemType("solar-panel", "Solar panel", CAT, build_solar, {
		...common,
		props: [
			new Prop("tilt", "Tilt", 0.0, -80.0, 80.0, 1.0, "°", "Its face's tilt: 0 faces straight up"),
			new Prop("sun", "Sunshine on it", 1000.0, 0.0, 1100.0, 10.0, "W/m²", "1000: full sun outdoors; 0: indoors, lit only by lamps and bulbs"),
			new Prop("sun_angle", "Sun's angle", 0.0, -80.0, 80.0, 1.0, "°", "From straight overhead; positive: the sun is to the right"),
			_mount_prop()
		],
		readouts: [new Readout("irradiance", "Light on it", { unit: "W/m²", digits: 0 }), new Readout("current", "Current", { unit: "A", digits: 3 }), new Readout("voltage", "Voltage", { unit: "V", digits: 2 }), new Readout("power", "Power", { unit: "W", digits: 3 })],
		tags: ["solar cell", "photovoltaic", "PV", "sunlight", "light to electricity", "renewable", "energy", "panel", "sun", "lamp"],
		description: "A mini solar panel (4 cells: about 2 V, 0.2 A in full sun). The light on its face makes the current: full sun, a lamp close by, or less when something shades it.",
		source: "A silicon cell's current is proportional to the light on it; about 0.45-0.5 V a cell at its knee; 15 % efficient (typical mini-panel data).",
		anchor: "the middle of its base board", facts: "2 V · 0.2 A in full sun"
	}))

	// --- hand generator
	function build_generator(c, P) {
		const board = _on_board(c, P)
		const plastic = c.mat({ base: "circuit plastic", overrides: {} })
		if (board) {
			const body = c.slab("body", 0.06, 0.05, 0.04, 0.0, 0.0, { material: plastic, look: "circuit plastic", words: "a hand generator", kind: "static", color: "#2a7bd0" })
			for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, body, sx * 0.03, -0.02)
		} else {
			const base = _base(c, P, 0.08, 0.05)
			c.slab("body", 0.06, 0.05, 0.04, 0.0, BASE_H / 2 + 0.025, { material: plastic, look: "circuit plastic", words: "a hand generator", color: "#2a7bd0" })
			_weld(c, base, 0.0, BASE_H / 2 + 0.025)
		}
		const to = P.stop_at
		_part(c, "generator", null, { k: pyRound(6 / (4 * Math.PI), 6), r: 6.0, speed: pyRound((P.rpm * 2 * Math.PI) / 60, 6), from: P.start_at, ...(to > 0 ? { to } : {}) })
	}
	register(new ItemType("hand-generator", "Hand generator", CAT, build_generator, {
		...common,
		props: [
			new Prop("rpm", "Cranking speed", 80.0, 0.0, 300.0, 5.0, "turns/min", "How fast the handle is turned (positive: counter-clockwise)"),
			new Prop("start_at", "Turned from", 0.5, 0.0, 20.0, 0.1, "s"),
			new Prop("stop_at", "Stopped at", 0.0, 0.0, 20.0, 0.1, "s", "0: kept turning"),
			_mount_prop()
		],
		readouts: [new Readout("rpm", "Cranking speed", { unit: "rpm", digits: 0 }), new Readout("voltage", "Voltage", { unit: "V", digits: 2 }), new Readout("current", "Current", { unit: "A", digits: 3 })],
		tags: ["dynamo", "crank", "generator", "hand crank", "motion to electricity", "energy", "magnet", "coil", "power", "turn"],
		description: "A hand-cranked generator: turning its handle makes a voltage (about 6 V at 2 turns a second) that drives current round a circuit; faster turning, more voltage.",
		source: "A generator's EMF is proportional to its speed (Faraday's law); a classroom hand generator gives about 6 V at 2 turns a second (provisional).",
		anchor: "the middle of its base board", facts: "4 V at 80 turns/min"
	}))

	// --- electromagnet: an iron nail wound with enamelled wire, its two leads wired into a circuit (a switch, a meter, more cells)
	function build_electromagnet(c, P) {
		const L = P.length
		const dia = P.diameter
		const n = Math.trunc(P.turns)
		const r = dia / 2
		const p = Math.min(0.004, L / 6)
		const vol_round = Math.PI * r * r * (L - p) + (Math.PI * r * r * p) / 3
		const vol_poly = (2 * r * (L - p) + r * p) * dia
		const steel = Object.prototype.hasOwnProperty.call(MATERIALS, "low-carbon steel") ? "low-carbon steel" : "steel"
		const mat = c.mat({ base: steel, overrides: {}, density: pyRound((7850.0 * vol_round) / vol_poly, 3) })
		const pts = [[-L / 2, -r], [L / 2 - p, -r], [L / 2, 0.0], [L / 2 - p, r], [-L / 2, r]]
		const held = c.kind === "static" ? { stand: "post" } : {}
		const sid = c.poly("core", pts, dia, 0.0, 0.0, -90.0, { material: mat, look: "steel", words: "an iron nail wound with copper wire", ...held })
		_terminal(c, "+", sid, -L / 2 + 0.004, r + 0.0005)
		_terminal(c, "-", sid, -L / 2 + 0.004, -r - 0.0005)
		_part(c, "coil", null, { r: pyRound(n * Math.PI * (dia + AWG24_D) * AWG24_OHM, 6), turns: n })
		if (_module_on("compass", "magnetism"))
			c.process("magnetism", "core", {
				role: "soft", solid: sid, x: 0.0, y: 0.0, w: pyRound(L, 6), h: pyRound(dia, 6), d: pyRound(dia, 6),
				volume: Number(F.py.fmtG(vol_round, 6)), ms: NAIL_MS, chi: NAIL_CHI,
				coil: { turns: n, length: pyRound(L - 0.01, 6), reading: { item: c.item.id, key: "current" } }
			})
	}
	register(new ItemType("electromagnet", "Electromagnet (wired)", CAT, build_electromagnet, {
		dynamic: false, ...common,
		props: [
			new Prop("turns", "Turns of wire", 50, 5, 500, 5, "", { kind: "int", help: "More turns, a stronger magnet for the same current (until the nail's iron is full)" }),
			new Prop("length", "Nail length", 0.051, 0.03, 0.15, 0.001, "m"), new Prop("diameter", "Nail diameter", 0.0029, 0.0015, 0.006, 0.0001, "m")
		],
		readouts: [
			new Readout("current", "Current through its coil", { unit: "A", digits: 3, help: "+ to − is positive: then its point is a north pole" }),
			new Readout("voltage", "Voltage across it", { unit: "V", digits: 3 }), new Readout("magnetized", "Magnetized", { unit: "%", digits: 1, help: "How strongly its nail is magnetized, % of the most iron takes" }),
			new Readout("pull_mN", "Magnetic pull", { unit: "mN", digits: 2 })
		],
		tags: ["electromagnet", "coil", "nail", "wire", "turns", "magnet", "current", "switch", "solenoid", "iron core", "circuit"],
		description: "An iron nail wound with turns of enamelled copper wire, held point down in a clamp, with two leads to wire into a circuit (a battery, a switch, an ammeter). " +
			"Current through its coil makes the nail a magnet that picks up paper clips: more current or more turns, stronger, until the iron is fully magnetized; " +
			"no current, it lets them go. Current in at + makes its point a north pole; swap the leads to swap the poles.",
		source: "24 AWG enamelled copper 84.2 mΩ/m (ASTM B258): 50 turns on a 2.9 mm nail are about 0.045 Ω, so on AA cells the current is several amps; the coil's field n·I in a low-carbon-steel core, magnetized up to 2.0 T (Chikazumi).",
		anchor: "the middle of the nail", facts: "50 turns · 0.045 Ω · iron core", edit: [{ kind: "rotate" }]
	}))

	// --- coil: turns of enamelled wire on a cardboard tube (no core): a magnet moved in or out of it makes a voltage (induction)
	function build_coil(c, P) {
		const n = Math.trunc(P.turns)
		const D = P.diameter
		const Lc = P.length
		const layer = ((n * AWG28_D * AWG28_D) / Lc) * 1.15
		const t = pyRound(COIL_TUBE + Math.max(0.0005, layer), 5)
		const rm = D / 2 + COIL_TUBE + layer / 2
		const off = pyRound(D / 2 + t / 2, 5)
		const cu = c.mat({ base: "copper", overrides: {} })
		const held = c.kind === "static" ? { stand: "post" } : {}
		const other = c.kind === "static" ? { stand: "none" } : {}
		const deep = pyRound(D + 2 * t, 5)
		let a
		let center
		let axis
		if (P.axis === "vertical") {
			a = c.slab("wall_plus", t, Lc, deep, off, 0.0, { material: cu, look: "copper", words: "a coil of copper wire", ...held })
			c.slab("wall_minus", t, Lc, deep, -off, 0.0, { material: cu, look: "copper", words: "a coil of copper wire", ...other })
			_weld(c, a, -off, 0.0, off, 0.0)
			_terminal(c, "+", a, t / 2, Lc / 2 - 0.004)
			_terminal(c, "-", c.sb.solids[c.sb.solids.length - 1].id, -t / 2, Lc / 2 - 0.004)
			center = { x: -off, y: 0.0 }
			axis = pyRound(Math.PI / 2, 6)
		} else {
			a = c.slab("wall_plus", Lc, t, deep, 0.0, off, { material: cu, look: "copper", words: "a coil of copper wire", ...held })
			c.slab("wall_minus", Lc, t, deep, 0.0, -off, { material: cu, look: "copper", words: "a coil of copper wire", ...other })
			_weld(c, a, 0.0, -off, 0.0, off)
			_terminal(c, "+", a, Lc / 2 - 0.004, t / 2)
			_terminal(c, "-", c.sb.solids[c.sb.solids.length - 1].id, Lc / 2 - 0.004, -t / 2)
			center = { x: 0.0, y: -off }
			axis = 0.0
		}
		_part(c, "coil", null, { r: pyRound(n * 2 * Math.PI * rm * AWG28_OHM, 6), turns: n, induce: { solid: a, at: center, axis, radius: pyRound(rm, 6), length: Lc } })
	}
	register(new ItemType("coil", "Coil of wire", CAT, build_coil, {
		dynamic: false, ...common,
		props: [
			new Prop("turns", "Turns of wire", 200, 10, 2000, 10, "", { kind: "int", help: "More turns, more voltage when a magnet moves through it (and more resistance)" }),
			new Prop("axis", "Its axis", "vertical", { kind: "choice", choices: ["vertical", "horizontal"], help: "vertical: drop a magnet through it from above; horizontal: push a magnet into it from the side" }),
			new Prop("diameter", "Inside diameter", 0.04, 0.015, 0.1, 0.001, "m", "The bore a magnet goes through"),
			new Prop("length", "Length", 0.06, 0.02, 0.2, 0.005, "m")
		],
		readouts: [
			new Readout("emf_mv", "Induced voltage", { unit: "mV", digits: 2, help: "What the magnet's moving field makes across its ends now (Faraday's law)" }),
			new Readout("current", "Current through it", { unit: "A", digits: 4, help: "+ to − is positive" }), new Readout("voltage", "Voltage at its ends", { unit: "V", digits: 3 }),
			new Readout("flux_uwb", "Magnetic flux through it", { unit: "µWb", digits: 2, help: "Through one turn, the coil's average" })
		],
		tags: ["coil", "solenoid", "induction", "electromagnetic induction", "faraday", "generator", "magnet through a coil", "turns", "galvanometer", "wire"],
		description: "A coil of enamelled copper wire on a cardboard tube (200 turns, 4 cm bore), held in a clamp, with two leads. Move a magnet in or out of it, or drop one " +
			"through it, and a voltage is induced while the magnet moves (none while it is still): a galvanometer wired to it flicks one way as the magnet goes in " +
			"and the other way as it comes out. Faster, a stronger magnet or more turns: more voltage.",
		source: "Faraday's law of induction: EMF = −N·dΦ/dt (the magnet's own field through each turn, worked out exactly from its poles). 28 AWG enamelled copper 212.9 mΩ/m (ASTM B258): 200 turns about 6 Ω.",
		anchor: "the middle of its bore", facts: "200 turns · 4 cm bore · 6 Ω", edit: [{ kind: "rotate" }]
	}))

	// --- straight wire: a bare copper wire stretched straight, for Oersted's experiment (a compass by a wire carrying current swings)
	function build_straight(c, P) {
		const L = P.length
		const held = c.kind === "static" ? { stand: "post" } : {}
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		let field
		if (P.runs === "over") {
			const z = P.in_front
			const a = c.slab("clamp_plus", 0.016, 0.016, 0.03, L / 2, 0.0, { material: wood, look: "wood", words: "an insulated clamp", ...held })
			c.slab("clamp_minus", 0.016, 0.016, 0.03, -L / 2, 0.0, { material: wood, look: "wood", words: "an insulated clamp", ...held })
			_weld(c, a, -L / 2, 0.0, L / 2, 0.0)
			_terminal(c, "+", a, 0.0, 0.008)
			_terminal(c, "-", c.sb.solids[c.sb.solids.length - 1].id, 0.0, 0.008)
			field = { solid: a, from: { x: 0.0, y: 0.0, z }, to: { x: pyRound(-L, 5), y: 0.0, z } }
		} else {
			const a = c.ball("wire", pyRound(AWG14_D / 2, 6), 0.0, 0.0, { material: c.mat({ base: "copper", overrides: {} }), look: "copper", words: "a straight copper wire", shape: "cylinder", length: L, depth3d: L, ...held })
			_terminal(c, "+", a, 0.0, 0.0)
			_terminal(c, "-", a, 0.0, 0.0)
			const st = _store(c.sb).terminals
			st[`${c.item.id}/+`].z = pyRound(L / 2, 5)
			st[`${c.item.id}/-`].z = pyRound(-L / 2, 5)
			field = { solid: a, from: { x: 0.0, y: 0.0, z: pyRound(L / 2, 5) }, to: { x: 0.0, y: 0.0, z: pyRound(-L / 2, 5) } }
		}
		_part(c, "conductor", null, { r: pyRound(AWG14_OHM * L, 6), field })
	}
	register(new ItemType("straight-wire", "Straight wire", CAT, build_straight, {
		dynamic: false, ...common,
		props: [
			new Prop("runs", "Runs", "over", { kind: "choice", choices: ["over", "through"], help: "over: left to right, just in front of what is behind it (a compass behind it is like one under a wire); through: straight through the picture, front to back" }),
			new Prop("length", "Length", 0.3, 0.1, 1.0, 0.01, "m"),
			new Prop("in_front", "In front of the picture", 0.012, 0.004, 0.06, 0.001, "m", "over: how far in front of the needle it runs (nearer, a stronger field there)")
		],
		readouts: [new Readout("current", "Current", { unit: "A", digits: 3, help: "+ to − is positive" }), new Readout("field_ut", "Its field 1 cm away", { unit: "µT", digits: 1, help: "μ0·I/(2π·1 cm); Earth's is about 20 µT" })],
		tags: ["oersted", "straight wire", "current-carrying wire", "magnetic field of a wire", "compass", "electromagnetism", "right-hand rule", "conductor", "copper", "field"],
		description: "A bare copper wire stretched straight between two insulated clamps, with a terminal at each end. Current through it makes a magnetic field round it " +
			"(Oersted): a compass needle behind it swings across the wire when the current flows, the other way when the current is reversed, back when it stops. " +
			"Its field 1 cm away is 20 µT per amp (Earth's is about 20 µT), so it takes amps: a battery straight across it (briefly) or through a few ohms.",
		source: "A long straight wire's field B = μ0·I/(2π·r) (Biot-Savart, here for its true length): 2 A gives 40 µT at 1 cm. 14 AWG bare copper 8.28 mΩ/m (ASTM B258).",
		anchor: "the middle of the wire", facts: "30 cm · 14 AWG copper · 20 µT/A at 1 cm"
	}))

	// --- circuit board
	function build_board(c, P) {
		_store(c.sb).boards.push({ item: c.item.id, x: pyRound(c.item.x ?? 0.0, 5), y: pyRound(c.item.y ?? 0.0, 5), width: P.width, height: P.height })
	}
	register(new ItemType("circuit-board", "Circuit board", CAT, build_board, {
		dynamic: false, ...common,
		props: [new Prop("width", "Width", 0.6, 0.2, 2.0, 0.01, "m"), new Prop("height", "Height", 0.4, 0.15, 1.5, 0.01, "m")],
		tags: ["pegboard", "breadboard", "board", "display", "panel", "mount", "circuit board", "lesson", "backdrop", "upright"],
		description: "An upright pegboard behind the circuit, facing you, so a circuit reads at a glance: put parts on it with Stands on: board (they stay where they are put) and wire them in a loop.",
		source: "Lesson art: drawn behind the parts; nothing touches it.",
		anchor: "its middle", facts: "60 x 40 cm"
	}))
}

// ---------------------------------------------------------------- gathering the circuit (a build hook)
// ---------------------------------------------------------------- a battery car's motor on its car (a build hook, before _gather; the Python file's _mount_on_cars)
function _mount_on_cars(sb, scene) {
	const st = sb.circuit
	if (!st || !st.cars || !st.cars.length) return
	const by = new Map(sb.solids.map((s) => [s.id, s]))
	const joints = new Map(sb.joints.map((j) => [j.id, j]))
	for (const rec of st.cars) {
		const mid = rec.motor
		const car = rec.car
		const chassis = by.get(`${car}/chassis`)
		const wheel = by.get(`${car}/rear`)
		const axle = joints.get(`${car}/axle-rear`)
		const part = st.parts.find((p) => p.id === `${mid}/motor`)
		if (chassis === undefined || wheel === undefined || axle === undefined || axle.kind !== "wheel" || part === undefined) continue
		const item = sb.scene_items.get(mid)
		const c = new Ctx(sb, item, props_of(item))
		const [L, D] = MOTORS[rec.kind].can
		const depth = 0.027
		const ax = axle.anchor.x
		const ay = axle.anchor.y
		const mass = MOTOR_MASS[rec.kind]
		const plastic = c.mat({ base: "circuit plastic", density: pyRound(mass / (L * D * depth), 3), overrides: {} })
		const gid = c.slab("gearbox", L, D, depth, 0.0, 0.0, { material: plastic, kind: chassis.kind, look: "circuit plastic", words: "a battery car's motor and gearbox", ghost: true, color: rec.kind === "geared" ? "#f2c230" : "#9aa3ab" })
		const s = sb.solids[sb.solids.length - 1]
		s.parent = chassis.id
		s.at = { x: pyRound(ax + L / 2 - 0.012, 5), y: pyRound(ay, 5) }
		delete s.angle
		for (const [name, sx] of [["+", 1], ["-", -1]]) _terminal(c, name, gid, sx * (L / 2 - 0.006), D / 2)
		Object.assign(part, { rotor: wheel.id, stator: chassis.id, wheel: axle.id })
	}
}

function _terminal_world(sb, name, terminals) {
	const t = Object.prototype.hasOwnProperty.call(terminals, name) ? terminals[name] : null
	if (t === null) return null
	const s = sb.solids.find((x) => x.id === t.solid)
	if (s === undefined) return null
	let x = s.at.x
	let y = s.at.y
	let a = s.angle ?? 0.0
	if ("parent" in s) {
		const q = sb.solids.find((x2) => x2.id === s.parent)
		if (q !== undefined) {
			const qa = q.angle ?? 0.0
			;[x, y] = [q.at.x + x * cos(qa) - y * sin(qa), q.at.y + x * sin(qa) + y * cos(qa)]
			a += qa
		}
	}
	return [x + t.at.x * cos(a) - t.at.y * sin(a), y + t.at.x * sin(a) + t.at.y * cos(a)]
}

/** Which way current goes at a terminal round a loop: "out" of a source's + and a part's −, "in" at a part's + and a source's −. */
function _flow(sb, iid, end) {
	const it = sb.scene_items.has(iid) ? sb.scene_items.get(iid) : null
	return (end === "+") === SOURCES.includes(it?.type) ? "out" : "in"
}

function _volts_meter(sb, iid) {
	const it = sb.scene_items.has(iid) ? sb.scene_items.get(iid) : null
	return it !== null && it.type === "meter" && props_of(it).mode === "volts"
}

/** Each wire's two ends' terminals ("+", "-" or null), the unset ones joined as current flows round a loop (the Python file's _ends). */
function _ends(sb, st) {
	const terminals = st.terminals
	const has = (iid, e) => iid !== null && Object.prototype.hasOwnProperty.call(terminals, `${iid}/${e}`)
	const uses = new Map()
	const bump = (k) => uses.set(k, (uses.get(k) ?? 0) + 1)
	const rows = []
	for (const w of st.wires) {
		const row = []
		for (const side of ["a", "b"]) {
			const iid = w[side]
			if (!(has(iid, "+") || has(iid, "-"))) row.push(null)
			else if (w[`${side}_auto`]) row.push("?")
			else {
				const e = w[`${side}_end`]
				row.push(has(iid, e) ? e : null)
				if (has(iid, e)) bump(`${iid}/${e}`)
			}
		}
		rows.push(row)
	}
	st.wires.forEach((w, n) => {
		const row = rows[n]
		;["a", "b"].forEach((side, k) => {
			if (row[k] !== "?") return
			const iid = w[side]
			const other = row[1 - k]
			const oid = w[side === "a" ? "b" : "a"]
			let e
			if (other === "+" || other === "-") {
				const same = _volts_meter(sb, iid) || _volts_meter(sb, oid)
				const want = same ? _flow(sb, oid, other) : _flow(sb, oid, other) === "out" ? "in" : "out"
				e = _flow(sb, iid, "+") === want ? "+" : "-"
			} else {
				const np = uses.get(`${iid}/+`) ?? 0
				const nm = uses.get(`${iid}/-`) ?? 0
				e = np === nm ? w[`${side}_end`] : np < nm ? "+" : "-"
			}
			if (!has(iid, e)) e = e === "+" ? "-" : "+"
			row[k] = e
			bump(`${iid}/${e}`)
			w.P[`${side}_end`] = e
		})
	})
	return rows
}

function _gather(sb, scene) {
	const st = sb.circuit
	if (!st || (!st.parts.length && !st.boards.length)) return
	const parts = st.parts.map((p) => ({ ...p }))
	const terminals = st.terminals
	const rows = _ends(sb, st)
	st.wires.forEach((w, n) => {
		const ends = rows[n].map((e, k) => (e !== null ? `${w[k === 0 ? "a" : "b"]}/${e}` : null))
		let length = w.length
		if (length === null) {
			const pa = ends[0] ? _terminal_world(sb, ends[0], terminals) : null
			const pb = ends[1] ? _terminal_world(sb, ends[1], terminals) : null
			const gap = pa && pb ? Math.sqrt((pb[0] - pa[0]) * (pb[0] - pa[0]) + (pb[1] - pa[1]) * (pb[1] - pa[1])) : 0.25
			length = Math.max(0.1, Math.ceil(pyRound((gap * 1.3 + 0.05) * 100, 6)) / 100)
		}
		length = pyRound(length, 5)
		w.P.length = length
		const a = ends[0] ?? `${w.item}/loose-a`
		const b = ends[1] ?? `${w.item}/loose-b`
		parts.push({ kind: "wire", id: `${w.item}/wire`, item: w.item, name: w.name, a, b, r: pyRound(WIRE_OHM_M * length, 6), length, color: w.color })
	})
	const rho = {}
	for (const inst of sb.instances.values()) {
		if (Object.prototype.hasOwnProperty.call(RESISTIVITY, inst.base)) rho[inst.name] = RESISTIVITY[inst.base]
	}
	const names = []
	for (const it of scene.items ?? []) {
		if (it !== null && typeof it === "object" && typeof it.id === "string" && typeof it.type === "string" && it.type in TYPES) names.push([it.id, truthy(it.name) ? it.name : TYPES[it.type].name])
	}
	const sorted = {}
	for (const k of F.py.pySorted(Object.keys(rho))) sorted[k] = rho[k]
	const rec = { kind: "circuit", id: "circuit", parts, terminals, resistivity: sorted, names }
	if (st.boards.length) rec.boards = st.boards
	sb.processes.push(rec)
}

// ---------------------------------------------------------------- goal kinds (the same as machines/mod_circuits.py, number for number)
const LIT = 0.1
const END_S = 0.5
const HOLD_S = 0.03

function _end_values(ctx, iid, key) {
	const v = ctx.state(iid, key)
	if (v === null || !ctx.times.length) return null
	const t_end = ctx.times[ctx.times.length - 1]
	const out = []
	for (let k = 0; k < Math.min(v.length, ctx.times.length); k++) if (ctx.times[k] >= t_end - END_S && v[k] !== null && v[k] !== undefined) out.push(v[k])
	return out.length ? out : null
}

function _first_lasting(ctx, iid, key, test) {
	const v = ctx.state(iid, key)
	if (v === null) return null
	const n = Math.min(v.length, ctx.times.length)
	for (let k = 0; k < n; k++) {
		const t0 = ctx.times[k]
		let ok = true
		let j = k
		while (j < n && ctx.times[j] - t0 < HOLD_S) {
			if (v[j] === null || v[j] === undefined || !test(v[j])) {
				ok = false
				break
			}
			j++
		}
		if (ok) return t0
	}
	return null
}

const _trim = (v) => {
	const t = fmtF(v, 2)
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t
}
const _label = (g, made) => (truthy(g.label) ? g.label : made)

function goal_lights(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.at_least)
	least = least === null ? LIT : least
	const by = ctx.num(g.before_s)
	const end = _end_values(ctx, g.item, "light")
	const t = ctx.first_time(g.item, "light", (x) => x >= least)
	const ok = by !== null ? t !== null && t <= by : end !== null && minOf(end) >= least
	const when = by === null ? "" : ` by ${_trim(by)} s`
	return { label: _label(g, `${ctx.name(g.item)} lights${when}`), ok, kind: "lights", item: g.item, t: t === null ? null : pyRound(t, 3), light: end === null ? null : pyRound(end[end.length - 1], 4) }
}

function goal_dark(ctx, g) {
	if (!ctx.known(g.item)) return null
	const v = ctx.state(g.item, "light")
	const vals = v === null ? [] : v.filter((x) => x !== null && x !== undefined)
	const top = v === null ? null : vals.length ? maxOf(vals) : 0.0
	return { label: _label(g, `${ctx.name(g.item)} stays dark`), ok: top !== null && top < LIT, kind: "stays_dark", item: g.item, light: top === null ? null : pyRound(top, 4) }
}

function goal_brighter(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const ea = _end_values(ctx, g.a, "light")
	const eb = _end_values(ctx, g.b, "light")
	const ma = ea ? pySum(ea) / ea.length : null
	const mb = eb ? pySum(eb) / eb.length : null
	const ok = ma !== null && mb !== null && ma > mb * 1.05 && ma >= LIT
	return {
		label: _label(g, `${ctx.name(g.a)} is brighter than ${ctx.name(g.b)}`), ok, kind: "glows_brighter", a: g.a, b: g.b,
		light_a: ma === null ? null : pyRound(ma, 4), light_b: mb === null ? null : pyRound(mb, 4)
	}
}

function goal_buzzes(ctx, g) {
	if (!ctx.known(g.item)) return null
	const by = ctx.num(g.before_s)
	const t = _first_lasting(ctx, g.item, "sound", (x) => x > 0)
	const when = by === null ? "" : ` by ${_trim(by)} s`
	return { label: _label(g, `${ctx.name(g.item)} sounds${when}`), ok: t !== null && (by === null || t <= by), kind: "buzzes", item: g.item, t: t === null ? null : pyRound(t, 3) }
}

function goal_spins(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.at_least_rpm)
	least = least === null ? 30.0 : least
	const end = _end_values(ctx, g.item, "rpm")
	const ok = end !== null && minOf(end.map((x) => Math.abs(x))) >= least
	return { label: _label(g, `${ctx.name(g.item)} turns`), ok, kind: "spins", item: g.item, rpm: end === null ? null : pyRound(end[end.length - 1], 1) }
}

function goal_current(ctx, g) {
	if (!ctx.known(g.item)) return null
	const lo = ctx.num(g.at_least_a)
	const hi = ctx.num(g.at_most_a)
	const end = _end_values(ctx, g.item, "current")
	let ok = end !== null && end.every((x) => (lo === null || Math.abs(x) >= lo) && (hi === null || Math.abs(x) <= hi))
	let what
	if (lo !== null && hi !== null) what = ` between ${_trim(lo)} and ${_trim(hi)} A`
	else if (lo !== null) what = ` at least ${_trim(lo)} A`
	else if (hi !== null) what = ` at most ${_trim(hi)} A`
	else what = ""
	if (ok && lo === null && hi === null) ok = maxOf(end.map((x) => Math.abs(x))) > 1e-4
	return { label: _label(g, `${ctx.name(g.item)} carries a current${what}`), ok, kind: "current", item: g.item, current: end === null ? null : pyRound(end[end.length - 1], 5) }
}

function goal_conducts(ctx, g) {
	if (!ctx.known(g.item)) return null
	const end = _end_values(ctx, g.item, "conducts")
	const ok = end !== null && end[end.length - 1] >= 1
	return { label: _label(g, `${ctx.name(g.item)} conducts`), ok, kind: "conducts", item: g.item }
}

/** An angle in degrees wrapped to (−180, 180] (as Python's % then a turn back). */
function _wrap180(d) {
	let x = d % 360.0
	if (x < 0) x += 360.0
	return x > 180.0 ? x - 360.0 : x
}

/** Which way the Earth's field points in the picture (degrees from +x), from the magnetism module's first Earth record, or null (the Python
 *  file's _north_deg). */
function _north_deg(doc) {
	for (const r of doc?.processes ?? []) {
		if (r?.kind === "magnetism" && r.role === "earth") {
			const x = Number(r.x ?? 0.0)
			const y = Number(r.y ?? 0.0)
			if (x === 0.0 && y === 0.0) return null
			if (y === 0.0) return x > 0 ? 0.0 : 180.0
			if (x === 0.0) return y > 0 ? 90.0 : 270.0
			let d = ((Math.atan2(y, x) * 180) / Math.PI) % 360.0
			if (d < 0) d += 360.0
			return pyRound(d, 6)
		}
	}
	return null
}

function goal_deflects(ctx, g) {
	const cid = g.compass
	if (!ctx.known(cid)) return null
	let least = ctx.num(g.at_least_deg)
	least = least === null ? 15.0 : least
	const at = ctx.num(g.at_s)
	const v = ctx.state(cid, "heading_deg") ?? []
	const seq = []
	for (let k = 0; k < Math.min(v.length, ctx.times.length); k++) if (v[k] !== null && v[k] !== undefined) seq.push([ctx.times[k], v[k]])
	let swing = null
	let most = null
	if (seq.length) {
		const north = _north_deg(ctx.doc)
		const h0 = north === null ? seq[0][1] : north
		most = maxOf(seq.map(([, x]) => Math.abs(_wrap180(x - h0))))
		if (at !== null) {
			const later = seq.filter(([t]) => t >= at - 1e-9).map(([, x]) => x)
			swing = later.length ? Math.abs(_wrap180(later[0] - h0)) : null
		} else {
			const t_end = seq[seq.length - 1][0]
			swing = minOf(seq.filter(([t]) => t >= t_end - END_S).map(([, x]) => Math.abs(_wrap180(x - h0))))
		}
	}
	const ok = swing !== null && swing >= least
	const when = at === null ? "" : ` at ${_trim(at)} s`
	return {
		label: _label(g, `${ctx.name(cid)}'s needle swings at least ${_trim(least)}°${when}`), ok, kind: "deflects", compass: cid,
		deg: swing === null ? null : pyRound(swing, 2), most_deg: most === null ? null : pyRound(most, 2)
	}
}

function goal_induces(ctx, g) {
	const cid = g.coil
	if (!ctx.known(cid)) return null
	let least = ctx.num(g.at_least_mv)
	least = least === null ? 1.0 : least
	const by = ctx.num(g.before_s)
	const v = ctx.state(cid, "emf_mv") ?? []
	let peak = null
	let t_first = null
	for (let k = 0; k < Math.min(v.length, ctx.times.length); k++) {
		const x = v[k]
		if (x === null || x === undefined) continue
		if (peak === null || Math.abs(x) > peak) peak = Math.abs(x)
		if (t_first === null && Math.abs(x) >= least) t_first = ctx.times[k]
	}
	const ok = t_first !== null && (by === null || t_first <= by)
	const when = by === null ? "" : ` by ${_trim(by)} s`
	return {
		label: _label(g, `${ctx.name(cid)} makes at least ${_trim(least)} mV${when}`), ok, kind: "induces", coil: cid,
		t: t_first === null ? null : pyRound(t_first, 3), peak_mv: peak === null ? null : pyRound(peak, 3)
	}
}

// ================================================================ the AI's plug-ins (web/sim/plugins.js registerModule)
// The circuit as the edit step's digest tells it: each terminal's wires, open ends, the loop through each battery (or why there is none), shorts.
const PART_TYPES = new Set(TYPES_OF)
const TERM_WORDS = {
	battery: ["+", "−"], led: ["+ (anode, long leg)", "− (cathode)"], buzzer: ["+", "−"], motor: ["+", "−"], meter: ["+ (V/A)", "− (COM)"], "solar-panel": ["+", "−"], "hand-generator": ["+", "−"],
	electromagnet: ["+ (its right lead: current in here makes its point a north pole)", "− (its left lead)"], coil: ["+ (its right lead)", "− (its left lead)"],
	"straight-wire": ["+ (its right end, or its front end when it runs through)", "− (its left end, or its back end)"]
}
const termWord = (type, end) => {
	const w = TERM_WORDS[type]
	if (w) return end === "+" ? w[0] : w[1]
	return end === "+" ? "+ (its right terminal)" : "− (its left terminal)"
}

/** The scene's circuit as a graph: {nodes: Map(node -> [{part, other}]), wires: [...], record}. From the run's document when there is one. */
function circuitOf(run) {
	const rec = (run?.doc?.processes ?? []).find((p) => p?.kind === "circuit")
	if (!rec) return null
	const adj = new Map()
	const add = (n, e) => (adj.get(n) ?? adj.set(n, []).get(n)).push(e)
	for (const p of rec.parts) {
		add(p.a, { part: p, other: p.b })
		add(p.b, { part: p, other: p.a })
	}
	return { rec, adj }
}

/** A path from node `from` to node `to` that does not use part `skip` (breadth first), as the parts it goes through, or null. */
function pathBetween(cg, from, to, skip) {
	const prev = new Map([[from, null]])
	const queue = [from]
	while (queue.length) {
		const n = queue.shift()
		if (n === to) break
		for (const e of cg.adj.get(n) ?? []) {
			if (e.part === skip || prev.has(e.other)) continue
			prev.set(e.other, { n, part: e.part })
			queue.push(e.other)
		}
	}
	if (!prev.has(to)) return null
	const parts = []
	for (let n = to; prev.get(n); n = prev.get(n).n) parts.unshift(prev.get(n).part)
	return parts
}

const OPENS = (p, run) => {
	// a part that stops current now: an open switch, a burnt-out bulb or LED, a wire pulled off, a tester with nothing across it
	const st = run?.track?.state?.[p.item]
	const last = (k) => (Array.isArray(st?.[k]) && st[k].length ? st[k][st[k].length - 1] : null)
	if (p.kind === "switch") return last("closed") === 0
	if (p.kind === "bulb" || p.kind === "led") return last("broken") === 1
	if (p.kind === "wire") return last("off") === 1 || /\/loose-[ab]$/.test(p.a) || /\/loose-[ab]$/.test(p.b)
	if (p.kind === "probe") return last("conducts") === 0
	return false
}

function circuitDigest(item, run) {
	const type = item?.type
	if (!type || (!PART_TYPES.has(type) && type !== "wire")) return null
	const out = []
	const nameOf = (id) => {
		const it = (run?.scene?.items ?? []).find((i) => i.id === id)
		return it?.name ? `${id} (“${it.name}”)` : id
	}
	if (type === "wire") {
		const p = item.props ?? {}
		// (the terminal each end is on as built: an end the plan left unset is joined as current flows)
		const built = (run?.doc?.processes ?? []).find((q) => q?.kind === "circuit")?.parts?.find((q) => q.kind === "wire" && q.item === item.id)
		const endOf = (side) => {
			const node = built?.[side]
			if (typeof node === "string" && !/\/loose-[ab]$/.test(node)) return node.slice(node.lastIndexOf("/") + 1)
			return p[`${side}_end`] ?? (side === "a" ? "+" : "-")
		}
		const end = (side) => (typeof p[side] === "string" && p[side] ? `${nameOf(p[side])} ${endOf(side) === "-" ? "−" : "+"}${p[`${side}_end`] === undefined ? " (as current flows: not set)" : ""}` : "nothing (a free end: the loop is open here)")
		out.push(`wire: end a on ${end("a")}; end b on ${end("b")}`)
		return out
	}
	const cg = circuitOf(run)
	if (!cg) {
		out.push("circuit: no wires join it yet (a part needs a closed loop of wires through a battery, a solar panel or a generator)")
		return out
	}
	// which wires each terminal has
	for (const end of ["+", "-"]) {
		const node = `${item.id}/${end}`
		const wires = (cg.adj.get(node) ?? []).filter((e) => e.part.kind === "wire")
		const there = wires.map((e) => {
			const far = e.other
			const [oid, oend] = far.includes("/loose-") ? [null, null] : far.split("/")
			return oid ? `${e.part.item} to ${nameOf(oid)} ${oend === "-" ? "−" : oend}` : `${e.part.item} (its other end is free)`
		})
		out.push(`terminal ${termWord(type, end)}: ${there.length ? there.join(", ") : "no wire"}`)
	}
	// what the new parts tell of their electromagnetism
	const st = run?.track?.state?.[item.id]
	const lastOf = (k) => (Array.isArray(st?.[k]) && st[k].length ? st[k][st[k].length - 1] : null)
	const peakOf = (k) => (Array.isArray(st?.[k]) && st[k].length ? st[k].reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0) : null)
	if (type === "coil" && st) out.push(`induction: peak ${nfmt(peakOf("emf_mv"), 2)} mV induced (now ${nfmt(lastOf("emf_mv"), 2)} mV); flux through it now ${nfmt(lastOf("flux_uwb"), 2)} µWb a turn (a voltage only while that flux changes: a magnet moving in or out of its bore)`)
	if (type === "straight-wire" && st) out.push(`field: ${nfmt(lastOf("current"), 3)} A through it now, ${nfmt(lastOf("field_ut"), 1)} µT 1 cm from it (Earth's is about 20 µT: a compass behind it swings when the wire's field is comparable)`)
	if (type === "electromagnet" && st) out.push(`electromagnet: ${nfmt(lastOf("current"), 3)} A through its coil now${lastOf("magnetized") !== null ? `, its nail ${nfmt(lastOf("magnetized"), 1)} % magnetized` : ""}${lastOf("pull_mN") !== null ? `, pull ${nfmt(lastOf("pull_mN"), 2)} mN` : ""}`)
	if (type === "meter" && (item.props?.mode ?? "volts") === "galvanometer" && st) out.push(`galvanometer: needle at ${nfmt(lastOf("needle"), 2)} of full scale now, its biggest swing ${nfmt(peakOf("needle"), 2)} (full scale 0.5 mA either way)`)
	if (type === "solar-panel" && st) out.push(`light: ${nfmt(lastOf("irradiance"), 0)} W/m² on its face now, as sunlight (its own sun ${item.props?.sun ?? 1000} W/m² plus the lamps' and flashlights' light the optics traces onto it)`)
	// a source: is there a loop from its + back to its −, and what is in it
	if (type === "battery" || type === "solar-panel" || type === "hand-generator" || type === "coil") {
		const self = cg.rec.parts.find((p) => p.item === item.id)
		const path = pathBetween(cg, `${item.id}/+`, `${item.id}/-`, self)
		if (!path) out.push(`loop: OPEN — nothing joins its + back to its −, so no current flows${type === "coil" ? " (a coil's induced voltage drives current only round a closed loop: a galvanometer across its two leads)" : ""}`)
		else {
			const blocked = path.filter((p) => OPENS(p, run))
			const loads = path.filter((p) => p.kind !== "wire" && p.kind !== "switch" && p.kind !== "conductor" && !(p.kind === "meter" && p.mode === "amps"))
			const words = path.map((p) => (p.kind === "wire" ? p.item : `${nameOf(p.item)}`)).join(" → ")
			if (blocked.length) out.push(`loop: + → ${words} → −, but OPEN at ${blocked.map((p) => nameOf(p.item)).join(", ")} (no current)`)
			else if (!loads.length) out.push(`loop: + → ${words} → −: a SHORT CIRCUIT (only wires and switches${path.some((p) => p.kind === "conductor") ? " and a straight wire: amps flow, which is what a straight wire's field needs, but a resistor of a few ohms keeps the battery from running down" : ": a huge current, nothing lights"})`)
			else out.push(`loop: + → ${words} → −: closed`)
		}
	}
	return out
}

const nfmt = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v)
const CHOICE_WORDS = {
	kind: { AA: "AA cells (1.58 V each)", D: "D cells (1.58 V each)", "9V": "a 9 V battery (9.5 V fresh)", "lantern 6V": "a 6 V lantern battery (6.3 V fresh)", hobby: "a fast hobby motor", solar: "a solar motor", geared: "a slow gear motor" }
}

function changeWords(type, key, a, b, nameOf) {
	if (!PART_TYPES.has(type) && type !== "wire") return null
	// (a cell count means something only for AA or D cells in a holder: a 9 V or lantern battery has its own; so no volts claimed here)
	if (type === "battery" && key === "cells") return `AA/D cells in the holder ${a} → ${b} (1.58 V each, fresh)`
	if (type === "battery" && key === "charge_pct") return `charge ${a} → ${b} %`
	if (type === "battery" && key === "kind") return `${CHOICE_WORDS.kind[a] ?? a} → ${CHOICE_WORDS.kind[b] ?? b}`
	if (type === "wire" && (key === "a" || key === "b")) return `wire end ${key} moved from ${a ? nameOf(a) : "nothing"} to ${b ? nameOf(b) : "nothing"}`
	if (type === "wire" && (key === "a_end" || key === "b_end")) return `wire end ${key[0]} moved to the ${b === "+" ? "+ (first)" : "− (second)"} terminal`
	if (type === "wire" && key === "length") return `wire length ${nfmt(a * 100, 0)} → ${nfmt(b * 100, 0)} cm`
	if (type === "switch" && key === "closed") return b ? "the switch starts closed" : "the switch starts open"
	if (type === "switch" && (key === "flip_at" || key === "flip_back_at")) return `switched ${key === "flip_back_at" ? "back " : ""}at ${a ? `${a} s` : "never"} → ${b ? `${b} s` : "never"}`
	if (type === "resistor" && key === "ohms") return `resistance ${a} → ${b} Ω`
	if (type === "dimmer" && (key === "knob" || key === "knob_to")) return `dimmer knob ${key === "knob" ? "at the start" : "turned to"} ${a} → ${b} (0 brightest, 1 dimmest)`
	if (type === "bulb" && key === "rating") return `bulb ${a} → ${b}`
	if (type === "led" && key === "color") return `LED ${a} → ${b}`
	if (type === "motor" && key === "kind") return `${CHOICE_WORDS.kind[a] ?? a} → ${CHOICE_WORDS.kind[b] ?? b}`
	if (type === "motor" && key === "size") return `attachment ${nfmt(a * 100, 0)} → ${nfmt(b * 100, 0)} cm`
	if (type === "tester" && key === "gap") return `probes ${nfmt(a * 1000, 0)} → ${nfmt(b * 1000, 0)} mm apart`
	if (type === "solar-panel" && key === "sun") return `sunshine on the panel ${a} → ${b} W/m²`
	if (type === "solar-panel" && key === "tilt") return `panel tilt ${a}° → ${b}°`
	if (type === "hand-generator" && key === "rpm") return `cranked at ${a} → ${b} turns a minute`
	if (type === "buzzer" && key === "volts") return `a ${a} V → ${b} V buzzer`
	if (type === "meter" && key === "mode") return b === "amps" ? "the meter now measures amps (in series)" : "the meter now measures volts (across a part)"
	if (type === "meter" && key === "mode" && b === "galvanometer") return "the meter is now a centre-zero galvanometer (0.5 mA full scale either way, in series)"
	if ((type === "coil" || type === "electromagnet") && key === "turns") return `${a} → ${b} turns of wire`
	if (type === "coil" && key === "axis") return `the coil's axis ${a} → ${b}`
	if (type === "coil" && key === "diameter") return `the coil's bore ${nfmt(a * 100, 1)} → ${nfmt(b * 100, 1)} cm across`
	if (type === "coil" && key === "length") return `the coil ${nfmt(a * 100, 1)} → ${nfmt(b * 100, 1)} cm long`
	if (type === "electromagnet" && key === "length") return `a ${nfmt(a * 100, 1)} → ${nfmt(b * 100, 1)} cm nail`
	if (type === "straight-wire" && key === "in_front") return `the wire ${nfmt(a * 1000, 0)} → ${nfmt(b * 1000, 0)} mm in front of the needle (its field there ∝ 1/distance)`
	if (type === "straight-wire" && key === "runs") return b === "through" ? "the wire now runs straight through the picture (front to back)" : "the wire now runs left to right, just in front"
	if (type === "straight-wire" && key === "length") return `the straight wire ${nfmt(a * 100, 0)} → ${nfmt(b * 100, 0)} cm long`
	if (key === "mount") return b === "board" ? "clipped to the circuit board" : "stood on the table"
	return null
}

/**
 * The make-it-work search's targeted tries for a needle that swings too little by a straight wire (the deflects goal's aim): the wire nearer the
 * needle (its field there ∝ 1/distance), and more current through it, the swing's tangent being about ∝ the wire's field over the Earth's: the
 * resistors in series with it (the parts carrying its current) turned down, or more cells in its battery. Each is checked by a run.
 */
function aimDeflects(g, entry, scene, run) {
	const deg = Number(entry?.deg)
	const least = Number.isFinite(g.at_least_deg) ? g.at_least_deg : 15
	if (!Number.isFinite(deg) || deg >= least) return []
	const items = scene?.items ?? []
	const want = Math.tan((Math.min(80, least * 1.3) * Math.PI) / 180)
	const have = Math.tan((Math.max(1, deg) * Math.PI) / 180)
	const k = Math.min(20, want / have)
	const out = []
	const wires = items.filter((i) => i.type === "straight-wire")
	for (const wire of wires) {
		if ((wire.props?.runs ?? "over") === "over") {
			const z0 = Number(wire.props?.in_front ?? 0.012)
			const z1 = Math.max(0.004, Math.round((z0 / k) * 1000) / 1000)
			if (z1 < z0) out.push({ changes: [{ kind: "prop", id: wire.id, key: "in_front", from: z0, to: z1 }], cost: 1 })
		}
		const st = run?.track?.state ?? {}
		const lastOf = (id, key) => {
			const v = st[id]?.[key]
			return Array.isArray(v) && v.length ? Number(v[v.length - 1]) : null
		}
		const I = Math.abs(lastOf(wire.id, "current") ?? 0)
		if (!(I > 1e-6)) continue
		const series = (id) => Math.abs(Math.abs(lastOf(id, "current") ?? 0) - I) <= 0.01 * I
		// (the loop's own resistance from its battery's voltage and the current: what must come out of it for k times the current)
		for (const bat of items.filter((i) => i.type === "battery" && series(i.id))) {
			const V = Number(lastOf(bat.id, "voltage") ?? 0)
			const kind = bat.props?.kind ?? "AA"
			const cells = Number(bat.props?.cells ?? 2)
			if ((kind === "AA" || kind === "D") && cells < 6) {
				const c1 = Math.min(6, Math.max(cells + 1, Math.ceil(cells * k)))
				out.push({ changes: [{ kind: "prop", id: bat.id, key: "cells", from: cells, to: c1 }], cost: 1.2 })
			}
			const R = V > 0 ? V / I : 0
			for (const res of items.filter((i) => i.type === "resistor" && series(i.id))) {
				const r0 = Number(res.props?.ohms ?? 100)
				const r1 = Math.max(1, Math.round((r0 - (R - R / k)) * 10) / 10)
				if (r1 < r0) out.push({ changes: [{ kind: "prop", id: res.id, key: "ohms", from: r0, to: r1 }], cost: 1 })
			}
		}
	}
	return out
}

/**
 * A part that should light, turn or sound but gets too little from a solar panel in the dark (the lights, spins and buzzes goals' aim): the
 * panel moved toward the nearest lamp or flashlight, a half, two thirds or four fifths of the way along the table (its light ∝ 1/distance²).
 */
function aimLit(g, entry, scene, run) {
	if (entry?.ok !== false) return []
	const items = scene?.items ?? []
	const st = run?.track?.state ?? {}
	const lastOf = (id, key) => {
		const v = st[id]?.[key]
		return Array.isArray(v) && v.length ? Number(v[v.length - 1]) : null
	}
	const out = []
	// (a small generator on a turning shaft, the energy module's: turned the wrong way for its leads its + is negative, so an LED wired + to +
	// stays dark: its leads swapped; turned too slowly for about 2 V: stepped up more)
	for (const gen of items.filter((i) => i.type === "generator" && typeof i.props?.shaft === "string")) {
		const v = Number(lastOf(gen.id, "voltage") ?? 0)
		const leads = gen.props?.leads === "swapped" ? "swapped" : "normal"
		const swap = v < -0.2 ? [{ kind: "prop", id: gen.id, key: "leads", from: leads, to: leads === "normal" ? "swapped" : "normal" }] : []
		if (swap.length) out.push({ changes: swap, cost: 1 })
		const r0 = Number(gen.props?.ratio ?? 1)
		if (Math.abs(v) > 0.05 && Math.abs(v) < 2)
			for (const f of [1.5, 2, 3]) {
				const to = Math.min(20, Math.round(r0 * f * 2) / 2)
				if (to > r0) out.push({ changes: [{ kind: "prop", id: gen.id, key: "ratio", from: r0, to }, ...swap], cost: 1 + f })
			}
	}
	const lights = items.filter((i) => i.type === "lamp" || i.type === "flashlight")
	if (!lights.length) return out
	for (const pv of items.filter((i) => i.type === "solar-panel" && Number(lastOf(i.id, "irradiance") ?? 0) < 1000)) {
		const x0 = Number(pv.x ?? 0)
		const L = lights.reduce((b, l) => (Math.abs(Number(l.x ?? 0) - x0) < Math.abs(Number(b.x ?? 0) - x0) ? l : b))
		// (to beside the lamp's head, about 30 cm along the table from its base: not onto it)
		const goal = Number(L.x ?? 0) + Math.sign(x0 - Number(L.x ?? 0) || 1) * 0.3
		const d = goal - x0
		if (Math.abs(d) < 0.05) continue
		for (const f of [0.5, 0.67, 0.8, 1]) out.push({ changes: [{ kind: "move", ids: [pv.id], dx: Math.round(d * f * 1000) / 1000, dy: 0 }], cost: 1 + f })
	}
	return out
}

const W = (id, a, ae, b, be, name) => ({ id, type: "wire", name, props: { a, a_end: ae, b, b_end: be }, place: { on: "air", x: 0.0, y_m: 0.0 }, why: "joins the two terminals" })

export const plugin = {
	title: "Circuits and electricity",
	howto: `A circuit is a closed LOOP from a battery's + back to its − through the parts: current flows only when every part of the one path is joined and closed. Parts: battery (AA cells in a holder: 1.58 V each fresh, kind AA/D/9V/lantern 6V, cells 1-6), bulb (2.5 V 0.3 A torch bulb: about 2 x AA lights it fully, 1 AA dimly, 9 V burns it out), led (one way only: + is its anode; needs a resistor of about 68-150 Ω on 3 V or it burns out over 30 mA), switch (knife: switched over at flip_at s, default 1 s; push: closed while something weighing at least its force rests on its button, or between press_from and press_to), resistor (ohms), dimmer (a rheostat turned during the run from knob to knob_to), buzzer (+ to −, sounds from 2 V), motor (drives a propeller that blows to the right, a paddle or a disc; 'geared' turns slowly and strongly; swapping its wires reverses it), tester (two copper probes 1.5 cm apart: a metal object laid across them closes the loop; plastic, wood, rubber, glass do not), meter (multimeter: volts across a part, or amps in the loop), solar-panel (light on its face makes current: sun W/m², or 0 indoors with a lamp near it), hand-generator (cranked at rpm from start_at).
WIRES are items of type "wire" with no place of their own: props {a: item id, a_end: "+" | "-", b: item id, b_end: "+" | "-"} (an end left unset is joined as current flows round the loop: a battery's + to a part's +, that part's − on to the next part's + or back to the battery's −) ("+" is a part's first terminal: a battery's +, an LED's anode, the right screw of a bulb, switch, resistor or tester; "-" its second). A wire end left without an item is a free end: the loop is open there. Several wires may share one terminal (parallel branches). A simple loop: battery + → wire → part + ; part − → wire → battery −. Series: parts one after another in the one loop (each gets part of the voltage: two bulbs in series are dim); parallel: each part on its own pair of wires across the battery (each gets the full voltage). A wire straight from + to − is a short circuit.
ELECTROMAGNETISM (with the magnetism module's magnets and compasses): electromagnet (an iron nail wound with 5-500 turns, held point down in a clamp in mid-air: wire it in a loop with a battery, a switch and an ammeter; current makes the nail a magnet, its point a north pole for current in at +; on 2 AA it takes about 4-5 A, so the digest may call the loop nearly a short: that is real; hang paper clips under its point as a held chain touching it, and it holds them while switched on, goal holds {magnet: the electromagnet}). coil (200 turns on a tube, 4 cm bore, held in a clamp; axis vertical or horizontal): wire a galvanometer (a meter, mode "galvanometer": centre zero, 0.5 mA full scale) across its two leads, then drop a bar magnet through it (the magnet angle 90, held: true, its middle 15-25 cm above the coil's middle, the coil's middle 15-25 cm above the table so the magnet falls clean through) or push one in: a voltage is induced only while the magnet moves (none while it rests), one way going in and the other coming out (goal induces {coil}); a stronger magnet (neodymium), more turns or a faster magnet: more voltage. straight-wire (Oersted's experiment: a bare copper wire stretched between two clamps in mid-air; runs "over": left to right, in_front 1.2 cm in front of the picture, so put a compass at the wire's own x and y and its needle is just behind the wire, as a compass under a wire; runs "through": straight through the picture, compasses round it point round it): wire it with a battery, a switch and a resistor of about 1 Ω (2 A: 40 µT 1 cm away, twice Earth's 20 µT); the needle swings when the current flows (goal deflects {compass}), the other way when it is reversed. A lead (a wire item) lies in the picture and makes its field across the picture, which turns no needle in it: use the straight wire for a wire's field.
SOLAR INDOORS: a solar-panel with sun 0 and a light on its face: the heat module's desk lamp with its target the panel (a 150 W halogen 20 cm off gives about 300 W/m² as sunlight), or a flashlight aimed at it; its current follows the light the optics module traces onto it (a shadow, a mirror, a lens count). Outdoors: its own sun prop (1000 W/m² full sun, at sun_angle), or the optics module's "sunlight" item with the panel's sun 0 (not both: they add up; the space module's "sun" is a star for orbits).
LAYOUT: put the parts on the table in a row, about 12-20 cm apart, each "on": "table" (their bases are 1-2 cm tall); or for a readable lesson picture, a circuit-board item (60 x 40 cm, on the table) with every part "mount": "board" placed "on": "air" at heights inside the board (a loop drawn as a rectangle: battery at the bottom, bulb at the top). A test object for the tester goes "on": "<tester id>" (it lies across the probes). Readings (light, current, voltage, rpm, sound, reading) and events ("Bulb lights at 1.02 s") come from the run.`,
	prompt: {
		plan: `For circuits: every wire is an item {type: "wire", props: {a, a_end, b, b_end}, place: {on: "air", x: 0, y_m: 0}} (its place is ignored). Make one closed loop from a battery's + back to its −. A bulb needs about 2.5-3 V (2 AA cells); an LED needs a resistor (68-150 Ω on 2-3 AA) and its + toward the battery's +. Use goals lights/stays_dark/glows_brighter/buzzes/spins/current/conducts on the part that should do it (lights {item: the bulb or LED}; for bulbs and LEDs these, not the light meters' lit/dark/brighter). Comparisons (series vs parallel, 1 vs 2 cells, conductor vs insulator) are two separate circuits side by side, each with its own battery. Electromagnetism: Oersted = battery + switch + resistor (1 Ω) + straight-wire (runs over) + a compass at the straight wire's own x and y, goal deflects {compass}; induction = coil (on air, axis vertical) + galvanometer (meter mode galvanometer) wired across it + a bar magnet held above it (angle 90) that falls through, goal induces {coil}; electromagnet = battery + switch + electromagnet (on air) + paper clips hung under its point (held), goal holds {magnet: the electromagnet}. Solar indoors: solar-panel sun 0 with a desk lamp whose target is the panel (or a flashlight aimed at it).`,
		edit: `For circuits: the digest lists each terminal's wires and each battery's loop (closed, OPEN at a part, or a short). To close an open loop, set the free wire end's a/b and a_end/b_end; to reverse a part (an LED or motor), swap its wires' ends; to change voltage, the battery's cells. Never change a tested object's material to make a tester conduct: the lesson is which materials conduct. A compass swings more with more current (more cells, a smaller resistor) or the straight wire nearer the needle (in_front smaller); a coil makes more voltage with more turns, a stronger magnet (neodymium) or a faster one (dropped from higher); an electromagnet holds more with more turns or more current; a solar panel indoors makes more with its lamp nearer or brighter.`,
		refine: `For circuits: a dark bulb means an open loop (a free wire end, an open switch, an insulator across the tester, an LED the wrong way round) or too little voltage; a burnt-out bulb or LED means too much (fewer cells, a resistor). A coil with no voltage: the magnet never moves through it (it misses the bore, or is not let go); a still compass by a straight wire: no current (an open loop) or the wire too far from the needle.`
	},
	examples: [
		{
			ask: "Show a battery lighting a bulb when a switch is closed.",
			how: "battery (cells 2), switch (knife, flip_at 1: it closes at 1 s) and bulb on the table about 20 cm apart; wires battery + → switch −, switch + → bulb −, bulb + → battery − (one loop); goal lights {item: bulb}",
			plan: {
				title: "Switch lights a bulb", seconds: 3, items: [
					{ id: "battery", type: "battery", name: "Battery", props: { cells: 2 }, place: { on: "table", x: 0.9 } },
					{ id: "switch", type: "switch", name: "Switch", props: { flip_at: 1 }, place: { on: "table", x: 1.1 } },
					{ id: "bulb", type: "bulb", name: "Bulb", place: { on: "table", x: 1.3 } },
					W("w1", "battery", "+", "switch", "-", "Wire 1"), W("w2", "switch", "+", "bulb", "-", "Wire 2"), W("w3", "bulb", "+", "battery", "-", "Wire 3")
				],
				goals: [{ kind: "lights", label: "The bulb lights", item: "bulb" }]
			}
		},
		{
			ask: "Compare two bulbs in series with two bulbs in parallel.",
			how: "two circuits side by side, each with its own battery (2 AA): series = battery + → bulb 1 → bulb 2 → battery − (three wires); parallel = each bulb on its own pair of wires straight across the battery (four wires); goal glows_brighter {a: a parallel bulb, b: a series bulb}",
			plan: {
				title: "Series and parallel bulbs", seconds: 2, items: [
					{ id: "bat1", type: "battery", name: "Series battery", place: { on: "table", x: 0.5 } },
					{ id: "s1", type: "bulb", name: "Series bulb 1", place: { on: "table", x: 0.7 } }, { id: "s2", type: "bulb", name: "Series bulb 2", place: { on: "table", x: 0.9 } },
					W("w1", "bat1", "+", "s1", "-", "Wire 1"), W("w2", "s1", "+", "s2", "-", "Wire 2"), W("w3", "s2", "+", "bat1", "-", "Wire 3"),
					{ id: "bat2", type: "battery", name: "Parallel battery", place: { on: "table", x: 1.6 } },
					{ id: "p1", type: "bulb", name: "Parallel bulb 1", place: { on: "table", x: 1.8 } }, { id: "p2", type: "bulb", name: "Parallel bulb 2", place: { on: "table", x: 2.0 } },
					W("w4", "bat2", "+", "p1", "-", "Wire 4"), W("w5", "p1", "+", "bat2", "-", "Wire 5"), W("w6", "bat2", "+", "p2", "-", "Wire 6"), W("w7", "p2", "+", "bat2", "-", "Wire 7")
				],
				goals: [{ kind: "glows_brighter", label: "Parallel bulbs are brighter", a: "p1", b: "s1" }]
			}
		},
		{
			ask: "Test whether a coin and an eraser conduct electricity.",
			how: "per test object its own loop battery → bulb → tester → battery, the object placed on the tester (place {on: tester id}) across its probes; goals lights {item: the coin's bulb} and stays_dark {item: the eraser's bulb}",
			plan: {
				title: "Conductor or insulator", seconds: 2, items: [
					{ id: "bat1", type: "battery", name: "Battery 1", place: { on: "table", x: 0.4 } }, { id: "bulb1", type: "bulb", name: "Bulb 1", place: { on: "table", x: 0.6 } },
					{ id: "t1", type: "tester", name: "Tester 1", place: { on: "table", x: 0.85 } }, { id: "coin", type: "coin-flat", name: "Coin", place: { on: "t1" } },
					W("w1", "bat1", "+", "bulb1", "-", "Wire 1"), W("w2", "bulb1", "+", "t1", "-", "Wire 2"), W("w3", "t1", "+", "bat1", "-", "Wire 3"),
					{ id: "bat2", type: "battery", name: "Battery 2", place: { on: "table", x: 1.5 } }, { id: "bulb2", type: "bulb", name: "Bulb 2", place: { on: "table", x: 1.7 } },
					{ id: "t2", type: "tester", name: "Tester 2", place: { on: "table", x: 1.95 } }, { id: "eraser", type: "eraser", name: "Eraser", place: { on: "t2" } },
					W("w4", "bat2", "+", "bulb2", "-", "Wire 4"), W("w5", "bulb2", "+", "t2", "-", "Wire 5"), W("w6", "t2", "+", "bat2", "-", "Wire 6")
				],
				goals: [{ kind: "lights", label: "The coin lights its bulb", item: "bulb1" }, { kind: "stays_dark", label: "The eraser's bulb stays dark", item: "bulb2" }]
			}
		},
		{
			ask: "A battery-powered fan blows a ping-pong ball along the table.",
			how: "battery and motor (drives propeller: it blows to the right) on the table, wires battery + → motor +, motor − → battery −, a ping-pong-ball 20 cm to the motor's right; goals spins {item: motor} and moves {item: ball, min_m 0.1}",
			plan: {
				title: "Battery fan", seconds: 3, items: [
					{ id: "battery", type: "battery", name: "Battery", place: { on: "table", x: 0.5 } }, { id: "fan", type: "motor", name: "Fan", props: { drives: "propeller" }, place: { on: "table", x: 0.8 } },
					{ id: "ball", type: "ping-pong-ball", name: "Ping-pong ball", place: { on: "table", x: 1.0 } },
					W("w1", "battery", "+", "fan", "+", "Wire 1"), W("w2", "fan", "-", "battery", "-", "Wire 2")
				],
				goals: [{ kind: "spins", label: "The fan turns", item: "fan" }, { kind: "moves", label: "The ball is blown along", item: "ball", min_m: 0.1 }]
			}
		},
		{
			ask: "A ball rolls onto a doorbell button and the buzzer sounds.",
			how: "battery → push switch (style push, force 0.3 N) → buzzer → battery, a tennis-ball held 30 cm above the button; it drops on it at the release and closes the switch while it rests there; goal buzzes {item: buzzer}",
			plan: {
				title: "Ball rings the doorbell", seconds: 3, items: [
					{ id: "battery", type: "battery", name: "Battery", place: { on: "table", x: 0.8 } }, { id: "push", type: "switch", name: "Doorbell button", props: { style: "push", force: 0.3 }, place: { on: "table", x: 1.0 } },
					{ id: "buzzer", type: "buzzer", name: "Buzzer", place: { on: "table", x: 1.2 } }, { id: "ball", type: "tennis-ball", name: "Tennis ball", place: { on: "air", x: 1.0, y_m: 0.3 }, held: true },
					W("w1", "battery", "+", "push", "+", "Wire 1"), W("w2", "push", "-", "buzzer", "+", "Wire 2"), W("w3", "buzzer", "-", "battery", "-", "Wire 3")
				],
				goals: [{ kind: "buzzes", label: "The buzzer sounds", item: "buzzer" }]
			}
		},
		{
			ask: "A desk lamp shines on a solar panel that runs a motor (indoors, no sun).",
			how: "the heat module's lamp (bulb halogen, power_w 150, head_height 0.25, target: the panel) on the table, the solar-panel 30 cm to its right with sun 0 (indoors: only the lamp's light), a motor (kind solar, drives propeller) beside it, wires panel + → motor +, motor − → panel −; goal spins {item: motor} (the panel reads about 270 W/m² of sunlight's worth, the motor 1500 rpm)",
			plan: {
				title: "Lamp light runs a motor", seconds: 3, items: [
					{ id: "lamp", type: "lamp", name: "Desk lamp", props: { bulb: "halogen", power_w: 150, head_height: 0.25, target: "panel" }, place: { on: "table", x: 0.55 } },
					{ id: "panel", type: "solar-panel", name: "Solar panel", props: { sun: 0 }, place: { on: "table", x: 0.85 } },
					{ id: "motor", type: "motor", name: "Solar motor", props: { kind: "solar", drives: "propeller" }, place: { on: "table", x: 1.15 } },
					W("w1", "panel", "+", "motor", "+", "Red wire"), W("w2", "motor", "-", "panel", "-", "Black wire")
				],
				goals: [{ kind: "spins", label: "The lamp's light runs the motor", item: "motor" }]
			}
		},
		{
			ask: "Oersted's experiment: a compass under a wire swings when the current is switched on.",
			how: "battery (2 AA) → switch (flip_at 1.5) → resistor (1 Ω) → straight-wire (runs over, place on air y_m 0.06) → back to the battery (2 A: 40 µT 1 cm away); a compass at the straight wire's own x and y_m (its needle just behind the wire, as under it); goal deflects {compass, at_least_deg 20} (it swings to about 50°)",
			plan: {
				title: "A current makes a magnetic field", seconds: 4, release: 0.3, items: [
					{ id: "bat", type: "battery", name: "Battery", props: { cells: 2 }, place: { on: "table", x: 0.6 } },
					{ id: "sw", type: "switch", name: "Switch", props: { flip_at: 1.5 }, place: { on: "table", x: 0.8 } },
					{ id: "res", type: "resistor", name: "Resistor", props: { ohms: 1 }, place: { on: "table", x: 1.0 } },
					{ id: "wire", type: "straight-wire", name: "Straight wire", props: { runs: "over" }, place: { on: "air", x: 1.5, y_m: 0.06 } },
					{ id: "compass", type: "compass", name: "Compass", place: { on: "air", x: 1.5, y_m: 0.06 } },
					W("w1", "bat", "+", "sw", "+", "Wire 1"), W("w2", "sw", "-", "res", "+", "Wire 2"), W("w3", "res", "-", "wire", "+", "Wire 3"), W("w4", "wire", "-", "bat", "-", "Wire 4")
				],
				goals: [{ kind: "deflects", label: "The needle swings when the current flows", compass: "compass", at_least_deg: 20 }]
			}
		},
		{
			ask: "Drop a magnet through a coil and watch a galvanometer flick (electromagnetic induction).",
			how: "coil (turns 200, axis vertical, place on air y_m 0.2), a bar-magnet (length 0.06, material neodymium) held above it (held: true, place on air, same x, y_m 0.42, angle_deg 90) that falls through it at the release (0.5 s), a meter (mode galvanometer) on the table wired across the coil's two leads (coil + → meter +, meter − → coil −); goal induces {coil, at_least_mv 10} (it peaks over a volt; the needle flicks one way going in, the other coming out)",
			plan: {
				title: "A moving magnet makes a current", seconds: 1.5, release: 0.5, items: [
					{ id: "coil", type: "coil", name: "Coil", props: { turns: 200, axis: "vertical" }, place: { on: "air", x: 1.3, y_m: 0.2 } },
					{ id: "mag", type: "bar-magnet", name: "Bar magnet", props: { length: 0.06, material: "neodymium" }, held: true, place: { on: "air", x: 1.3, y_m: 0.42, angle_deg: 90 } },
					{ id: "g", type: "meter", name: "Galvanometer", props: { mode: "galvanometer" }, place: { on: "table", x: 1.7 } },
					W("w1", "coil", "+", "g", "+", "Wire 1"), W("w2", "g", "-", "coil", "-", "Wire 2")
				],
				goals: [{ kind: "induces", label: "The falling magnet induces a voltage", coil: "coil", at_least_mv: 10 }]
			}
		},
		{
			ask: "Switch on an electromagnet wired to a battery and an ammeter: it holds paper clips while the current flows.",
			how: "battery (2 AA) → switch (closed true, flip_at 0) → meter (mode amps) → electromagnet (turns 50, place on air y_m 0.244: its 5 cm nail's point 21.9 cm up) → back to the battery; a paper-clip chain (count 6, spacing 0.0345, held: true, place {on: air, the electromagnet's x, y_m 0.11425, angle_deg -90}: its top clip at the nail's point; for another y_m put the chain's middle 0.13 m below the nail's middle); release 0.3; goals holds {magnet: the electromagnet, count 1, items: [the chain]} and current {item: the electromagnet, at_least_a 1} (about 4.6 A); with flip_at 1 it lets them go at 1 s",
			plan: {
				title: "Electromagnet in a circuit", seconds: 1.8, release: 0.3, items: [
					{ id: "bat", type: "battery", name: "Battery", props: { cells: 2 }, place: { on: "table", x: 0.6 } },
					{ id: "sw", type: "switch", name: "Switch", props: { closed: true, flip_at: 0 }, place: { on: "table", x: 0.8 } },
					{ id: "amm", type: "meter", name: "Ammeter", props: { mode: "amps" }, place: { on: "table", x: 1.0 } },
					{ id: "em", type: "electromagnet", name: "Electromagnet", props: { turns: 50 }, place: { on: "air", x: 1.4, y_m: 0.244 } },
					{ id: "clips", type: "paper-clip", name: "Paper clips", props: { count: 6, spacing: 0.0345 }, held: true, place: { on: "air", x: 1.4, y_m: 0.11425, angle_deg: -90 } },
					W("w1", "bat", "+", "sw", "+", "Wire 1"), W("w2", "sw", "-", "amm", "+", "Wire 2"), W("w3", "amm", "-", "em", "+", "Wire 3"), W("w4", "em", "-", "bat", "-", "Wire 4")
				],
				goals: [{ kind: "holds", label: "Switched on, it holds the clips", magnet: "em", count: 1, items: ["clips"] }, { kind: "current", label: "Amps flow through its coil", item: "em", at_least_a: 1 }]
			}
		}
	],
	goals: [
		{
			kind: "lights", aliases: ["light", "glows", "bulb_lights", "led_lights", "lights_up"], fields: { item: "item", at_least: "number?", before_s: "number?" },
			about: "lights {item: a bulb or LED, at_least?, before_s?}: it glows with at least at_least (default 0.1) of its full light over the run's last 0.5 s (with before_s: it first does by then)",
			label: (g, n) => `${n(g.item)} lights${Number.isFinite(g.before_s) ? ` by ${g.before_s} s` : ""}`,
			summarize: (ctx, g) => goal_lights(ctx, g),
			aim: (g, entry, scene, run) => aimLit(g, entry, scene, run),
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => i.type === "bulb" || i.type === "led")
				return l.length ? { kind: "lights", item: pick(l).id, ...(pick([true, false]) ? { before_s: 1.5 } : {}), ...(pick([true, false]) ? { at_least: 0.5 } : {}) } : null
			}
		},
		{
			kind: "stays_dark", aliases: ["bulb_dark", "led_dark", "never_lights"], fields: { item: "item" },
			about: "stays_dark {item: a bulb or LED}: it never lights (stays under 0.1 of its full light all run): an open loop, an insulator, a reversed LED",
			label: (g, n) => `${n(g.item)} stays dark`,
			summarize: (ctx, g) => goal_dark(ctx, g),
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => i.type === "bulb" || i.type === "led")
				return l.length ? { kind: "stays_dark", item: pick(l).id } : null
			}
		},
		{
			kind: "glows_brighter", aliases: ["bulb_brighter", "brighter_bulb"], fields: { a: "item", b: "item" }, subject: ["a"],
			about: "glows_brighter {a, b: bulbs or LEDs}: a ends at least 5 % brighter than b (series vs parallel, more cells)",
			label: (g, n) => `${n(g.a)} is brighter than ${n(g.b)}`,
			summarize: (ctx, g) => goal_brighter(ctx, g),
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => i.type === "bulb" || i.type === "led")
				return l.length > 1 ? { kind: "glows_brighter", a: l[0].id, b: l[1].id } : null
			}
		},
		{
			kind: "buzzes", aliases: ["buzz", "beeps", "rings"], fields: { item: "item", before_s: "number?" },
			about: "buzzes {item: a buzzer, before_s?}: it sounds (for at least 0.03 s; by before_s if given)",
			label: (g, n) => `${n(g.item)} sounds`,
			summarize: (ctx, g) => goal_buzzes(ctx, g),
			aim: (g, entry, scene, run) => aimLit(g, entry, scene, run),
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => i.type === "buzzer")
				return l.length ? { kind: "buzzes", item: pick(l).id } : null
			}
		},
		{
			kind: "spins", aliases: ["spin", "turns", "motor_turns", "runs"], fields: { item: "item", at_least_rpm: "number?" },
			about: "spins {item: a motor or hand generator, at_least_rpm?}: it turns at least at_least_rpm (default 30) over the run's last 0.5 s, either way",
			label: (g, n) => `${n(g.item)} turns`,
			summarize: (ctx, g) => goal_spins(ctx, g),
			aim: (g, entry, scene, run) => aimLit(g, entry, scene, run),
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => i.type === "motor")
				return l.length ? { kind: "spins", item: pick(l).id, ...(pick([true, false]) ? { at_least_rpm: 500 } : {}) } : null
			}
		},
		{
			kind: "current", aliases: ["amps", "carries_current"], fields: { item: "item", at_least_a: "number?", at_most_a: "number?" },
			about: "current {item: any circuit part, at_least_a?, at_most_a?}: its current (A) over the run's last 0.5 s is within the bounds (no bounds: any current at all)",
			label: (g, n) => `${n(g.item)} carries a current`,
			summarize: (ctx, g) => goal_current(ctx, g),
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => PART_TYPES.has(i.type) || i.type === "wire")
				return l.length ? { kind: "current", item: pick(l).id, ...(pick([true, false]) ? { at_least_a: 0.1 } : {}), ...(pick([true, false]) ? { at_most_a: 0.5 } : {}) } : null
			}
		},
		{
			kind: "conducts", aliases: ["conductor", "closes_circuit"], fields: { item: "item" },
			about: "conducts {item: a tester}: the object across its probes conducts at the run's end (current flows through it)",
			label: (g, n) => `${n(g.item)} conducts`,
			summarize: (ctx, g) => goal_conducts(ctx, g),
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => i.type === "tester")
				return l.length ? { kind: "conducts", item: pick(l).id } : null
			}
		},
		{
			kind: "deflects", aliases: ["needle_swings", "compass_swings", "compass_deflects", "oersted", "needle_deflects"], fields: { compass: "item", at_least_deg: "number?", at_s: "number?" }, subject: ["compass"],
			about: "deflects {compass, at_least_deg?, at_s?}: a compass's needle ends turned at least at_least_deg (default 15°) away from north, where the Earth's field alone points it (over the run's last 0.5 s, or at at_s): a straight wire's current (Oersted), an electromagnet, a magnet brought near (a beam bending is bends)",
			label: (g, n) => `${n(g.compass)}'s needle swings`,
			summarize: (ctx, g) => goal_deflects(ctx, g),
			// (the make-it-work search's targeted try: a straight wire running over the needle brought nearer, its field there ∝ 1/distance and the
			// swing's tangent ∝ the wire's field over the Earth's)
			aim: (g, entry, scene, run) => aimDeflects(g, entry, scene, run),
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => i.type === "compass")
				return l.length ? { kind: "deflects", compass: pick(l).id, ...(pick([true, false]) ? { at_least_deg: pick([5, 30, 60]) } : {}), ...(pick([true, false]) ? { at_s: 1 } : {}) } : null
			}
		},
		{
			kind: "induces", aliases: ["induce", "induced", "induced_voltage", "emf", "makes_voltage", "induction"], fields: { coil: "item", at_least_mv: "number?", before_s: "number?" }, subject: ["coil"],
			about: "induces {coil, at_least_mv?, before_s?}: a voltage of at least at_least_mv (default 1 mV, either way) is induced in a coil at some moment (by before_s if given): a magnet moving in or out of it",
			label: (g, n) => `${n(g.coil)} makes a voltage`,
			summarize: (ctx, g) => goal_induces(ctx, g),
			// (the targeted try: more turns, the EMF ∝ the turns (Faraday), with 15 % to spare)
			aim: (g, entry, scene) => {
				const peak = Number(entry?.peak_mv)
				const least = Number.isFinite(g.at_least_mv) ? g.at_least_mv : 1
				if (!(peak > 0) || peak >= least) return []
				const coil = (scene?.items ?? []).find((i) => i.id === g.coil && i.type === "coil")
				if (!coil) return []
				const n0 = Number(coil.props?.turns ?? 200)
				const n1 = Math.min(2000, Math.ceil((n0 * least * 1.15) / peak / 10) * 10)
				return n1 > n0 ? [{ changes: [{ kind: "prop", id: coil.id, key: "turns", from: n0, to: n1 }], cost: 1 }] : []
			},
			sample: (scene, pick) => {
				const l = scene.items.filter((i) => i.type === "coil")
				return l.length ? { kind: "induces", coil: pick(l).id, ...(pick([true, false]) ? { at_least_mv: pick([0.1, 5, 100]) } : {}), ...(pick([true, false]) ? { before_s: 1 } : {}) } : null
			}
		}
	],
	knobs: [
		{ type: "wire", key: "a", how: "link", cost: 1, more: "clip {it}'s end a to another part", less: "clip {it}'s end a to another part", why: "closes or reroutes the loop at that end" },
		{ type: "wire", key: "b", how: "link", cost: 1, more: "clip {it}'s end b to another part", less: "clip {it}'s end b to another part", why: "closes or reroutes the loop at that end" },
		{ type: "wire", key: "a_end", how: "choice", cost: 0.8, more: "move {it}'s end a to the other terminal", less: "move {it}'s end a to the other terminal", why: "which terminal decides the direction of the current through a part (an LED, a buzzer, a motor) and whether the loop closes" },
		{ type: "wire", key: "b_end", how: "choice", cost: 0.8, more: "move {it}'s end b to the other terminal", less: "move {it}'s end b to the other terminal", why: "which terminal decides the direction of the current and whether the loop closes" },
		{ type: "wire", key: "length", how: "rel", cost: 2, more: "use a longer {it}", less: "use a shorter {it}", why: "a wire stretched past its length comes off its terminal" },
		{ type: "battery", key: "cells", how: "abs", steps: [1, 2, 3], cost: 1, more: "put another cell in {it}", less: "take a cell out of {it}", why: "each AA cell adds 1.58 V: more voltage, more current, a brighter bulb or a faster motor (too many burn a bulb out)" },
		{ type: "battery", key: "charge_pct", how: "rel", cost: 3, more: "use a fresher battery", less: "use a more run-down battery", why: "a run-down battery gives less voltage" },
		{ type: "bulb", key: "rating", how: "choice", cost: 2, more: "use a bulb rated for this voltage", less: "use a bulb rated for this voltage", why: "a bulb is brightest without burning out at its rated voltage" },
		{ type: "led", key: "color", how: "choice", cost: 2, more: "use an LED of another colour", less: "use an LED of another colour", why: "LEDs of different colours need different voltages: red about 2 V, blue and white about 3.2 V (on 3 V a blue LED takes a safe current without a resistor; a red one burns out)" },
		{ type: "resistor", key: "ohms", how: "rel", cost: 1, more: "use a bigger resistor", less: "use a smaller resistor", why: "more resistance, less current (an LED needs enough to stay under 30 mA, little enough to light)" },
		{ type: "dimmer", key: "knob_to", how: "abs", steps: [0.1, 0.2, 0.3, 0.5], cost: 1, more: "turn {it} further", less: "turn {it} less far", why: "turned up, more resistance: the bulb dims" },
		{ type: "dimmer", key: "knob", how: "abs", steps: [0.1, 0.2, 0.3, 0.5], cost: 1, more: "start {it} turned further up", less: "start {it} turned further down", why: "where the knob starts sets the first brightness" },
		{ type: "switch", key: "closed", how: "bool", cost: 1.5, more: "start {it} closed", less: "start {it} open", why: "a closed switch completes the loop" },
		{ type: "switch", key: "flip_at", how: "abs", steps: [0.25, 0.5, 1.0], cost: 1, more: "switch {it} later", less: "switch {it} sooner", why: "when the switch is switched over" },
		{ type: "switch", key: "force", how: "rel", cost: 1, more: "make {it} harder to press", less: "make {it} easier to press", why: "a push switch closes only under at least this weight" },
		{ type: "buzzer", key: "volts", how: "rel", cost: 2, more: "use a buzzer rated higher", less: "use a buzzer rated lower", why: "a buzzer sounds from two thirds of its rated voltage" },
		{ type: "motor", key: "kind", how: "choice", cost: 2, more: "use another kind of motor", less: "use another kind of motor", why: "a geared motor turns slowly and strongly, a hobby motor fast, a solar motor on very little current" },
		{ type: "motor", key: "size", how: "rel", cost: 1.5, more: "give {it} a bigger attachment", less: "give {it} a smaller attachment", why: "a bigger propeller moves more air but slows the motor" },
		{ type: "tester", key: "gap", how: "m", cost: 1, more: "move {it}'s probes apart", less: "move {it}'s probes closer", why: "the test object must touch both probes" },
		{ type: "solar-panel", key: "sun", how: "rel", cost: 2, more: "put {it} in brighter light", less: "put {it} in dimmer light", why: "its current is proportional to the light on it" },
		{ type: "solar-panel", key: "tilt", how: "deg", cost: 1, more: "tilt {it} more", less: "tilt {it} less", why: "it makes most current facing the light" },
		{ type: "hand-generator", key: "rpm", how: "rel", cost: 1, more: "crank {it} faster", less: "crank {it} slower", why: "its voltage is proportional to how fast it is turned" },
		{ type: "solar-panel", key: "x", steps: [0.05, 0.1, 0.2, 0.4, 0.7], cost: 1, more: "move {it} along", less: "move {it} back", why: "a lamp's light on it falls off as 1/distance²: nearer the lamp, more current" },
		{ type: "coil", key: "turns", how: "rel", cost: 1, more: "wind more turns on {it}", less: "wind fewer turns on {it}", why: "the induced voltage is proportional to the turns (Faraday's law); more turns also more resistance" },
		{ type: "coil", key: "diameter", how: "rel", cost: 2, more: "use a wider coil than {it}", less: "use a narrower coil than {it}", why: "a narrower bore hugs the magnet: more of its flux through each turn (it must still let the magnet through)" },
		{ type: "electromagnet", key: "turns", how: "rel", cost: 1, more: "wind more turns on {it}", less: "wind fewer turns on {it}", why: "more turns, more field for the same current (n·I), until the nail's iron is full" },
		{ type: "straight-wire", key: "in_front", how: "m", steps: [0.002, 0.004, 0.008], cost: 1, more: "move {it} further from the needle", less: "move {it} nearer the needle", why: "its field falls off as 1/distance: nearer the needle, a bigger swing" },
		{ type: "straight-wire", key: "length", how: "rel", cost: 2, more: "use a longer {it}", less: "use a shorter {it}", why: "a longer wire is a little stronger at its middle and has a little more resistance" }
	],
	digest: (item, run) => circuitDigest(item, run),
	// (a wire and a circuit board have no body of their own to stand: a wire runs between its terminals, a board is drawn behind the parts)
	place: { held: (type) => type === "wire" || type === "circuit-board" },
	words: { change: (type, key, a, b, nameOf) => changeWords(type, key, a, b, nameOf) }
}
