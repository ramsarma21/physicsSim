// The energy module: devices that turn one form of energy into another (NGSS 4-PS3-4): a paper windmill (pinwheel) and a model wind turbine
// turned by the wind the engine blows, a spool on their shaft and on the flow module's waterwheel that winds a thread to lift a cup of pennies,
// and a small generator on any of those turning shafts that lights an LED with the circuits module's parts. A port of machines/mod_energy.py,
// line by line (same names, same order, same numbers); it imports nothing: everything comes from the framework object register_all gets
// (web/sim/items.js FRAMEWORK; F.py is pymath.js). Its `plugin` export is the AI's view of it (web/sim/plugins.js). The engine side:
// tooling/src/sim/energy.ts and tooling/src/sim/modules/energy.ts (roles rotor, pass); a spool is the mechanics module's spool record, a
// generator a part of the circuits module's circuit record. The battery car (a motor that drives a car's wheels) is in circuits.js.
// Sources: see the Python file's docstring ([JWEA], [VERNIER], [KIDWIND], [MAB], [PENNY]).
let register, ItemType, Prop, Link, Readout, register_build_hook, register_common_prop, MATERIALS, add_look, define_material, props_of, TYPES, CATEGORIES, Ctx, D2R
let pyRound, fmtF, fmtG, truthy, cos, sin
let F = null

export const MODULE = "energy"
const CAT = "Energy devices"
const PENNY_G = 2.5
const CUP_G = 3.0
const CUP_W = 0.05
const CUP_H = 0.06
const CUP_D = 0.05
const SPOOL_GAP = 0.02
const PIN_SOLIDITY = 0.3
const PIN_TWIST = 15.0
const PIN_HUB = 0.012
const CD0 = 0.02
const PAPERS = { "copy paper": 0.08, card: 0.2, "plastic sheet": 0.14 }
const BLADE_SHEETS = { "corrugated plastic": 0.65, cardboard: 0.3, balsa: 0.32 }
const DOWEL = 0.02
const STRAW_MU = 0.3
const STRAW_R = 0.0015
const SHAFT_MU = 0.15
const SHAFT_R = 0.001
const TURBINE_HUB = 0.03
let GENERATORS = null
export const SHAFT_TYPES = ["waterwheel", "pinwheel", "wind-turbine", "wheel-and-axle"]
const POURERS = ["tap", "pitcher", "hose", "leaky-bottle"]

export function register_all(g) {
	F = g
	;({ register, ItemType, Prop, Link, Readout, register_build_hook, register_common_prop, MATERIALS, add_look, define_material, props_of, TYPES, CATEGORIES, Ctx, D2R } = g)
	;({ pyRound, fmtF, fmtG, truthy, cos, sin } = g.py)
	const fa130 = pyRound((3 - 0.2 * (3 / 2.2)) / ((9100 * 2 * Math.PI) / 60), 7)
	GENERATORS = {
		"KidWind generator": { k: pyRound(5.9 / ((2000 * 2 * Math.PI) / 60), 6), r: 38.0, fric: 0.0002, J: 5e-7, can: [0.045, 0.032] },
		"hobby motor": { k: fa130, r: pyRound(3 / 2.2, 4), fric: pyRound(0.2 * fa130, 7), J: 3e-8, can: [0.038, 0.02] }
	}
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
	_looks()
	_pinwheel()
	_turbine()
	_generator()
	register_common_prop(new Prop("load_g", "Load on its axle", 0.0, 0.0, 2000.0, 1.0, "g", "A cup of pennies on a thread wound on its axle (a US cent is 2.5 g); 0: no thread", { slider_max: 500.0 }), (t) => t.key === "waterwheel")
	register_common_prop(new Prop("axle_mm", "Spool across", 12.0, 2.0, 40.0, 0.5, "mm", "Where the thread winds: a thinner spool lifts a heavier load, more slowly"), (t) => t.key === "waterwheel")
	register_common_prop(new Prop("winds", "Thread winds as it turns", "auto", { kind: "choice", choices: ["auto", "clockwise", "counter-clockwise"], help: "auto: the way the stream above it turns it (falling on its right, clockwise)" }), (t) => t.key === "waterwheel")
	register_build_hook(_wheel_spools)
}

function _looks() {
	if (!Object.prototype.hasOwnProperty.call(MATERIALS, "turbine plastic")) {
		add_look("turbine plastic", { fill: "#e8e9ec", shade: "#a9adb5", roughness: 0.45, metalness: 0.0, clearcoat: 0.2 })
		define_material("turbine plastic", { density: 1100, bounce: 0.5, friction: 0.4, rolling: 0.01, side: 0.0, look: "turbine plastic", source: "ABS and polypropylene parts, 900-1200 kg/m3 (provisional)." }, ["density"])
	}
}

// ---------------------------------------------------------------- helpers
const _r = (v, d = 5) => pyRound(v, d)
const _has = (k) => Object.prototype.hasOwnProperty.call(MATERIALS, k)
const _side = (P) => (P.facing === "left" ? 1.0 : -1.0)

function _rotor_inertia(B, r0, R, c0, c1, sheet, dowel = 0.0) {
	const slope = (c1 - c0) / (R - r0)
	const a = c0 - slope * r0
	const r3 = R * R * R - r0 * r0 * r0
	const r4 = R * R * R * R - r0 * r0 * r0 * r0
	const J = B * (sheet * ((a * r3) / 3 + (slope * r4) / 4) + (dowel * r3) / 3)
	const m = B * (sheet * (a * (R - r0) + (slope * (R * R - r0 * r0)) / 2) + dowel * (R - r0))
	return [J, m]
}

const STAND_IN_R = 0.02

function _stand_in(c, x, y, J, kind) {
	const rs = STAND_IN_R
	const m = Math.max((2 * J) / (rs * rs), 1e-4)
	const dens = m / ((4 / 3) * Math.PI * rs * rs * rs)
	const mat = c.mat({ base: "turbine plastic", density: Number(fmtG(dens, 6)), overrides: {} })
	return c.ball("hub", rs, x, y, { material: mat, kind, look: "turbine plastic", words: "the rotor's shaft", inertia: 0.5, pivot: { x: 0.0, y: 0.0 }, ghost: true, hidden_3d: true })
}

function _bearing(c, x, y, friction, wound = null) {
	const extra = wound === null ? {} : { limits: { lower: -10000.0, upper: _r(wound, 4) } }
	c.joint("pin", "bearing", { a: null, b: "hub", anchorA: [x, y], anchorB: [0, 0], friction: _r(friction, 7), ...extra, render: { hinge: "none" } })
}

const _winding = (free, r_spool) => Math.max(0.0, (free - SPOOL_GAP - 0.002) / r_spool)

function _cup(c, sx, sy, r_spool, sense, load_g, drum, others, z = 0.0) {
	const kg = load_g / 1000
	const x = sx + sense * r_spool
	const mat = c.mat({ base: "cardboard", density: _r(kg / (CUP_W * CUP_H * CUP_D), 3), overrides: {} })
	const cup = c.slab("load", CUP_W, CUP_H, CUP_D, x, CUP_H / 2, { material: mat, kind: "dynamic", look: "cardboard", words: `a paper cup of pennies (${_trim(load_g)} g)` })
	c.process("mechanics", "thread", { role: "spool", drum, b: cup, center: { x: 0.0, y: 0.0 }, radius: _r(r_spool, 6), sense: Math.trunc(sense), anchorB: { x: 0.0, y: _r(CUP_H / 2) }, minLength: SPOOL_GAP, ...(Math.abs(z) > 1e-9 ? { z: _r(z, 4) } : {}) })
	c.process("mechanics", "thread-pull", { role: "meter", reads: "rope", a: drum, b: cup, key: "pull_n" })
	c.process("mechanics", "lift", { role: "meter", reads: "rise", solid: cup, key: "lift_m" })
	c.process("energy", "load-pass", { role: "pass", solid: cup, through: [...others] })
	return cup
}

const _axis = (c, s) => _r((s > 0 ? 0.0 : Math.PI) + c.a, 6)

export function _trim(v) {
	const t = fmtF(v, 2)
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t
}

function _world(c, lx, ly) {
	const [x, y] = c.world(lx, ly)
	return { x: _r(x), y: _r(y) }
}

// ---------------------------------------------------------------- the paper windmill (pinwheel)
function _head(P, down, up) {
	const s = _side(P)
	const a = P.yaw * D2R
	const ca = cos(a)
	const sa = sin(a)
	return [s, s * down * ca, -s * up * ca, -down * sa]
}

export function pinwheel_geometry(P) {
	const [s, sx, rx, sz] = _head(P, 0.08, 0.04)
	const H = P.height
	return { spool: [sx, H], rotor: [rx, H], spool_z: sz, side: s }
}

function _pinwheel() {
	function build(c, P) {
		const s = _side(P)
		const H = P.height
		const D = P.diameter
		const B = Math.trunc(P.blades)
		const R = D / 2
		const kind = truthy(c.item.fixed) ? "static" : "dynamic"
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		const foot = c.slab("foot", 0.1, 0.012, 0.08, 0.0, 0.006, { kind: "static", material: wood, look: "wood", words: "the windmill's foot board" })
		const post = c.slab("post", 0.02, H - 0.002, 0.02, 0.0, 0.012 + (H - 0.002) / 2 - 0.005, { kind: "static", material: wood, look: "wood", words: "the windmill's post" })
		const geo = pinwheel_geometry(P)
		const [sx, sy] = geo.spool
		const [rx, ry] = geo.rotor
		const c0 = (PIN_SOLIDITY * 2 * Math.PI * PIN_HUB) / B
		const c1 = (PIN_SOLIDITY * 2 * Math.PI * R) / B
		const sheet = PAPERS[P.paper]
		let [J, m] = _rotor_inertia(B, PIN_HUB, R, c0, c1, sheet)
		J += 0.0005 * 0.003 * 0.003 + (0.001 * 0.005 * 0.005) / 2
		m += 0.0015
		const hub = _stand_in(c, sx, sy, J, kind)
		const load = P.load_g
		const r_spool = P.axle_mm / 2000
		_bearing(c, sx, sy, STRAW_MU * STRAW_R * (m + load / 1000) * c.settings.gravity, load > 0 ? _winding(sy - CUP_H, r_spool) : null)
		const span = R - PIN_HUB
		const pitch = P.pitch
		c.process("energy", "rotor", {
			role: "rotor", solid: hub, at: _world(c, rx, ry), axis: _axis(c, s), yaw: _r(P.yaw * D2R, 6),
			rotor: { blades: B, r0: PIN_HUB, R: _r(R), chord: [_r(c0, 6), _r(c1, 6)], pitch: [_r(Math.min(80.0, pitch + PIN_TWIST) * D2R, 6), _r(pitch * D2R, 6)], ar: _r(span / ((c0 + c1) / 2), 4), cd0: CD0, stations: 8 }
		})
		if (load > 0) _cup(c, sx, sy, r_spool, 1.0, load, hub, [foot, post], geo.spool_z)
		P.rotor_g = _r(m * 1000, 2)
		P.pennies = load > 0 ? Math.max(0, Math.trunc((load - CUP_G) / PENNY_G)) : 0
	}
	register(new ItemType("pinwheel", "Paper windmill", CAT, build, {
		dynamic: false, module: MODULE,
		props: [
			new Prop("diameter", "Across its sails", 0.2, 0.1, 0.4, 0.01, "m"),
			new Prop("blades", "Sails", 4, 2, 8, 1, "", "How many sails (cut from one square: more sails, narrower ones)", { kind: "int" }),
			new Prop("pitch", "Sail angle", 18.0, 5.0, 45.0, 1.0, "°", "How far the sails' tips are turned from the windmill's face (they twist 15° more toward the middle)"),
			new Prop("paper", "Made of", "copy paper", { kind: "choice", choices: Object.keys(PAPERS) }),
			new Prop("height", "Axle height", 0.3, 0.12, 0.6, 0.01, "m", "The straw axle's height above its foot"),
			new Prop("facing", "Wind from", "left", { kind: "choice", choices: ["left", "right"], help: "The side its sails face: the wind must blow from there" }),
			new Prop("yaw", "Turned toward you", 0.0, 0.0, 60.0, 1.0, "°", "0: square into the wind (the most power); more shows its face but catches less wind (about cos³ of the angle in power)"),
			new Prop("load_g", "Load on the thread", 0.0, 0.0, 500.0, 1.0, "g", "A paper cup of pennies on a thread tied to the straw (a US cent is 2.5 g, the cup 3 g); 0: no thread"),
			new Prop("axle_mm", "Straw across", 6.0, 2.0, 30.0, 0.5, "mm", "Where the thread winds: a thinner axle lifts a heavier load, more slowly (a skewer 3 mm, a straw 6 mm, a cotton reel 25 mm)")
		],
		readouts: [
			new Readout("rpm", "Turning", { unit: "rpm", digits: 0 }), new Readout("wind_ms", "Wind on it", { unit: "m/s", digits: 2 }), new Readout("tsr", "Tip speed ÷ wind", { unit: "", digits: 2 }),
			new Readout("power_mw", "Power from the wind", { unit: "mW", digits: 1 }), new Readout("lift_m", "Load lifted", { unit: "m", digits: 3 }), new Readout("pull_n", "Thread pulls", { unit: "N", digits: 3 })
		],
		tags: ["pinwheel", "windmill", "paper windmill", "wind", "windmill winch", "lift", "energy", "wind energy", "sails", "turns"],
		description: "A paper windmill (a pinwheel) on a straw axle through a wooden post, its sails facing the wind: a fan's or a breeze's wind turns it, and a thread tied to the straw can wind up a paper cup of pennies (the windmill-winch challenge).",
		source: "Blade-element momentum theory with flat-plate sails; a four-sail pinwheel peaks at about 0.17 of the wind's power at a tip speed 2 times the wind's (wind-tunnel tests of pinwheel rotors, Wind Engineering 27, 2003).",
		anchor: "the middle of its foot's bottom", facts: "20 cm · 4 sails · lifts about 60 g in a 4 m/s wind on a 6 mm straw"
	}))
}

// ---------------------------------------------------------------- the model wind turbine
export function turbine_geometry(P) {
	const [s, sx, rx, sz] = _head(P, 0.11, 0.07)
	const H = P.height
	return { spool: [sx, H], rotor: [rx, H], nacelle: [s * 0.02, H], spool_z: sz, side: s }
}

function _turbine() {
	function build(c, P) {
		const s = _side(P)
		const H = P.height
		const B = Math.trunc(P.blades)
		const L = P.blade_length
		const w = P.blade_width
		const kind = truthy(c.item.fixed) ? "static" : "dynamic"
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		const alu = _has("aluminium") ? c.mat({ base: "aluminium", overrides: {} }) : c.mat({ base: "steel", overrides: {} })
		const plastic = c.mat({ base: "turbine plastic", overrides: {} })
		const base = c.slab("base", 0.16, 0.02, 0.16, 0.0, 0.01, { kind: "static", material: wood, look: "wood", words: "the turbine's base" })
		const brass = _has("brass") ? c.mat({ base: "brass", overrides: {} }) : c.mat({ base: "steel", overrides: {} })
		const posts = []
		for (const [, sx_] of [["+", 1], ["-", -1]]) {
			posts.push(c.slab(sx_ > 0 ? "post_plus" : "post_minus", 0.008, 0.01, 0.008, sx_ * 0.06, 0.025, { kind: "static", material: brass, look: _has("brass") ? "brass" : "steel", words: "a brass terminal" }))
		}
		const tower = c.slab("tower", 0.02, H - 0.0425, 0.02, 0.0, 0.02 + (H - 0.0425) / 2, { kind: "static", material: alu, look: _has("aluminium") ? "aluminium" : "steel", words: "the turbine's tower" })
		const geo = turbine_geometry(P)
		const [sx, sy] = geo.spool
		const [rx, ry] = geo.rotor
		const [nx, ny] = geo.nacelle
		const nacelle = c.slab("nacelle", 0.12, 0.045, 0.045, nx, ny, { kind: "static", material: plastic, look: "turbine plastic", words: "the turbine's nacelle" })
		const R = TURBINE_HUB + L
		const sheet = BLADE_SHEETS[P.blade_material]
		let [J, m] = _rotor_inertia(B, TURBINE_HUB, R, w, w, sheet, DOWEL)
		J += (0.03 * 0.025 * 0.025) / 2 + (0.005 * 0.003 * 0.003) / 2
		m += 0.035
		const gen = Object.prototype.hasOwnProperty.call(GENERATORS, P.generator) ? GENERATORS[P.generator] : null
		if (gen !== null) J += gen.J
		const hub = _stand_in(c, sx, sy, J, kind)
		const load = P.load_g
		const g = c.settings.gravity
		const fric = SHAFT_MU * SHAFT_R * (m + load / 1000) * g + (gen !== null ? gen.fric : 0.0)
		_bearing(c, sx, sy, fric, load > 0 ? _winding(sy - CUP_H, P.axle_mm / 2000) : null)
		const pitch = P.pitch * D2R
		c.process("energy", "rotor", {
			role: "rotor", solid: hub, at: _world(c, rx, ry), axis: _axis(c, s), yaw: _r(P.yaw * D2R, 6),
			rotor: { blades: B, r0: TURBINE_HUB, R: _r(R), chord: [_r(w), _r(w)], pitch: [_r(pitch, 6), _r(pitch, 6)], ar: _r(L / w, 4), cd0: CD0, stations: 8 }
		})
		if (gen !== null) {
			const st = _circuit(c.sb)
			const iid = c.item.id
			for (const [name, post] of [["+", posts[0]], ["-", posts[1]]]) st.terminals[`${iid}/${name}`] = { solid: post, at: { x: 0.0, y: 0.005 } }
			st.parts.push({ kind: "generator", id: `${iid}/generator`, item: iid, name: truthy(c.item.name) ? c.item.name : TYPES[c.item.type].name, a: `${iid}/+`, b: `${iid}/-`, role: "generator", k: gen.k, r: gen.r, rotor: hub })
		}
		if (load > 0) _cup(c, sx, sy, P.axle_mm / 2000, 1.0, load, hub, [base, tower, nacelle, ...posts], geo.spool_z)
		P.rotor_g = _r(m * 1000, 1)
		P.diameter = _r(2 * R, 4)
		P.pennies = load > 0 ? Math.max(0, Math.trunc((load - CUP_G) / PENNY_G)) : 0
	}
	register(new ItemType("wind-turbine", "Model wind turbine", CAT, build, {
		dynamic: false, module: MODULE,
		props: [
			new Prop("blades", "Blades", 3, 2, 12, 1, "", "On a crimping hub (12 holes)", { kind: "int" }),
			new Prop("blade_length", "Blade length", 0.15, 0.05, 0.3, 0.005, "m"),
			new Prop("blade_width", "Blade width", 0.06, 0.02, 0.12, 0.005, "m"),
			new Prop("pitch", "Blade pitch", 20.0, 0.0, 60.0, 1.0, "°", "How far each blade is turned from the rotor's face: 10-30° turns best; 0 and 90 do not turn it"),
			new Prop("blade_material", "Blades made of", "corrugated plastic", { kind: "choice", choices: Object.keys(BLADE_SHEETS) }),
			new Prop("height", "Hub height", 0.45, 0.2, 1.2, 0.01, "m", "Its shaft's height above the base's bottom"),
			new Prop("facing", "Wind from", "left", { kind: "choice", choices: ["left", "right"], help: "The side its rotor faces: the wind must blow from there" }),
			new Prop("yaw", "Turned toward you", 0.0, 0.0, 60.0, 1.0, "°", "0: square into the wind (the most power); more shows its face but catches less wind"),
			new Prop("generator", "In its nacelle", "KidWind generator", { kind: "choice", choices: [...Object.keys(GENERATORS), "none"], help: "The generator its shaft turns (its leads are the base's + and − terminals): the KidWind generator gives about 2 V at 700 rpm, a hobby motor a tenth of that" }),
			new Prop("load_g", "Load on its spool", 0.0, 0.0, 2000.0, 1.0, "g", "A cup of pennies on a thread wound on a spool on its shaft (a weightlifter); 0: none", { slider_max: 500.0 }),
			new Prop("axle_mm", "Spool across", 6.0, 2.0, 40.0, 0.5, "mm")
		],
		readouts: [
			new Readout("rpm", "Turning", { unit: "rpm", digits: 0 }), new Readout("wind_ms", "Wind on it", { unit: "m/s", digits: 2 }), new Readout("tsr", "Tip speed ÷ wind", { unit: "", digits: 2 }),
			new Readout("power_mw", "Power from the wind", { unit: "mW", digits: 1 }), new Readout("cp", "Share of the wind's power", { unit: "", digits: 3 }),
			new Readout("generator_voltage", "Generator voltage", { unit: "V", digits: 2 }), new Readout("generator_current", "Generator current", { unit: "A", digits: 4 }),
			new Readout("lift_m", "Load lifted", { unit: "m", digits: 3 })
		],
		tags: ["wind turbine", "turbine", "wind power", "generator", "kidwind", "blades", "renewable", "electricity", "wind energy", "led"],
		description: "A classroom wind turbine: blades on a hub, a nacelle with a small generator on an aluminium tower, its leads on the base's + and − terminals. In front of a fan (or in a breeze) it turns, and its generator can light an LED wired to it; a spool on its shaft can lift a cup of pennies.",
		source: "Blade-element momentum theory with flat blades (Hansen, Aerodynamics of Wind Turbines, 2015); the KidWind generator's 2.1 V at 720 rpm and 38 Ω inside (Vernier's generator data).",
		anchor: "the middle of its base's bottom", facts: "3 blades × 15 cm at 20° · KidWind generator · about 2 V in a 5 m/s fan"
	}))
}

function _circuit(sb) {
	if (!sb.circuit) sb.circuit = { parts: [], terminals: {}, wires: [], boards: [] }
	return sb.circuit
}

// ---------------------------------------------------------------- a small generator on another item's turning shaft
export function shaft_place(item) {
	const t = item.type
	if (!SHAFT_TYPES.includes(t) || !Object.prototype.hasOwnProperty.call(TYPES, t)) return null
	const P = props_of(item)
	let lx = 0.0
	let ly = 0.0
	if (t === "pinwheel") [lx, ly] = pinwheel_geometry(P).spool
	else if (t === "wind-turbine") [lx, ly] = turbine_geometry(P).spool
	const a = (item.angle ?? 0.0) * D2R
	const ca = cos(a)
	const sa = sin(a)
	const x0 = item.x ?? 0.0
	const y0 = item.y ?? 0.0
	const part = t === "wheel-and-axle" ? "wheel" : "hub"
	return [part, [x0 + lx * ca - ly * sa, y0 + lx * sa + ly * ca]]
}

function _generator() {
	function build(c, P) {
		const gen = GENERATORS[P.kind]
		const [L, D] = gen.can
		const plastic = _has("circuit plastic") ? c.mat({ base: "circuit plastic", overrides: {} }) : c.mat({ base: "turbine plastic", overrides: {} })
		const base = c.slab("base", 0.07, 0.012, 0.05, 0.0, 0.006, { kind: "static", material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood", words: "the generator's base board", ghost: true })
		c.slab("can", L, D, D, 0.0, 0.012 + D / 2, { kind: "static", material: plastic, look: "steel", words: "a small generator", ghost: true })
		const st = _circuit(c.sb)
		const iid = c.item.id
		for (const [name, sx] of [["+", 1], ["-", -1]]) st.terminals[`${iid}/${name}`] = { solid: base, at: { x: _r(sx * 0.026), y: 0.006 } }
		const part = { kind: "generator", id: `${iid}/generator`, item: iid, name: truthy(c.item.name) ? c.item.name : TYPES[c.item.type].name, a: `${iid}/+`, b: `${iid}/-`, k: gen.k, r: gen.r }
		const shaft = c.link("shaft")
		const place = shaft !== null ? shaft_place(c.sb.scene_items.get(shaft)) : null
		const ratio = P.ratio
		if (place === null) {
			Object.assign(part, { speed: 0.0, from: 0.0 })
			P.coupled = "none"
		} else {
			const sid = `${shaft}/${place[0]}`
			const [wx, wy] = place[1]
			const Jr = gen.J * ratio * ratio
			const rr = _r(Math.max(0.01, Math.sqrt((2 * Jr) / 0.02)))
			const dens = (2 * Jr) / (rr * rr) / ((4 / 3) * Math.PI * rr * rr * rr)
			c.sb.solids.push({
				kind: "dynamic", id: `${iid}/rotor`, words: "the generator's rotor", body: { kind: "ball", radius: rr, inertia: 0.5 },
				material: c.mat({ base: "turbine plastic", density: Number(fmtG(dens, 6)), overrides: {} }), at: { x: 0.0, y: 0.0 },
				item: iid, look: "turbine plastic", parent: sid, ghost: true, hidden_3d: true,
				placeholder: { fill: "#888" }, render: { kind: "procedural", shade: "#555" }, depth: 4
			})
			c.sb.joints.push({ kind: "pin", id: `${iid}/drag`, item: iid, a: null, b: `${iid}/rotor`, anchorA: { x: _r(wx), y: _r(wy) }, anchorB: { x: 0.0, y: 0.0 }, friction: _r(gen.fric * ratio, 7), render: { hinge: "none" } })
			Object.assign(part, { rotor: `${iid}/rotor`, ratio, sense: P.leads === "swapped" ? -1 : 1 })
			P.coupled = sid
			const shaftItem = c.sb.scene_items.get(shaft)
			P.belt_z = shaftItem.type === "waterwheel" ? _r(props_of(shaftItem).paddle_depth / 2 + 0.045, 4) : 0.05
		}
		st.parts.push(part)
	}
	register(new ItemType("generator", "Small generator", CAT, build, {
		dynamic: false, module: MODULE,
		props: [
			new Prop("kind", "Generator", "KidWind generator", { kind: "choice", choices: Object.keys(GENERATORS), help: "KidWind generator: about 2.1 V at 720 rpm, 38 Ω inside; hobby motor (FA-130) used as a generator: about a tenth of that" }),
			new Prop("ratio", "Step-up", 1.0, 1.0, 20.0, 0.5, "×", "How many turns it makes for each turn of the shaft (a belt from a big pulley on the shaft to its small one); 1: on the shaft itself"),
			new Prop("leads", "Leads", "normal", { kind: "choice", choices: ["normal", "swapped"], help: "normal: + is positive while its shaft turns counter-clockwise (as you look at it); swapped: while it turns clockwise" })
		],
		links: [new Link("shaft", "On the shaft of", { types: [...SHAFT_TYPES], help: "The turning shaft that drives it: a waterwheel, a windmill, a wind turbine, a wheel and axle" })],
		readouts: [new Readout("rpm", "Turning", { unit: "rpm", digits: 0 }), new Readout("voltage", "Voltage", { unit: "V", digits: 2 }), new Readout("current", "Current out of +", { unit: "A", digits: 4 })],
		tags: ["generator", "dynamo", "motor as generator", "kidwind", "electricity", "waterwheel generator", "hydro", "energy", "volts", "led"],
		description: "A small DC generator (the KidWind turbine generator, or a hobby motor) on a little base with + and − terminals. Link it to a turning shaft (a waterwheel, a windmill, a wheel and axle): its voltage grows with how fast it turns, and the current it gives holds the shaft back.",
		source: "A DC generator: EMF = k·ω, and the current I it drives makes a torque k·I against its turning (Faraday's and Lenz's laws); the KidWind generator's 2.13 V at 720 rpm and 38 Ω inside (Vernier's generator data).",
		anchor: "the middle of its base's bottom", facts: "KidWind generator · 2.1 V at 720 rpm"
	}))
}

// ---------------------------------------------------------------- the waterwheel's spool (a build hook: the flow module's type, these common props)
function _wheel_spools(sb, scene) {
	for (const item of scene.items ?? []) {
		if (item === null || typeof item !== "object" || Array.isArray(item) || item.type !== "waterwheel" || !Object.prototype.hasOwnProperty.call(TYPES, "waterwheel")) continue
		const own = item.props ?? {}
		let load = own.load_g
		if (typeof load !== "number" || !(load > 0)) continue
		load = Math.min(2000.0, load)
		const P = props_of(item)
		let mm = Object.prototype.hasOwnProperty.call(own, "axle_mm") ? own.axle_mm : 12.0
		mm = typeof mm !== "number" ? 12.0 : Math.min(40.0, Math.max(2.0, mm))
		const iid = item.id
		const hub = `${iid}/hub`
		if (!sb.solids.some((s) => s.id === hub)) continue
		const c = new Ctx(sb, item, P)
		const winds = Object.prototype.hasOwnProperty.call(own, "winds") ? own.winds : "auto"
		let sense
		if (winds === "clockwise") sense = -1.0
		else if (winds === "counter-clockwise") sense = 1.0
		else {
			const x0 = item.x ?? 0.0
			const y0 = item.y ?? 0.0
			let best = null
			sense = 1.0
			for (const o of scene.items ?? []) {
				if (o === null || typeof o !== "object" || !POURERS.includes(o.type)) continue
				const dx = (o.x ?? 0.0) - x0
				if ((o.y ?? 0.0) > y0 && Math.abs(dx) <= P.diameter && (best === null || Math.abs(dx) < best)) {
					best = Math.abs(dx)
					sense = dx > 0 ? -1.0 : 1.0
				}
			}
		}
		const r = mm / 2000
		const kind = truthy(item.fixed) ? "static" : "dynamic"
		const spool = c.ball("spool", _r(r), 0.0, 0.0, {
			material: c.mat({ base: "varnished hardwood", density: _r(0.003 / ((4 / 3) * Math.PI * r * r * r), 3), overrides: {} }),
			kind, look: "wood", words: "a spool on the waterwheel's axle", parent: hub, ghost: true, shape: "cylinder", length: 0.02
		})
		sb.solids[sb.solids.length - 1].at = { x: 0.0, y: 0.0 }
		const others = sb.solids.filter((s) => s.item === iid && s.id !== spool).map((s) => s.id)
		const kg = load / 1000
		const dx = sense * r
		const dy = -(P.diameter / 2 + 0.03 + CUP_H / 2)
		const lx = dx * c.ca + dy * c.sa
		const ly = -dx * c.sa + dy * c.ca
		const mat = c.mat({ base: "cardboard", density: _r(kg / (CUP_W * CUP_H * CUP_D), 3), overrides: {} })
		const cup = c.slab("load", CUP_W, CUP_H, CUP_D, lx, ly, -(item.angle ?? 0.0), { material: mat, kind: "dynamic", look: "cardboard", words: `a paper cup of pennies (${_trim(load)} g)` })
		c.process("mechanics", "thread", { role: "spool", drum: spool, b: cup, center: { x: 0.0, y: 0.0 }, radius: _r(r, 6), sense: Math.trunc(sense), anchorB: { x: 0.0, y: _r(CUP_H / 2) }, minLength: SPOOL_GAP, z: _r(P.paddle_depth / 2 + 0.02, 4) })
		const wound = _r(_winding(-dy - CUP_H / 2, r), 4)
		sb.joints.push({
			kind: "pin", id: `${iid}/spool-stop`, item: iid, a: null, b: spool, anchorA: { x: _r(item.x ?? 0.0), y: _r(item.y ?? 0.0) }, anchorB: { x: 0.0, y: 0.0 },
			limits: sense > 0 ? { lower: -10000.0, upper: wound } : { lower: -wound, upper: 10000.0 }, render: { hinge: "none" }
		})
		c.process("mechanics", "thread-pull", { role: "meter", reads: "rope", a: spool, b: cup, key: "pull_n" })
		c.process("mechanics", "lift", { role: "meter", reads: "rise", solid: cup, key: "lift_m" })
		c.process("energy", "load-pass", { role: "pass", solid: cup, through: others })
	}
}

// ---------------------------------------------------------------- goal kinds (machines/mod_energy.py has the same, number for number)
const END_S = 0.5

function _end_values(ctx, iid, key) {
	const v = ctx.state(iid, key)
	if (v === null || !ctx.times.length) return null
	const t_end = ctx.times[ctx.times.length - 1]
	const out = []
	const n = Math.min(v.length, ctx.times.length)
	for (let k = 0; k < n; k++) if (ctx.times[k] >= t_end - END_S && v[k] !== null && v[k] !== undefined) out.push(v[k])
	return out.length ? out : null
}

const _itemOf = (ctx, iid) => (ctx.items.has(iid) ? ctx.items.get(iid) : {})

function _volts_of(ctx, iid) {
	const key = _itemOf(ctx, iid).type === "wind-turbine" ? "generator_voltage" : "voltage"
	return [_end_values(ctx, iid, key), key]
}

function _power_of(ctx, iid) {
	const pre = _itemOf(ctx, iid).type === "wind-turbine" ? "generator_" : ""
	const v = _end_values(ctx, iid, `${pre}voltage`)
	const i = _end_values(ctx, iid, `${pre}current`)
	if (!v || !i) return null
	const n = Math.min(v.length, i.length)
	const out = []
	for (let k = 0; k < n; k++) out.push(v[k] * i[k] * 1000)
	return out
}

// (every number a goal reports is + 0: no -0 (a backward generator's 0 mA times its negative volts), which Python's sum() never gives)
export function goal_generates(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let least = ctx.num(g.at_least_v)
	const mw = ctx.num(g.at_least_mw)
	least = least === null && mw === null ? 1.0 : least
	const [v] = _volts_of(ctx, iid)
	const p = _power_of(ctx, iid)
	let ok = v !== null
	if (ok && least !== null) ok = Math.min(...v.map((x) => Math.abs(x))) >= least
	if (ok && mw !== null) ok = p !== null && Math.min(...p) >= mw
	const what = []
	if (least !== null) what.push(`at least ${_trim(least)} V`)
	if (mw !== null) what.push(`${_trim(mw)} mW`)
	return {
		label: truthy(g.label) ? g.label : `${ctx.name(iid)} makes ${what.join(" and ")}`, ok, kind: "generates", item: iid,
		volts: v === null ? null : pyRound(v[v.length - 1], 4) + 0, mw: p === null ? null : pyRound(p[p.length - 1], 3) + 0
	}
}

export function goal_generates_more(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const pa = _power_of(ctx, g.a)
	const pb = _power_of(ctx, g.b)
	const ma = pa ? F.py.pySum(pa) / pa.length : null
	const mb = pb ? F.py.pySum(pb) / pb.length : null
	const ok = ma !== null && mb !== null && ma >= mb * 1.1 && ma >= mb + 0.1
	return {
		label: truthy(g.label) ? g.label : `${ctx.name(g.a)} makes more power than ${ctx.name(g.b)}`, ok, kind: "generates_more", a: g.a, b: g.b,
		mw_a: ma === null ? null : pyRound(ma, 3) + 0, mw_b: mb === null ? null : pyRound(mb, 3) + 0
	}
}

function _rise(ctx, iid) {
	const sid = `${iid}/load`
	if (!ctx.doc.solids.some((s) => s.id === sid)) return null
	const p0 = ctx.frames[0].placements[sid]
	const p1 = ctx.frames[ctx.frames.length - 1].placements[sid] ?? p0
	return p0 === undefined || p1 === undefined ? null : p1.y - p0.y
}

export function goal_lifts_higher(ctx, g) {
	if (!(ctx.known(g.a) && ctx.known(g.b))) return null
	const ra = _rise(ctx, g.a)
	const rb = _rise(ctx, g.b)
	const ok = ra !== null && rb !== null && ra >= rb + 0.02 && ra >= rb * 1.1
	return {
		label: truthy(g.label) ? g.label : `${ctx.name(g.a)} lifts its load higher than ${ctx.name(g.b)}`, ok, kind: "lifts_higher", a: g.a, b: g.b,
		rise_a: ra === null ? null : pyRound(ra, 4) + 0, rise_b: rb === null ? null : pyRound(rb, 4) + 0
	}
}

// ---------------------------------------------------------------- the AI's view of the module (web/sim/plugins.js)
const endOf = (run, iid, key) => {
	const v = run?.track?.state?.[iid]?.[key]
	return Array.isArray(v) && v.length ? v[v.length - 1] : null
}
const maxOf = (run, iid, key) => {
	const v = run?.track?.state?.[iid]?.[key]
	return Array.isArray(v) && v.length ? v.reduce((m, x) => (x > m ? x : m), v[0]) : null
}
/** The mean of a reading over the run's last 0.5 s (its steady value), or null. */
const tailOf = (run, iid, key) => {
	const v = run?.track?.state?.[iid]?.[key]
	const f = run?.track?.frames
	if (!Array.isArray(v) || !Array.isArray(f) || !f.length) return null
	const t1 = f[f.length - 1].t
	let s = 0
	let n = 0
	for (let k = 0; k < Math.min(v.length, f.length); k++) if (f[k].t >= t1 - 0.5 && Number.isFinite(v[k])) (s += v[k]), n++
	return n ? s / n : null
}
const firstWhen = (run, iid, key, test) => {
	const v = run?.track?.state?.[iid]?.[key]
	const f = run?.track?.frames
	if (!Array.isArray(v) || !Array.isArray(f)) return null
	for (let k = 0; k < Math.min(v.length, f.length); k++) if (test(v[k])) return f[k].t
	return null
}
const n0 = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "?")
const n2 = (v) => (Number.isFinite(v) ? Number(v.toPrecision(3)).toString() : "?")
const ROTORS = ["pinwheel", "wind-turbine"]
const pickOf = (scene, types) => (scene?.items ?? []).filter((i) => types.includes(i?.type))
/** The KidWind generator's EMF per rpm (V): what a turning speed gives on open circuit. */
const KIDWIND_V_PER_RPM = 5.9 / 2000

export const plugin = {
	// (the words a teacher uses: windmill, pinwheel, wind turbine, generator, dynamo, renewable, waterwheel lifts, battery car, energy transfer)
	title: "Energy devices: paper windmills (pinwheels) and model wind turbines in a fan's wind, generators lighting LEDs, windmills and waterwheels winding up loads, battery cars",
	howto: [
		"Devices that turn one form of energy into another (4-PS3-4). pinwheel (a paper windmill: its sails on a straw axle through a wooden post; anchor: the middle of its foot's bottom: place {on: \"table\", x}) and wind-turbine (a classroom model turbine: a round wooden base with + and − terminals, an aluminium tower, a nacelle holding a KidWind generator, a crimping hub of `blades` flat blades `blade_length` × `blade_width` at `pitch`; anchor: the middle of its base's bottom: place {on: \"table\", x}). Their rotors FACE THE WIND along the table: `facing` left means the wind must come from the left (a fan on its left blowing right; a breeze \"to the right\"). Their shaft is `height` above the table (pinwheel 0.3 m, turbine 0.45 m): give it the fan's middle height. A fan standing on the table (place {on: \"table\", x}) has its middle diameter/2 + 6.5 cm up (a 40 cm fan: 0.265 m, a 50 cm fan: 0.315 m) and blows a round jet 0.9 × its diameter across, full speed for about 6 diameters: put the rotor 30-60 cm from the fan's face, its sails or blades inside the jet (the outer parts of a rotor wider than the jet get little wind; a breeze item gives the whole table the same wind). `yaw` 20-35° turns the rotor's face toward the viewer (much clearer in the picture) at a cost: it takes the wind's share along its shaft (cos of the angle), about cos² less torque.",
		"Numbers (blade-element momentum with flat blades; the KidWind generator's measured 2.13 V at 720 rpm and 38 Ω): a 20 cm paper windmill turns about 1200 rpm free in a 4 m/s wind and 1500 in 5 m/s (its sail tips about 3 times the wind's speed); a model turbine (3 blades × 15 cm at 20°) in a 5 m/s breeze about 900 rpm free, about 700 rpm in front of a 50 cm fan at 5 m/s, giving 1.9 V: a red LED needs about 1.8 V (650-700 rpm) and lights dimly there, brightly with a 6 m/s fan; pitch 10-30° turns best (45° turns slowly, 0° not at all); more blades give more torque at low speed. Wire a turbine's generator like a battery: its + (right terminal) to the LED's + and the LED's − back to its − (current goes out of +). A paper windmill's sails are too weak to turn a generator fast enough to light an LED (its point: a turbine needs a strong rotor).",
		"Lifting a load (the windmill-winch challenge): `load_g` on a pinwheel or turbine is a paper cup of pennies (3 g + 2.5 g a penny) on a thread wound on its straw or shaft (`axle_mm` across: a skewer 3 mm, a straw 6 mm, a cotton reel 25 mm): the cup starts on the table under the axle's downwind end and is wound up until 2.2 cm under it, where it holds the rotor still (a turbine that must light an LED takes no load_g); the rotor stops when the cup's torque, load × g × axle radius, passes what its sails give at a standstill (a 20 cm windmill in a 4 m/s breeze lifts at most about 50 g on a 6 mm straw: twice as much on a 3 mm skewer, at half the speed). A waterwheel (flow module) takes `load_g` too: a cup hung under it from a spool on its axle (`axle_mm` 12; `winds` auto: the way the stream turns it); a 140 mL/s tap lifts up to about 350 g on the 12 mm spool (about twice that on a 6 mm one, more slowly); a heavier cup, hanging under the wheel from the start, pulls it backward and falls. Goals: rises {item} (mechanics: its cup ends 5 cm higher), lifts_higher {a, b}. Readings lift_m (how far the cup rose), pull_n (the thread's pull).",
		"generator (a small DC generator on a little base with + and − terminals; it touches nothing: place {on: \"table\", x} beside the machine): link `shaft` to a waterwheel, paper windmill, wind turbine or wheel-and-axle; `ratio` steps it up through a belt (a waterwheel under a 140 mL/s tap turns about 140 rpm: ratio 5 brings the generator to about 700 rpm, enough for an LED); `kind` KidWind generator (2.1 V at 720 rpm, 38 Ω) or hobby motor (a tenth of that). Its + is positive while the shaft turns COUNTER-clockwise as seen: a waterwheel with its stream on the RIGHT turns clockwise, so set leads \"swapped\" (or wire the LED the other way round). Readings rpm, voltage, current.",
		"Battery car (circuits module): a cart, toy-car or truck on the table; a battery on it (place {on: <the car>}); a motor {kind: \"geared\", drives: \"wheels\", car: <the car's id>} (it rides on the car over its rear axle: where the motor item itself is placed does not matter); wires battery + → motor + and motor − → battery − (that way round it drives forward, to the right; swapped, backward). Two AA cells and the geared (48:1 \"TT\") motor drive a cart at about 0.3 m/s (its wheels spin a little at the start); a hobby motor without gears accelerates slowly to far higher speeds. Goal: moves {item: <the car>, min_m}; the motor's rpm, current and voltage are readings.",
		"Goals of this module: generates {item, at_least_v?, at_least_mw?} (a turbine's or a small generator's voltage over the run's last 0.5 s; default at least 1 V), generates_more {a, b} (generator a's electrical power more than b's: a fair test of blades), lifts_higher {a, b}. Also: lights {item: an LED or bulb} (circuits), spins / turns {item, at_least_rpm} on a windmill, turbine or generator (it reads rpm), rises {item} (mechanics). Let the rotor spin up: seconds 5-8 for a turbine (it takes 2-4 s to reach its speed)."
	].join(" "),
	prompt: {
		plan: [
			"Energy devices: a paper windmill (pinwheel) or model wind turbine FACES THE WIND: `facing` left needs the fan (or a breeze) on its left blowing right; set its `height` to the fan's middle (a 40 cm fan standing on the table: 0.265 m) and put it 30-60 cm from the fan's face; `yaw` 25-30 shows the rotor's face in the picture (a little less power). A turbine lights an LED through its own generator: wire its + to the LED's + and the LED's − to its −, a fan of 5-6 m/s, seconds 6-8. To lift a load give the windmill or turbine `load_g` (a cup of pennies under its axle), or a waterwheel `load_g` under a tap. A generator item links `shaft` to a waterwheel or windmill (a waterwheel needs ratio 5 and, with the stream on its right, leads \"swapped\"). A battery car: a cart, a battery placed on it, a motor {kind geared, drives wheels, car: the cart's id}, two wires (battery + → motor +, motor − → battery −). A RACE of battery cars: each car in a lane of its own, one above the other (the picture is a side view: two cars \"next to\" each other on one table are one behind the other in one lane): the measuring module's lanes, lane 1 on the table (y 0.02) and lane 2 on air at y_m 0.82, each at x -0.15, 2.9 m long with margin 0.3 (its floor from -0.45 to 3.05 m: inside the table's end walls) and end_stop on (its foam bumper stops a car without throwing its battery off), each car with its front at its lane's 0 m mark and its own battery and motor on it. On 2 AA the geared motor drives at about 0.2 m/s and a hobby motor without gears speeds up to about 1.3 m/s 3 s after it starts (2.9 m in about 3.7 s); a car that drives into the table's end wall throws its battery off and pulls its leads off. Goals: faster {a: the faster car, b: the other} and moves {item, min_m} for each car.",
			"Energy goals: generates {item, at_least_v?, at_least_mw?}, generates_more {a, b} (a fair test: two turbines the same but for one thing, each with the same load: a resistor or an LED), lifts_higher {a, b}; with lights {item: led}, rises {item}, spins {item, at_least_rpm}, moves {item: car, min_m}."
		].join("\n"),
		edit: "Energy devices: a rotor faces the wind (`facing`); its `pitch` (10-30° best), `blades`, `blade_length`, `yaw` (turned away from the wind it catches less) and the wind's speed decide how fast it turns; the generator's voltage grows with its rpm (KidWind: 2.1 V at 720 rpm); a windmill's cup (`load_g`) is lifted only while the sails' torque beats load × g × axle radius (`axle_mm`: thinner lifts heavier, slower); a generator's `ratio` steps up a slow shaft; its `leads` decide its + (swap them when the LED stays dark on a clockwise shaft); a battery car's motor (drives wheels) runs off its car's battery. \"Add a second car so the two race\": the new car in a lane of its own, above the first (never ahead of it or behind it on the one table: one lane): the measuring module's lanes, the first car's on the table (y 0.02) and the new car's on air at y_m 0.82, each at x -0.15, 2.9 m long with margin 0.3 (inside the table's end walls) and end_stop on, both fronts at their 0 m marks (the first car moved onto its lane), the new car's own battery and motor wired the same way; a hobby motor's car speeds up to about 1.3 m/s 3 s after it starts on 2 AA (the geared one 0.2 m/s): driven into the table's end wall its battery flies off and its leads pull off, so its lane's bumper must stop it; set_goals with the scene's goals plus faster {a: the faster car, b: the other} and moves {item: the new car, min_m}.",
		refine: "Energy devices: a rotor that does not turn has its wind on the wrong side (`facing`), no wind at its height, too much yaw or pitch, or a load too heavy for it; an LED on a generator that stays dark: too slow (under about 650 rpm: a stronger fan, a better pitch, a step-up ratio), wired the wrong way round (leads), or its + not to the LED's +; a battery car that does not move: the motor's `car` link, the wires' ends, or the battery not on the car."
	},
	examples: [
		{
			ask: "A paper windmill lifts a cup of pennies in a fan's wind.",
			how: "a fan {speed 5, diameter 0.4} standing on the table, a pinwheel {height 0.27 (the fan's middle), facing left, yaw 30, load_g 13 (a cup of 4 pennies)} 45 cm to its right; the cup is wound up on the straw; goal rises {item: windmill}",
			plan: { seconds: 5, items: [{ id: "fan", type: "fan", props: { speed: 5, diameter: 0.4 }, place: { on: "table", x: 0.55 } }, { id: "windmill", type: "pinwheel", props: { height: 0.27, facing: "left", yaw: 30, load_g: 13 }, place: { on: "table", x: 1.0 } }], goals: [{ kind: "rises", item: "windmill" }] }
		},
		{
			ask: "A wind turbine in front of a fan lights an LED.",
			how: "a fan {speed 6, diameter 0.4} standing on the table; a wind-turbine {height 0.27, facing left, yaw 25} 45 cm to its right; an LED on the table to its right, wired turbine + → LED +, LED − → turbine −; seconds 7 (the rotor spins up for 2-4 s); goal lights {item: led}",
			plan: {
				seconds: 7,
				items: [
					{ id: "fan", type: "fan", props: { speed: 6, diameter: 0.4 }, place: { on: "table", x: 0.55 } },
					{ id: "turbine", type: "wind-turbine", props: { height: 0.27, facing: "left", yaw: 25 }, place: { on: "table", x: 1.0 } },
					{ id: "led", type: "led", props: { color: "red" }, place: { on: "table", x: 1.4 } },
					{ id: "w1", type: "wire", props: { a: "turbine", a_end: "+", b: "led", b_end: "+" }, place: { on: "air", x: 0, y_m: 0 } },
					{ id: "w2", type: "wire", props: { a: "led", a_end: "-", b: "turbine", b_end: "-" }, place: { on: "air", x: 0, y_m: 0 } }
				],
				goals: [{ kind: "lights", item: "led" }]
			}
		},
		{
			ask: "Fair test: do blades at 20° or at 45° make more electricity?",
			how: "a breeze {speed 5} at the table's left end; two wind-turbines the same but for pitch (20 and 45), far apart, each with a 50 Ω resistor wired across its terminals; seconds 8; goal generates_more {a: the 20° turbine, b: the 45° one}",
			plan: {
				seconds: 8,
				items: [
					{ id: "wind", type: "breeze", props: { speed: 5 }, place: { on: "table", x: -0.45 } },
					{ id: "t20", type: "wind-turbine", name: "Turbine with 20° blades", props: { pitch: 20 }, place: { on: "table", x: 0.5 } },
					{ id: "r20", type: "resistor", props: { ohms: 50 }, place: { on: "table", x: 0.85 } },
					{ id: "a1", type: "wire", props: { a: "t20", a_end: "+", b: "r20", b_end: "+" }, place: { on: "air", x: 0, y_m: 0 } },
					{ id: "a2", type: "wire", props: { a: "r20", a_end: "-", b: "t20", b_end: "-" }, place: { on: "air", x: 0, y_m: 0 } },
					{ id: "t45", type: "wind-turbine", name: "Turbine with 45° blades", props: { pitch: 45 }, place: { on: "table", x: 1.7 } },
					{ id: "r45", type: "resistor", props: { ohms: 50 }, place: { on: "table", x: 2.05 } },
					{ id: "b1", type: "wire", props: { a: "t45", a_end: "+", b: "r45", b_end: "+" }, place: { on: "air", x: 0, y_m: 0 } },
					{ id: "b2", type: "wire", props: { a: "r45", a_end: "-", b: "t45", b_end: "-" }, place: { on: "air", x: 0, y_m: 0 } }
				],
				goals: [{ kind: "generates_more", a: "t20", b: "t45" }]
			}
		},
		{
			ask: "A waterwheel lifts a cup of pennies.",
			how: "a waterwheel {load_g 50} with its axle in the air 45 cm up, a tap {flow_ml_s 140} over the right side of its paddles (x offset 0.35 × its diameter), a bucket under it; the stream turns it clockwise and its spool winds the cup up; goal rises {item: wheel}",
			plan: {
				seconds: 5,
				items: [
					{ id: "wheel", type: "waterwheel", props: { load_g: 50 }, place: { on: "air", x: 1.2, y_m: 0.45 } },
					{ id: "tap", type: "tap", props: { flow_ml_s: 140, on_at: 0.2 }, place: { on: "air", x: 1.284, y_m: 0.75 } },
					{ id: "tub", type: "bucket", place: { on: "table", x: 1.25 } }
				],
				goals: [{ kind: "rises", item: "wheel" }]
			}
		},
		{
			ask: "A waterwheel turns a generator that lights an LED.",
			how: "a waterwheel (axle 45 cm up) under a tap {flow_ml_s 140} on its right, a bucket below; a generator {shaft: wheel, ratio 5, leads swapped (the wheel turns clockwise)} on the table to its left, an LED beyond it, wired generator + → LED +, LED − → generator −; goal lights {item: led}",
			plan: {
				seconds: 5,
				items: [
					{ id: "wheel", type: "waterwheel", place: { on: "air", x: 1.2, y_m: 0.45 } },
					{ id: "tap", type: "tap", props: { flow_ml_s: 140, on_at: 0.2 }, place: { on: "air", x: 1.284, y_m: 0.75 } },
					{ id: "tub", type: "bucket", place: { on: "table", x: 1.25 } },
					{ id: "gen", type: "generator", props: { shaft: "wheel", ratio: 5, leads: "swapped" }, place: { on: "table", x: 0.8 } },
					{ id: "led", type: "led", place: { on: "table", x: 0.55 } },
					{ id: "w1", type: "wire", props: { a: "gen", a_end: "+", b: "led", b_end: "+" }, place: { on: "air", x: 0, y_m: 0 } },
					{ id: "w2", type: "wire", props: { a: "led", a_end: "-", b: "gen", b_end: "-" }, place: { on: "air", x: 0, y_m: 0 } }
				],
				goals: [{ kind: "lights", item: "led" }]
			}
		},
		{
			ask: "Build a battery car that drives across the table.",
			how: "a cart on the table, a battery (2 AA) placed on the cart, a motor {kind geared, drives wheels, car: cart} (it rides over the cart's rear axle), wires battery + → motor +, motor − → battery −; it drives right at about 0.3 m/s; goal moves {item: cart, min_m 0.3}",
			plan: {
				seconds: 4,
				items: [
					{ id: "cart", type: "cart", place: { on: "table", x: 0.4 } },
					{ id: "battery", type: "battery", props: { kind: "AA", cells: 2 }, place: { on: "cart" } },
					{ id: "motor", type: "motor", props: { kind: "geared", drives: "wheels", car: "cart" }, place: { on: "table", x: 0.1 } },
					{ id: "w1", type: "wire", props: { a: "battery", a_end: "+", b: "motor", b_end: "+" }, place: { on: "air", x: 0, y_m: 0 } },
					{ id: "w2", type: "wire", props: { a: "motor", a_end: "-", b: "battery", b_end: "-" }, place: { on: "air", x: 0, y_m: 0 } }
				],
				goals: [{ kind: "moves", item: "cart", min_m: 0.3 }]
			}
		}
	],
	goals: [
		{
			kind: "generates", aliases: ["makes_electricity", "generates_power", "generates_voltage", "makes_power", "produces_electricity"],
			fields: { item: "item", at_least_v: "number?", at_least_mw: "number?" },
			about: "generates {item, at_least_v?, at_least_mw?}: a wind turbine's or a small generator's voltage (its size) is at least at_least_v (default 1 V) all through the run's last 0.5 s, and with at_least_mw its electrical power at least that",
			label: (g, nameOf) => `${nameOf(g.item)} makes ${[Number.isFinite(g.at_least_v) || !Number.isFinite(g.at_least_mw) ? `at least ${Number.isFinite(g.at_least_v) ? g.at_least_v : 1} V` : null, Number.isFinite(g.at_least_mw) ? `${g.at_least_mw} mW` : null].filter(Boolean).join(" and ")}`,
			summarize: (ctx, g) => goal_generates(ctx, g),
			detail: (e) => (e && Number.isFinite(e.volts) ? `${e.ok ? "yes" : "no"} (${n2(e.volts)} V${Number.isFinite(e.mw) ? `, ${n2(e.mw)} mW` : ""} at the end)` : null),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["wind-turbine", "generator"])
				if (!xs.length) return null
				const one = pick(xs).id
				return pick([true, false]) ? { kind: "generates", item: one, at_least_v: pick([0.5, 1, 2]) } : { kind: "generates", item: one, at_least_mw: pick([0.5, 2, 10]) }
			}
		},
		{
			kind: "generates_more", aliases: ["more_power", "generates_more_power", "makes_more_power", "more_electricity", "outpowers"],
			fields: { a: "item", b: "item" }, subject: ["a"],
			about: "generates_more {a, b}: generator a's (a turbine's, a small generator's) electrical power over the run's last 0.5 s is more than b's, by at least 10 % and 0.1 mW: a fair test of blade designs (the same wind, the same load)",
			label: (g, nameOf) => `${nameOf(g.a)} makes more power than ${nameOf(g.b)}`,
			summarize: (ctx, g) => goal_generates_more(ctx, g),
			detail: (e) => (e && Number.isFinite(e.mw_a) && Number.isFinite(e.mw_b) ? `${e.ok ? "yes" : "no"} (${n2(e.mw_a)} mW against ${n2(e.mw_b)} mW)` : null),
			sample: (scene, pick) => {
				const xs = pickOf(scene, ["wind-turbine", "generator"])
				if (xs.length < 2) return null
				const a = pick(xs)
				const b = pick(xs.filter((x) => x !== a))
				return { kind: "generates_more", a: a.id, b: b.id }
			}
		},
		{
			kind: "lifts_higher", aliases: ["lifts_more", "winds_higher", "lifts_its_load_higher", "lifts_faster"],
			fields: { a: "item", b: "item" }, subject: ["a"],
			about: "lifts_higher {a, b}: machine a's cup (a windmill's, a turbine's or a waterwheel's load_g) ends higher above where it started than b's, by at least 2 cm and 10 % (a fair test: more sails, a thinner axle, a stronger wind; in a short run, the faster lift)",
			label: (g, nameOf) => `${nameOf(g.a)} lifts its load higher than ${nameOf(g.b)}`,
			summarize: (ctx, g) => goal_lifts_higher(ctx, g),
			detail: (e) => (e && Number.isFinite(e.rise_a) && Number.isFinite(e.rise_b) ? `${e.ok ? "yes" : "no"} (${n0(e.rise_a * 100, 1)} cm against ${n0(e.rise_b * 100, 1)} cm)` : null),
			sample: (scene, pick) => {
				const xs = (scene?.items ?? []).filter((i) => (ROTORS.includes(i?.type) || i?.type === "waterwheel") && Number(i?.props?.load_g) > 0)
				if (xs.length < 2) return null
				const a = pick(xs)
				const b = pick(xs.filter((x) => x !== a))
				return { kind: "lifts_higher", a: a.id, b: b.id }
			}
		}
	],
	knobs: [
		{ type: "pinwheel", key: "pitch", how: "abs", steps: [2, 4, 6, 10], more: "turn {it}'s sails further from its face", less: "turn {it}'s sails flatter", why: "the sails' angle to the wind: about 15-20° turns fastest; steeper sails start harder but turn slower" },
		{ type: "pinwheel", key: "diameter", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a bigger windmill catches more wind: its torque grows with the cube of its size" },
		{ type: "pinwheel", key: "blades", how: "abs", steps: [1, 2, 4], cost: 1.5, more: "give {it} more sails", less: "give {it} fewer sails", why: "cut from one square, more sails are narrower: a little more starting torque" },
		{ type: "pinwheel", key: "load_g", how: "rel", cost: 2, more: "put more pennies in {it}'s cup", less: "take pennies out of {it}'s cup", why: "the cup's weight times the straw's radius must be less than the sails' torque, or the windmill stalls" },
		{ type: "pinwheel", key: "axle_mm", how: "rel", more: "wind {it}'s thread on a thicker axle", less: "wind {it}'s thread on a thinner axle", why: "a thinner axle lifts a heavier cup (less torque for the same weight) but winds in less thread a turn" },
		{ type: "pinwheel", key: "yaw", how: "abs", steps: [5, 10, 20, 30], more: "turn {it} more toward you", less: "turn {it} to face the wind", why: "turned away from the wind it meets only the wind's share along its axle: less torque, slower" },
		{ type: "pinwheel", key: "height", how: "m", more: "raise {it}'s axle", less: "lower {it}'s axle", why: "its sails must be in the fan's jet: the axle at the fan's middle height" },
		{ type: "wind-turbine", key: "pitch", how: "abs", steps: [2, 5, 10, 15], more: "turn {it}'s blades further from its face", less: "turn {it}'s blades flatter", why: "pitch 10-30° turns best: steeper blades start strongly but turn slowly; flatter ones turn fast once going but start weakly" },
		{ type: "wind-turbine", key: "blade_length", how: "rel", more: "give {it} longer blades", less: "give {it} shorter blades", why: "longer blades sweep more wind (its power grows with the area it sweeps), if the wind reaches their tips" },
		{ type: "wind-turbine", key: "blades", how: "abs", steps: [1, 2, 3], cost: 1.5, more: "give {it} more blades", less: "give {it} fewer blades", why: "more blades: more torque at low speed (they start and lift more), a little lower top speed" },
		{ type: "wind-turbine", key: "yaw", how: "abs", steps: [5, 10, 20, 30], more: "turn {it} more toward you", less: "turn {it} to face the wind", why: "turned away from the wind it meets only the wind's share along its shaft: less torque, slower, a lower voltage" },
		{ type: "wind-turbine", key: "height", how: "m", more: "raise {it}'s hub", less: "lower {it}'s hub", why: "its blades must be in the fan's jet: the hub at the fan's middle height" },
		{ type: "wind-turbine", key: "load_g", how: "rel", cost: 2, more: "put more pennies in {it}'s cup", less: "take pennies out of {it}'s cup", why: "the cup's weight times the spool's radius must be less than the blades' torque" },
		{ type: "wind-turbine", key: "generator", how: "choice", cost: 3, more: "put another generator in {it}", less: "put another generator in {it}", why: "the KidWind generator gives about 2 V at 700 rpm; a hobby motor a tenth of that (not enough for an LED)" },
		{ type: "generator", key: "ratio", how: "abs", steps: [1, 2, 4], more: "step {it} up more (a bigger pulley on the shaft)", less: "step {it} up less", why: "its voltage grows with how fast it turns: a slow waterwheel needs a step-up (ratio 5: 140 rpm → 700 rpm) to light an LED, but the shaft feels the generator's drag ratio times as much" },
		{ type: "generator", key: "leads", how: "choice", cost: 0.5, more: "swap {it}'s leads", less: "swap {it}'s leads", why: "its + is positive only while its shaft turns counter-clockwise (normal): a clockwise wheel needs its leads swapped, or an LED stays dark" },
		{ type: "generator", key: "kind", how: "choice", cost: 3, more: "use another generator", less: "use another generator", why: "the KidWind generator gives about ten times the voltage of a hobby motor at the same speed" },
		{ type: "waterwheel", key: "load_g", how: "rel", cost: 2, more: "put more pennies in {it}'s cup", less: "take pennies out of {it}'s cup", why: "the stream's push on the paddles must beat the cup's weight on its spool" },
		{ type: "waterwheel", key: "axle_mm", how: "rel", more: "wind {it}'s thread on a thicker spool", less: "wind {it}'s thread on a thinner spool", why: "a thinner spool lifts a heavier cup but more slowly" }
	],
	digest(item, run, h) {
		const out = []
		const P = run?.resolved?.[item.id] ?? item.props ?? {}
		const nameOf = (id) => h?.nameOf?.(id) ?? id
		if (ROTORS.includes(item.type)) {
			const rpm = tailOf(run, item.id, "rpm")
			const wind = tailOf(run, item.id, "wind_ms")
			const top = maxOf(run, item.id, "rpm")
			out.push(`faces the wind from the ${P.facing ?? "left"}${(P.yaw ?? 0) > 0 ? `, turned ${n0(P.yaw)}° toward the viewer` : ""}; shaft ${n0((P.height ?? 0) * 100)} cm up; ${item.type === "pinwheel" ? `${P.blades ?? 4} sails, ${n0((P.diameter ?? 0.2) * 100)} cm across at ${n0(P.pitch ?? 18)}°` : `${P.blades ?? 3} blades × ${n0((P.blade_length ?? 0.15) * 100)} cm at ${n0(P.pitch ?? 20)}°, ${n0((P.diameter ?? 0.36) * 100)} cm across`}`)
			if (rpm !== null) out.push(`wind on it ${n2(wind)} m/s; turning ${n0(Math.abs(rpm))} rpm at the end (fastest ${n0(top)} rpm), tip speed ${n2(tailOf(run, item.id, "tsr"))} × the wind; the wind gives it ${n2(tailOf(run, item.id, "power_mw"))} mW`)
			if (wind !== null && wind < 0.3) out.push(`NO wind reaches it: put a fan on its ${P.facing ?? "left"} side blowing toward it at its shaft's height (or a breeze), its sails in the jet`)
			else if (wind !== null && rpm !== null && Math.abs(rpm) < 5) {
				// (a cup wound all the way up holds the rotor still, as a real winch stops: no fault)
				const wound = (P.load_g ?? 0) > 0 && (maxOf(run, item.id, "lift_m") ?? 0) > 0.03 && (tailOf(run, item.id, "rope") ?? 1) < 0.03
				out.push(wound ? `it stopped turning when its cup was wound all the way up to its ${item.type === "pinwheel" ? "straw" : "shaft"} (a winch stops there)${item.type === "wind-turbine" && P.generator !== "none" ? ": its generator gives nothing after that (no load_g on a turbine that must light or power something)" : ""}` : `it does not turn: ${(P.load_g ?? 0) > 0 ? "its cup is too heavy for it (less load, a thinner axle, more wind), or " : ""}its blades' pitch or the wind is too weak, or the wind is on its back (facing)`)
			}
			if (item.type === "wind-turbine" && P.generator !== "none") {
				const v = tailOf(run, item.id, "generator_voltage")
				const i = tailOf(run, item.id, "generator_current")
				if (v !== null) out.push(`its ${P.generator ?? "KidWind generator"} gives ${n2(v)} V and ${n2((i ?? 0) * 1000)} mA at the end (${n2(Math.abs(v * (i ?? 0)) * 1000)} mW)${Math.abs(rpm ?? 0) < 650 && P.generator !== "hobby motor" ? `; an LED needs about 650-700 rpm (1.8 V): it turns ${n0(Math.abs(rpm ?? 0))}` : ""}`)
			}
			if ((P.load_g ?? 0) > 0) {
				const lift = maxOf(run, item.id, "lift_m")
				out.push(`its cup of ${n0(P.load_g)} g on a ${n2(P.axle_mm ?? 6)} mm axle${lift !== null ? ` rose ${n0(lift * 100, 1)} cm${lift > 0.01 ? ` (reached ${n0(lift * 100, 1)} cm at ${n2(firstWhen(run, item.id, "lift_m", (v) => v >= lift * 0.98))} s)` : ": NOT lifted"}` : ""}`)
			}
		} else if (item.type === "generator") {
			const shaft = item.props?.shaft
			const v = tailOf(run, item.id, "voltage")
			const rpm = tailOf(run, item.id, "rpm")
			out.push(shaft && P.coupled && P.coupled !== "none" ? `on the shaft of ${nameOf(shaft)} through a ${n2(P.ratio ?? 1)}:1 step-up; leads ${P.leads ?? "normal"}` : "NOT on any shaft: link `shaft` to a waterwheel, windmill, wind turbine or wheel and axle; it never turns")
			if (v !== null) out.push(`turning ${n0(rpm)} rpm, ${n2(v)} V, ${n2((tailOf(run, item.id, "current") ?? 0) * 1000)} mA out of + at the end${v < -0.2 ? ": its voltage is BACKWARD (the shaft turns clockwise): swap its leads, or an LED wired + to + stays dark" : ""}`)
		} else if (item.type === "waterwheel" && Number(item.props?.load_g) > 0) {
			const lift = maxOf(run, item.id, "lift_m")
			const spool = (run?.doc?.processes ?? []).find((p) => p.id === `${item.id}/thread`)
			const fell = endOf(run, item.id, "lift_m")
			out.push(`a cup of ${n0(item.props.load_g)} g hangs from a ${n2(item.props?.axle_mm ?? 12)} mm spool on its axle, its thread on the ${spool?.sense === -1 ? "left: it winds up as the wheel turns clockwise" : "right: it winds up as the wheel turns counter-clockwise"}${fell !== null && fell < -0.01 ? `; it FELL ${n0(-fell * 100, 1)} cm, pulling the wheel backward: too heavy for the stream (less load, a thinner spool, more flow, or winds the other way)` : lift !== null ? `; it rose ${n0(lift * 100, 1)} cm` : ""}`)
		} else if (item.type === "motor" && P.drives === "wheels") {
			const car = item.props?.car
			const parts = (run?.doc?.processes ?? []).find((p) => p.kind === "circuit")?.parts ?? []
			const part = parts.find((p) => p.id === `${item.id}/motor`)
			out.push(part?.wheel ? `drives the rear wheels of ${nameOf(car)} (it rides on it); ${n0(tailOf(run, item.id, "rpm"))} rpm, ${n2(tailOf(run, item.id, "current"))} A at the end` : "drives wheels but its `car` link names no car (toy-car, cart, truck): it turns nothing")
		}
		return out.length ? out : null
	},
	words: {
		added(item) {
			const P = item?.props ?? {}
			if (item?.type === "pinwheel") return Number(P.load_g) > 0 ? `a paper windmill lifting a ${P.load_g} g cup of pennies` : "a paper windmill"
			if (item?.type === "wind-turbine") return "a model wind turbine"
			if (item?.type === "generator") return P.shaft ? `a generator on the shaft of ${P.shaft}` : "a small generator"
			return null
		},
		keys: {
			pitch: "pitch|angle|tilt\\w*|steep\\w*|flat\\w*",
			blades: "blades?|sails?|vanes?",
			load_g: "pennies|penny|cup|load|weight|grams?|heav\\w*|lift\\w*",
			axle_mm: "axle|straw|skewer|spool|dowel|thick\\w*|thin\\w*",
			yaw: "yaw|turn\\w* (it )?(toward|towards) (me|you|the camera)|face (me|you|the camera)|angle to the wind",
			"wind-turbine.generator": "generator|dynamo|kidwind|hobby motor",
			"generator.ratio": "ratio|belt|pulley|gears?|step.?up",
			"generator.leads": "leads|polarity|swap\\w*|reverse\\w*|other way round|backwards?",
			blade_length: "longer|shorter|length|long blades|short blades"
		},
		change(type, key, a, b) {
			if (ROTORS.includes(type) && key === "pitch") return `${type === "pinwheel" ? "sails" : "blades"} at ${n0(a)}° → ${n0(b)}°`
			if (ROTORS.includes(type) && key === "blades") return `${n0(a)} → ${n0(b)} ${type === "pinwheel" ? "sails" : "blades"}`
			if (ROTORS.includes(type) && key === "yaw") return `turned ${n0(a)}° → ${n0(b)}° out of the wind`
			if ((ROTORS.includes(type) || type === "waterwheel") && key === "load_g") return `cup of pennies ${n0(a)} → ${n0(b)} g`
			if ((ROTORS.includes(type) || type === "waterwheel") && key === "axle_mm") return `thread wound on a ${n2(a)} → ${n2(b)} mm axle`
			if (type === "pinwheel" && key === "diameter") return `windmill ${n0(a * 100)} → ${n0(b * 100)} cm across`
			if (type === "wind-turbine" && key === "blade_length") return `blades ${n0(a * 100)} → ${n0(b * 100)} cm long`
			if (type === "generator" && key === "ratio") return `step-up ${n2(a)}:1 → ${n2(b)}:1 (a ${n0(140 * a)} → ${n0(140 * b)} rpm generator on a 140 rpm wheel: ${n2(KIDWIND_V_PER_RPM * 140 * a)} → ${n2(KIDWIND_V_PER_RPM * 140 * b)} V)`
			if (type === "generator" && key === "leads") return `leads ${a} → ${b}`
			return null
		}
	},
	place: {
		/** A generator touches nothing and stands on its own little base; a battery car's motor rides on its car: the solver need not prop them up. */
		held: (type) => type === "generator"
	}
}
