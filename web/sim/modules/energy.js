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
const PIN_SOLIDITY = 0.4
const PIN_TWIST = 20.0
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

function _stand_in(c, x, y, J, m, kind) {
	m = Math.max(m, 1e-5)
	let rs = Math.max(0.005, Math.sqrt((2 * J) / m))
	rs = _r(rs)
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
		const hub = _stand_in(c, sx, sy, J, m, kind)
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
			new Prop("pitch", "Sail angle", 15.0, 5.0, 45.0, 1.0, "°", "How far the sails' tips are turned from the windmill's face (they twist 20° more toward the middle)"),
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
		const hub = _stand_in(c, sx, sy, J, m, kind)
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
		volts: v === null ? null : pyRound(v[v.length - 1], 4), mw: p === null ? null : pyRound(p[p.length - 1], 3)
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
		mw_a: ma === null ? null : pyRound(ma, 3), mw_b: mb === null ? null : pyRound(mb, 3)
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
		rise_a: ra === null ? null : pyRound(ra, 4), rise_b: rb === null ? null : pyRound(rb, 4)
	}
}

// ---------------------------------------------------------------- the AI's view of the module (web/sim/plugins.js)
export const plugin = {
	title: "Energy devices: windmills, wind turbines, generators, waterwheels that lift loads, battery cars",
	goals: [
		{ kind: "generates", fields: { item: "item", at_least_v: "number?", at_least_mw: "number?" }, summarize: (ctx, g) => goal_generates(ctx, g) },
		{ kind: "generates_more", fields: { a: "item", b: "item" }, summarize: (ctx, g) => goal_generates_more(ctx, g) },
		{ kind: "lifts_higher", fields: { a: "item", b: "item" }, summarize: (ctx, g) => goal_lifts_higher(ctx, g) }
	]
}
