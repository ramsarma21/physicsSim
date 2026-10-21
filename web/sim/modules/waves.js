// The waves module (sound and waves): a port of machines/mod_waves.py, line by line (same names, same order, same numbers); plain ES module, no
// dependencies beyond web/sim. web/sim/modules/index.js registers it (register_all, as a catalog file's) and its `plugin` export, the AI's view of
// it (goal kinds, digest, knobs, prompt lines, placement rules, change words: web/sim/plugins.js). Engine: tooling/src/sim/modules/waves.ts.
// Sources: see the Python file's docstring ([KIN], [FLETCHER], [ROSSING], [ISO16], [NIOSH], [ANSI-S12], [EVEREST], [CRC]).
let register, ItemType, Prop, Readout, MATERIALS, register_goal_kind, register_build_hook, props_of, add_look, TYPES, CATEGORIES, define_material
let pyRound, fmtF
// (10 ** (L / 20) correctly rounded: machines/crmath.py's cr_pow, the same bits)
import { pow } from "../engine-math.js"

export const MODULE = "waves"
const CAT = "Sound & waves"

const R6 = (v) => pyRound(v, 6)
const TAU = 2 * Math.PI
const J01 = 2.404825557695773
const CANTILEVER = 0.5595290968074446
const FREE_BAR = 3.560757626300666

export function register_all(g) {
	;({ register, ItemType, Prop, Readout, MATERIALS, register_goal_kind, register_build_hook, props_of, add_look, TYPES, CATEGORIES, define_material } = g)
	;({ pyRound, fmtF } = g.py)
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
	_materials()
	_sources()
	_listeners()
	_wave_lines()
	_tank()
	_telephone()
	register_build_hook(_build_hook)
	// (the goal kinds are registered from `plugin.goals` by web/sim/modules/index.js, as items.py's register_goal_kind does them)
}

// ---------------------------------------------------------------- materials
function _mat(key, kw, ints = ["density"]) {
	if (!("rolling" in kw)) kw.rolling = 0.0
	if (!("side" in kw)) kw.side = 0.0
	define_material(key, kw, ints)
}

function _materials() {
	add_look("rice", { fill: "#f3ead2", shade: "#cfc3a1", roughness: 0.55, metalness: 0.0, clearcoat: 0.1 })
	add_look("drum head", { fill: "#efe9dc", shade: "#cfc6b3", roughness: 0.6, metalness: 0.0, clearcoat: 0.0 })
	add_look("acrylic", { fill: "#cfe8f5", shade: "#9cc3d8", roughness: 0.08, metalness: 0.0, clearcoat: 0.8, transmission: 0.6 })
	_mat("rice", { density: 1450, bounce: 0.45, friction: 0.5, rolling: 0.3, look: "rice", source: "Rice kernel ≈ 1450 kg/m³ (Mohsenin 1986); bounce and rolling provisional (a grain is not a ball)." })
	_mat("drum head", { density: 1390, bounce: 0.75, friction: 0.4, look: "drum head", source: "Polyester (PET) film 1390 kg/m³ (DuPont Mylar data); bounce provisional." })
	_mat("acrylic", { density: 1190, bounce: 0.6, friction: 0.45, look: "acrylic", source: "PMMA (acrylic) 1190 kg/m³, E ≈ 3.2 GPa [CRC]." })
}

// ---------------------------------------------------------------- helpers
function _strikes(P, at_key = "strike_at") {
	const t0 = P[at_key]
	const n = Math.trunc(P.hits ?? 1)
	const every = P.every ?? 1.0
	const level = P.strength
	const out = []
	for (let k = 0; k < Math.max(1, n); k++) out.push([R6(t0 + k * every), R6(level)])
	return out
}

function _source(c, solid, at, f0, partials, lp1, strikes, amp, { hold = 0.0, hit = null, kick = null, ring = null, jar = null, show = true, part = "sound" } = {}) {
	const fields = {
		role: "source", solid, at: { x: R6(at[0]), y: R6(at[1]) }, f0: R6(f0),
		partials: partials.map(([r, a, t]) => [R6(r), R6(a), R6(t)]), lp1: R6(lp1), strikes, amp: R6(amp), show: !!show
	}
	if (hold > 0) fields.hold = R6(hold)
	if (hit !== null) fields.hit = hit
	if (kick !== null) fields.kick = kick
	if (ring !== null) fields.ring = ring
	if (jar !== null) fields.jar = jar
	return c.process("sound", part, fields)
}

const STRIKE_PROPS = (at = 0.5, what = "Strike at", hits = true) => [
	new Prop("strength", "Strength", 1.0, 0.2, 2.0, 0.05, "×", "How hard it is struck or plucked: twice as hard is twice the vibration, 6 dB louder"),
	new Prop("strike_at", what, at, 0.0, 20.0, 0.05, "s", "When it sounds"),
	...(hits
		? [new Prop("hits", "Times", 1, 1, 10, 1, "", "How many times it is struck", { kind: "int" }), new Prop("every", "Every", 1.0, 0.1, 10.0, 0.05, "s", "Time between strikes")]
		: []),
	new Prop("show_waves", "Sound lines", true, { kind: "bool", help: "Faint arcs spreading from it while it sounds (a picture of sound spreading)" })
]

const SOURCE_READOUTS = () => [
	new Readout("sounding", "Sound 1 m away", { unit: "dB", digits: 1, help: "Its sound level 1 m away now (0 when silent)" }),
	new Readout("pitch", "Pitch", { unit: "Hz", digits: 1, help: "Its note's frequency" }),
	new Readout("struck", "Times sounded", { unit: "", digits: 0, help: "How many times it has been struck so far" }),
	new Readout("amp_mm", "Vibration", { unit: "mm", digits: 2, help: "How far its vibrating part swings now" })
]

// ---------------------------------------------------------------- sources
const FORK_T = 0.006
const STEEL_BAR = 5047.5

export function fork_prong(f) {
	return Math.sqrt((((CANTILEVER * FORK_T) * STEEL_BAR) / Math.sqrt(12)) / f)
}

const steel = (c) => c.mat({ base: "steel", overrides: {} })
const wood = (c) => c.mat({ base: "varnished hardwood", overrides: {} })

function build_fork(c, P) {
	const f = P.pitch
	const L = fork_prong(f)
	const gap = 0.012
	const pw = FORK_T
	const pd = 0.008
	const box = !!P.box
	const blen = box ? R6(343.2 / (4 * f)) : 0.07
	const bh = box ? 0.075 : 0.025
	const bd = box ? 0.1 : 0.06
	c.slab("box", blen, bh, bd, 0.0, bh / 2, { kind: "static", words: box ? "the fork's wooden resonance box" : "the fork's wooden block", material: wood(c) })
	const stem = 0.055
	c.slab("stem", 0.008, stem, 0.008, 0.0, bh + stem / 2, { kind: "static", words: "the tuning fork's stem", material: steel(c) })
	const yoke = 2 * pw + gap
	c.slab("yoke", yoke, 0.008, pd, 0.0, bh + stem + 0.004, { kind: "static", words: "the tuning fork's bend", material: steel(c) })
	const base = bh + stem + 0.008
	const left = c.slab("prong-left", pw, L, pd, -(gap + pw) / 2, base + L / 2, { kind: "static", words: "a tuning fork prong", material: steel(c) })
	const right = c.slab("prong-right", pw, L, pd, (gap + pw) / 2, base + L / 2, { kind: "static", words: "a tuning fork prong", material: steel(c) })
	const lp1 = box ? 55.0 : 45.0
	const tau = box ? 2.0 : 6.0
	const partials = [[1.0, 1.0, tau], [6.25, 0.1, tau / 20]]
	const amp = 0.0002
	const prong_mass = 0.25 * 7850.0 * L * pw * pd
	_source(c, left, [pw / 2 + gap / 2, 0.0], f, partials, lp1, _strikes(P), amp, {
		hit: { solids: [left, right], momentum: 0.045, max: 3.0 },
		kick: { solids: [left, right], dir: "out", amp, shape: "prong", size: R6(L), mass: R6(prong_mass) },
		show: P.show_waves
	})
}

export const RULERS = { plastic: [3.2e9, 1190.0, 0.003, 0.25], steel: [200e9, 7850.0, 0.0005, 0.8], wood: [11e9, 700.0, 0.004, 0.2] }

export function ruler_pitch(L, mat) {
	const [E, rho, t] = RULERS[mat]
	return CANTILEVER * (t / (L * L)) * Math.sqrt(E / (12 * rho))
}

function build_ruler(c, P) {
	const L = P.overhang
	const mat = P.ruler
	const [, , t] = RULERS[mat]
	const f = ruler_pitch(L, mat)
	const total = 0.3
	const back = total - L
	const side = P.edge === "left" ? -1.0 : 1.0
	const table = [...c.sb.scene_items.values()].find((it) => it.type === "table")
	if (table !== undefined) {
		c.ox = (table.x ?? 0.0) + (side * props_of(table).width) / 2
		c.oy = table.y ?? 0.0
	}
	const look = { plastic: "acrylic", steel: "steel", wood: "light wood" }[mat]
	const base = { plastic: "acrylic", steel: "steel", wood: "varnished hardwood" }[mat]
	const ruler = c.slab("ruler", total, t, 0.03, (side * (L - back)) / 2, t / 2, { kind: "static", words: `a ${mat} ruler held at the table's edge`, look, material: c.mat({ base, overrides: {} }) })
	c.slab("clamp", 0.04, 0.03, 0.04, side * (-back + 0.03), t + 0.015, { kind: "static", words: "a clamp holding the ruler down", look: "steel", material: steel(c) })
	const tau = RULERS[mat][3]
	const partials = []
	for (let n = 1; n < 13; n++) partials.push([n, 1.0 / n, tau / (1 + 0.2 * (n - 1))])
	_source(c, ruler, [side * (total / 2 - 0.005), 0.0], f, partials, 70.0, _strikes(P, "strike_at"), 0.02, { show: P.show_waves })
}

export const DRUM_MODES = {
	middle: [[1.0, 1.0], [2.2954, 0.4]],
	halfway: [[1.0, 0.6699], [1.5933, 0.2904], [2.1355, 0.1365], [2.2954, 0.0674], [2.6531, 0.0683], [2.9173, 0.0671]],
	"near the rim": [[1.0, 0.268], [1.5933, 0.1572], [2.1355, 0.1008], [2.2954, 0.1356], [2.6531, 0.0692], [2.9173, 0.1666]]
}
const HEAD_SIGMA = 1390 * 0.00019

export function drum_pitch(diameter, tension) {
	return (J01 / ((TAU * diameter) / 2)) * Math.sqrt(tension / HEAD_SIGMA)
}

function build_drum(c, P) {
	const D = P.diameter
	const H = P.height
	const f = drum_pitch(D, P.tension)
	const deep = Math.min(D, 0.5)
	c.slab("shell", D, H - 0.002, deep, 0.0, (H - 0.002) / 2, { kind: "static", words: "the drum's wooden shell", material: wood(c) })
	const head = c.slab("head", D, 0.002, deep, 0.0, H - 0.001, { kind: "static", words: "the drum's tight head", look: "drum head", material: c.mat({ base: "drum head", overrides: {} }) })
	for (const side of [-1, 1])
		c.slab(`rim-${side < 0 ? "left" : "right"}`, 0.012, 0.012, deep, side * (D / 2 - 0.006), H + 0.006 - 0.002, { kind: "static", words: "the drum's rim", look: "steel", material: steel(c) })
	const partials = DRUM_MODES[P.strike_where].map(([r, a]) => [r, a, 0.2 / Math.sqrt(r)])
	// (the head's middle moves at ≈ 0.49 m/s at a medium hit whatever its tension: its swing 0.0785 / f; its (0,1) mode's modal mass 0.2695·σ·πa²)
	const amp = 0.0785 / f
	const head_mass = 0.2695 * HEAD_SIGMA * Math.PI * (D / 2) * (D / 2)
	_source(c, head, [0.0, 0.001], f, partials, 85.0, _strikes(P), amp, {
		hit: { solids: [head], momentum: 0.15, max: 3.0 },
		kick: { solids: [head], dir: "up", amp: R6(amp), shape: "membrane", size: R6(D / 2), mass: R6(head_mass) },
		show: P.show_waves
	})
}

function build_rice(c, P) {
	const n = Math.trunc(P.count)
	const w = Math.max(P.spread, (n - 1) * 0.0032)
	const r = 0.0015
	for (let k = 0; k < n; k++) {
		const x = n === 1 ? 0.0 : -w / 2 + (w * k) / (n - 1)
		c.ball(`grain${k + 1}`, r, x, r, { words: "a grain of rice", look: "rice", material: c.mat({ base: "rice", overrides: {} }) })
	}
}

export const STRINGS = { steel: [200e9, 7850.0, 1.5], nylon: [4e9, 1140.0, 0.8] }
export const PLUCKS = {
	middle: [1.0, 0.0, 0.333333, 0.0, 0.2, 0.0, 0.142857, 0.0],
	"near a bridge": [0.587785, 0.475528, 0.317019, 0.146946, 0.0, 0.097964, 0.135865, 0.118882]
}

export function string_pitch(L, T, mu) {
	return Math.sqrt(T / mu) / (2 * L)
}

function build_monochord(c, P) {
	const L = P.length
	const T = P.tension
	const mu = P.gauge / 1000
	const [E, rho, tau] = STRINGS[P.string]
	const f = string_pitch(L, T, mu)
	const d = Math.sqrt((4 * mu) / (Math.PI * rho))
	const B = (Math.PI * Math.PI * Math.PI * E * (d * d) * (d * d)) / (64 * T * L * L)
	const box_l = L + 0.16
	c.slab("box", box_l, 0.08, 0.14, 0.0, 0.04, { kind: "static", words: "the monochord's sound box", material: wood(c) })
	for (const side of [-1, 1])
		c.poly(`bridge-${side < 0 ? "left" : "right"}`, [[-0.008, 0.0], [0.008, 0.0], [0.0015, 0.02], [-0.0015, 0.02]], 0.06, (side * L) / 2, 0.08, {
			kind: "static", words: "a bridge under the string", material: wood(c)
		})
	const string = c.slab("string", L, pyRound(Math.max(0.0005, d), 5), 0.002, 0.0, 0.1, {
		kind: "static", words: `a ${P.string} string`, look: P.string === "steel" ? "steel" : "plastic", material: steel(c)
	})
	const amps = PLUCKS[P.pluck_where]
	const partials = []
	for (let n = 1; n < 9; n++) if (amps[n - 1] > 0) partials.push([(n * Math.sqrt(1 + B * n * n)) / Math.sqrt(1 + B), amps[n - 1], tau / (1 + 0.15 * (n - 1))])
	_source(c, string, [0.0, 0.0], f, partials, 70.0, _strikes(P), 0.002, { show: P.show_waves })
}

// natural rubber: shear modulus G (Pa), its stretch at break, density (kg/m³), a band's thickness unstretched (m) [TRELOAR, CRC]
export const RUBBER_G = 0.5e6
export const RUBBER_BREAK = 6.0
const RUBBER_RHO = 930.0
const BAND_H = 0.0008

/** The most a band 0.8 mm × width pulls before it snaps (N): G·A0·(λ − 1/λ²) at its breaking stretch. */
export function band_hold(width_mm) {
	const A0 = (width_mm / 1000) * BAND_H
	return RUBBER_G * A0 * (RUBBER_BREAK - 1 / (RUBBER_BREAK * RUBBER_BREAK))
}

/** The stretch λ at which the band pulls T N (neo-Hookean, 60 halvings: the same bits as items.py's). */
export function band_stretch(T, width_mm) {
	const A0 = (width_mm / 1000) * BAND_H
	const want = T / (RUBBER_G * A0)
	let lo = 1.0
	let hi = RUBBER_BREAK
	if (hi - 1 / (hi * hi) <= want) return hi
	for (let k = 0; k < 60; k++) {
		const mid = (lo + hi) / 2
		if (mid - 1 / (mid * mid) < want) lo = mid
		else hi = mid
	}
	return (lo + hi) / 2
}

/** A rubber band's note (Hz): √(T/μ)/(2L), T at most what it holds, μ = ρ·A0/λ at the stretch that pull needs. */
export function band_pitch(L, T0, width_mm) {
	const T = Math.min(T0, band_hold(width_mm))
	const lam = band_stretch(T, width_mm)
	const mu = (RUBBER_RHO * (width_mm / 1000) * BAND_H) / lam
	return string_pitch(L, T, mu)
}

function build_band(c, P) {
	const L = P.length
	const T = P.tension
	const f = band_pitch(L, T, P.width)
	c.slab("box", L + 0.06, 0.1, 0.16, 0.0, 0.05, { kind: "static", words: "an open shoebox", look: "cardboard", material: c.mat({ base: "cardboard", overrides: {} }) })
	const band = c.slab("band", L + 0.06, 0.002, pyRound(P.width / 1000, 5), 0.0, 0.101, {
		kind: "static", words: "a rubber band stretched over the box", look: "rubber", material: c.mat({ base: "solid rubber", overrides: {} })
	})
	const partials = []
	for (let n = 1; n < 7; n++) partials.push([n, 1.0 / n, 0.12 / n])
	_source(c, band, [0.0, 0.0], f, partials, 55.0, _strikes(P), 0.003, { show: P.show_waves })
}

export const BARS = { aluminium: [69e9, 2700.0, 1.0, "aluminium"], steel: [200e9, 7850.0, 1.5, "steel"], rosewood: [20e9, 1000.0, 0.3, "dark wood"] }

export function bar_pitch(L, t, E, rho) {
	return FREE_BAR * (t / (L * L)) * Math.sqrt(E / (12 * rho))
}

function build_bar(c, P) {
	const L = P.length
	const t = P.thickness / 1000
	const [E, rho, tau, mat] = BARS[P.metal]
	const f = bar_pitch(L, t, E, rho)
	c.slab("frame", L + 0.04, 0.03, 0.08, 0.0, 0.015, { kind: "static", words: "a low wooden frame", material: wood(c) })
	for (const side of [-1, 1])
		c.slab(`felt-${side < 0 ? "left" : "right"}`, 0.012, 0.01, 0.06, side * (0.5 - 0.224) * L, 0.035, {
			kind: "static", words: "a felt pad", look: "carpet", material: c.mat({ base: "carpet", overrides: {} })
		})
	const bar = c.slab("bar", L, t, 0.03, 0.0, 0.04 + t / 2, {
		kind: "static", words: `a ${P.metal} xylophone bar`, look: mat,
		material: c.mat({ base: P.metal === "steel" ? "steel" : P.metal === "rosewood" ? "varnished hardwood" : "aluminium", overrides: {} })
	})
	const partials = [[1.0, 1.0, tau], [2.756, 0.5, tau / 2], [5.404, 0.25, tau / 4], [8.933, 0.12, tau / 6]]
	_source(c, bar, [0.0, t / 2], f, partials, 75.0, _strikes(P), 0.0001, { hit: { solids: [bar], momentum: 0.03, max: 3.0 }, show: P.show_waves })
}

function build_speaker(c, P) {
	const W = 0.16
	const H = 0.24
	const box = c.slab("box", W, H, 0.16, 0.0, H / 2, { kind: "static", words: "a small speaker box", look: "dark wood", material: wood(c) })
	const dur = P.on_for
	const hold = dur > 0 ? dur : 30.0
	_source(c, box, [0.0, H * 0.05], P.pitch, [[1.0, 1.0, 0.02]], P.level, [[R6(P.on_at), 1.0]], 0.0, { hold, show: P.show_waves })
}

function build_clapper(c, P) {
	c.slab("handle", 0.03, 0.12, 0.03, 0.0, 0.06, { kind: "static", words: "the clapper's handle", material: wood(c) })
	const board = c.slab("boards", 0.05, 0.3, 0.06, 0.0, 0.27, { kind: "static", words: "two wooden boards that clap", material: wood(c) })
	const partials = [[1.0, 1.0, 0.015], [1.63, 0.8, 0.012], [2.4, 0.6, 0.01], [3.3, 0.4, 0.008]]
	_source(c, board, [0.0, 0.08], 1200.0, partials, 95.0 * 1.0, _strikes(P), 0.001, { show: P.show_waves })
}

function build_belljar(c, P) {
	const R = 0.11
	c.slab("plate", 0.32, 0.02, 0.32, 0.0, 0.01, { kind: "static", words: "the vacuum pump's plate", look: "steel", material: steel(c) })
	c.slab("bell-post", 0.01, 0.12, 0.01, 0.0, 0.08, { kind: "static", words: "the bell's post", look: "steel", material: steel(c) })
	const gong = c.ball("gong", 0.035, 0.0, 0.16, { kind: "static", words: "the bell's gong", look: "steel", material: steel(c) })
	for (const side of [-1, 1])
		c.slab(`glass-${side < 0 ? "left" : "right"}`, 0.004, 0.26, 2 * R, side * (R - 0.002), 0.15, {
			kind: "static", words: "the bell jar's glass", look: "glass", material: c.mat({ base: "glass", overrides: {} })
		})
	c.slab("glass-top", 2 * R, 0.004, 2 * R, 0.0, 0.282, { kind: "static", words: "the bell jar's glass top", look: "glass", material: c.mat({ base: "glass", overrides: {} }) })
	const end = P.pump_at + P.pump_for
	const ring = { rate: 18.0, from: R6(P.ring_at), until: 1e9 }
	const jar = { from: 100.0, to: R6(P.air_left), t0: R6(P.pump_at), t1: R6(end), glass: 20.0, base: 55.0 }
	const partials = [[1.0, 1.0, 0.25], [2.76, 0.5, 0.15], [5.4, 0.25, 0.08]]
	_source(c, gong, [0.0, 0.0], P.pitch, partials, 90.0, [], 0.0001, { ring, jar, show: P.show_waves })
}

export const BOTTLES = { "330 ml": [0.00033, 0.17, 0.031, 0.0025, 0.0095, 0.06], "500 ml": [0.0005, 0.18, 0.036, 0.0028, 0.0095, 0.07], "750 ml": [0.00075, 0.21, 0.038, 0.003, 0.0095, 0.09] }
const GLASS = [70e9, 2500.0, 0.22]

export function bottle_pitch(size, fill, play, temp = 20.0) {
	const [V, , R0, a, rn, Ln] = BOTTLES[size]
	const [E, rho, nu] = GLASS
	if (play === "blow") {
		const c = 331.3 * Math.sqrt(1 + temp / 273.15)
		const A = Math.PI * rn * rn
		return (c / (2 * Math.PI)) * Math.sqrt(A / (V * (1 - fill) * (Ln + 1.45 * rn)))
	}
	const R = R0 - a / 2
	const ring = ((((a / (R * R)) * Math.sqrt(E / (12 * rho * (1 - nu * nu)))) * 6) / Math.sqrt(5)) / (2 * Math.PI)
	const h4 = fill * fill * fill * fill
	return ring / Math.sqrt(1 + ((998.2 * R) / (5 * rho * a)) * h4)
}

function build_bottle(c, P) {
	const [, H, R0, , rn, Ln] = BOTTLES[P.size]
	const play = P.play
	const f = bottle_pitch(P.size, P.fill, play, c.settings.room_temp)
	const glass = c.mat({ base: "glass", overrides: {} })
	const body = c.slab("body", 2 * R0, H, 2 * R0, 0.0, H / 2, { kind: "static", words: "a glass bottle", look: "glass", material: glass })
	const n2 = rn + 0.004
	c.poly("shoulder", [[-R0, -0.02], [R0, -0.02], [n2, 0.02], [-n2, 0.02]], 2 * R0, 0.0, H + 0.02, { kind: "static", words: "the bottle's shoulder", look: "glass", material: glass })
	const neck = c.slab("neck", 2 * (rn + 0.004), Ln, 2 * (rn + 0.004), 0.0, H + 0.04 + Ln / 2, { kind: "static", words: "the bottle's neck", look: "glass", material: glass })
	if (play === "blow") _source(c, neck, [0.0, Ln / 2], f, [[1.0, 1.0, 0.06], [2.0, 0.12, 0.04]], 70.0, _strikes(P), 0.0, { hold: P.blow_for, show: P.show_waves })
	else _source(c, body, [R0, H * 0.3], f, [[1.0, 1.0, 0.25], [2.83, 0.35, 0.12]], 65.0, _strikes(P), 0.00002, { hit: { solids: [body], momentum: 0.02, max: 3.0 }, show: P.show_waves })
}

function _sources() {
	const common = { dynamic: false, module: "waves", readouts: SOURCE_READOUTS() }
	register(new ItemType("tuning-fork", "Tuning fork", CAT, build_fork, {
		props: [
			new Prop("pitch", "Pitch", 440.0, 128.0, 2048.0, 0.1, "Hz", "Its note. School sets: 256 (C), 288 (D), 320 (E), 341.3 (F), 384 (G), 426.7 (A), 480 (B), 512 (C'); A4 = 440 [ISO 16]. Higher pitch = shorter prongs"),
			new Prop("box", "On a resonance box", true, { kind: "bool", help: "Standing on its wooden sound box: louder, rings shorter" }),
			...STRIKE_PROPS()
		],
		tags: ["sound", "pitch", "vibration", "note", "frequency", "fork", "ring", "hum", "music"],
		description: "A steel tuning fork standing on its wooden resonance box. Struck at its strike time it hums one steady note (its pitch) that slowly dies away; " +
			"a ball or a ping-pong ball touching a prong is knocked away by the vibration, and one that hits a prong makes it ring.",
		source: "Prongs: a clamped-free bar, f = 1.875²/(2π)·(t/L²)·√(E/(12ρ)), steel, 6 mm prongs (Fletcher & Rossing 1998); clang mode 6.25×, decay times " +
			"(Rossing, Science of Sound); levels provisional.",
		anchor: "the middle of the bottom of its box", facts: "440 Hz · 10.5 cm prongs · rings ≈ 2 s on its box", ...common
	}))
	register(new ItemType("plucked-ruler", "Plucked ruler", CAT, build_ruler, {
		props: [
			new Prop("overhang", "Overhang", 0.15, 0.05, 0.25, 0.005, "m", "How far it sticks out past the table's edge: shorter = higher pitch (pitch ∝ 1/overhang²)"),
			new Prop("ruler", "Ruler", "plastic", { kind: "choice", choices: ["plastic", "steel", "wood"], help: "Acrylic 3 mm, spring steel 0.5 mm, or wood 4 mm" }),
			new Prop("edge", "Table edge", "right", { kind: "choice", choices: ["right", "left"], help: "Which edge of the table it sticks out over" }),
			...STRIKE_PROPS(0.5, "Pluck at")
		],
		tags: ["sound", "pitch", "vibration", "twang", "ruler", "overhang", "cantilever", "buzz"],
		description: "A 30 cm ruler clamped to the table's right edge (or its left edge: edge left) with part of it sticking out past it; it clamps itself to that edge wherever its x is. Plucked, its free end " +
			"buzzes up and down; the shorter the part that sticks out, the faster it vibrates and the higher its note.",
		source: "A clamped-free bar: f₁ = 1.875²/(2π)·(t/L²)·√(E/(12ρ)) (Fletcher & Rossing 1998): acrylic 3 mm ≈ 0.795/L² Hz (15 cm → 35 Hz, 10 cm → 79 Hz).",
		anchor: "the table's edge, under the ruler (the overhang sticks out past it: right, or left with edge left)", facts: "15 cm over the edge · 35 Hz", ...common
	}))
	register(new ItemType("drum", "Drum", CAT, build_drum, {
		props: [
			new Prop("diameter", "Diameter", 0.3, 0.2, 0.4, 0.01, "m"),
			new Prop("height", "Height", 0.16, 0.08, 0.4, 0.01, "m", "Its shell's height: where its head is"),
			new Prop("tension", "Head tension", 1000.0, 200.0, 5000.0, 10.0, "N/m", "How tight the head is: tighter = higher pitch (pitch ∝ √tension)"),
			new Prop("strike_where", "Struck at", "halfway", { kind: "choice", choices: ["middle", "halfway", "near the rim"], help: "Where the stick hits the head" }),
			...STRIKE_PROPS()
		],
		tags: ["sound", "drum", "beat", "loud", "louder", "vibration", "rice", "membrane", "percussion", "hit"],
		description: "A hand drum standing on the table. Struck, its head vibrates and booms; rice or light things lying on the head jump up (harder hit, higher " +
			"jump), and a ball dropped on it sounds it too.",
		source: "Ideal membrane f01 = 2.405/(2πa)·√(T/σ) (Kinsler et al. 2000), 0.19 mm Mylar head (0.264 kg/m²); overtones 1.59, 2.14, 2.30, 2.65, 2.92 ×; level and " +
			"head motion provisional.",
		anchor: "the middle of its bottom", facts: "Ø 30 cm · 157 Hz · ≈ 85 dB at 1 m", ...common
	}))
	register(new ItemType("monochord", "Monochord (guitar string)", CAT, build_monochord, {
		props: [
			new Prop("length", "String length", 0.648, 0.3, 1.0, 0.001, "m", "Between the bridges: half as long = an octave higher"),
			new Prop("tension", "Tension", 73.0, 20.0, 120.0, 0.5, "N", "How hard it is pulled: 4 × the tension = an octave higher"),
			new Prop("gauge", "Weight per length", 0.4, 0.4, 6.0, 0.01, "g/m", "Heavier (thicker) string = lower pitch; 0.40 g/m is a guitar's high E"),
			new Prop("string", "String", "steel", { kind: "choice", choices: ["steel", "nylon"] }),
			new Prop("pluck_where", "Plucked", "near a bridge", { kind: "choice", choices: ["middle", "near a bridge"] }),
			...STRIKE_PROPS(0.5, "Pluck at")
		],
		tags: ["sound", "string", "guitar", "pitch", "octave", "tension", "monochord", "sonometer", "pluck", "music"],
		description: "One string stretched between two bridges over a wooden sound box (a monochord, like one guitar string). Plucked, it sounds a note set by its " +
			"length, tension and weight: f = √(T/μ)/(2L).",
		source: "f = (1/2L)·√(T/μ) (Kinsler et al. 2000); high-E check 0.648 m, 0.40 g/m, 73 N → 329.6 Hz; stiffness B = π³Ed⁴/(64TL²) (Fletcher 1964).",
		anchor: "the middle of the bottom of its box", facts: "329.6 Hz (high E) · 64.8 cm", ...common
	}))
	register(new ItemType("rubber-band", "Rubber band on a box", CAT, build_band, {
		props: [
			new Prop("width", "Band width", 3.0, 1.0, 10.0, 0.5, "mm", "Wider (thicker) band = heavier = lower pitch (at the same pull)"),
			new Prop("length", "Stretched length", 0.25, 0.1, 0.4, 0.005, "m", "Shorter = higher pitch"),
			new Prop("tension", "Tension", 2.0, 0.2, 20.0, 0.1, "N", "How hard it pulls: stretched tighter = higher pitch. At most what the band holds before it snaps (about 6 × its length: a 3 mm band ≈ 7 N, 1 mm ≈ 2.4 N)"),
			...STRIKE_PROPS(0.5, "Pluck at")
		],
		tags: ["sound", "rubber band", "guitar", "shoebox", "pitch", "thickness", "pluck", "string"],
		description: "A rubber band stretched over an open shoebox (a shoebox guitar). Plucked, it twangs: thicker bands sound lower, tighter or shorter ones higher.",
		source: "f = (1/2L)·√(T/μ); natural rubber 930 kg/m³ (CRC), neo-Hookean G 0.5 MPa, breaks at 6 × its length (Treloar 1975): a band 0.8 mm × " +
			"width stretched as far as its pull needs (μ = ρ·A0/λ); ring time and level provisional.",
		anchor: "the middle of the bottom of its box", facts: "3 mm band · 2 N · ≈ 83 Hz", ...common
	}))
	register(new ItemType("xylophone-bar", "Xylophone bar", CAT, build_bar, {
		props: [
			new Prop("length", "Length", 0.2, 0.08, 0.4, 0.001, "m", "Shorter bar = higher note (pitch ∝ 1/length²)"),
			new Prop("thickness", "Thickness", 6.0, 3.0, 12.0, 0.5, "mm"),
			new Prop("metal", "Material", "aluminium", { kind: "choice", choices: ["aluminium", "steel", "rosewood"] }),
			...STRIKE_PROPS()
		],
		tags: ["sound", "xylophone", "glockenspiel", "bar", "pitch", "note", "music", "chime"],
		description: "One xylophone (glockenspiel) bar on felt pads. Struck, it rings a clear note; a shorter bar is higher (length ÷ √2 = an octave up). A ball that " +
			"hits it rings it too.",
		source: "Free-free bar f₁ = 4.730²/(2π)·(t/L²)·√(E/(12ρ)) (Fletcher & Rossing 1998): aluminium 6 mm × 20 cm → 779 Hz.",
		anchor: "the middle of the bottom of its frame", facts: "779 Hz (aluminium, 6 mm × 20 cm)", ...common
	}))
	register(new ItemType("glass-bottle", "Glass bottle with water (a note)", CAT, build_bottle, {
		props: [
			new Prop("size", "Size", "500 ml", { kind: "choice", choices: Object.keys(BOTTLES) }),
			new Prop("fill", "Water", 0.3, 0.0, 0.9, 0.01, "of full", "How full of water: tapped, more water = lower; blown, more water = higher"),
			new Prop("play", "Played by", "tap", { kind: "choice", choices: ["tap", "blow"], help: "Tapped with a spoon (the glass rings) or blown across the top (the air in it sounds)" }),
			new Prop("blow_for", "Blow for", 1.0, 0.1, 10.0, 0.1, "s"),
			...STRIKE_PROPS()
		],
		tags: ["bottle", "water", "pitch", "music", "xylophone", "blow", "tap", "glass", "note", "sound"],
		description: "A glass bottle with some water in it, standing on the table (a bottle xylophone's note). Tapped, its glass rings: the more water, " +
			"the LOWER the note. Blown across the top, the air inside sounds: the more water (the less air), the HIGHER the note.",
		source: "Tapped: Rayleigh's ring mode of the wall lowered by the water (after French, Am. J. Phys. 51, 688 (1983)); blown: a Helmholtz resonator " +
			"(Kinsler et al. 2000 §10.8); bottle sizes and levels provisional.",
		anchor: "the middle of its bottom", facts: "500 ml, 30 % full: tapped ≈ 1.56 kHz, blown ≈ 170 Hz", ...common
	}))
	register(new ItemType("rice", "Rice grains", CAT, build_rice, {
		module: "waves", material: "rice", materials: ["rice"],
		props: [new Prop("count", "Grains", 12, 1, 40, 1, "", { kind: "int" }), new Prop("spread", "Spread", 0.12, 0.0, 0.4, 0.005, "m", "How wide the row of grains is")],
		tags: ["rice", "grains", "sand", "vibration", "jump", "drum", "bounce", "seeds"],
		description: "A few grains of rice in a row, to lay on a drum's head (or a speaker): when the drum is struck they jump, showing that sound is vibration.",
		source: "A long-grain kernel ≈ 20-25 mg at ≈ 1450 kg/m³ (Mohsenin 1986), built as a 3 mm ball of the same volume.",
		anchor: "the middle of the row's bottom", facts: "12 grains · 20 mg each"
	}))
	register(new ItemType("speaker", "Speaker (tone)", CAT, build_speaker, {
		props: [
			new Prop("pitch", "Pitch", 440.0, 20.0, 20000.0, 1.0, "Hz", "The tone it plays (people hear about 20 to 20 000 Hz)"),
			new Prop("level", "Loudness 1 m away", 70.0, 40.0, 110.0, 1.0, "dB", "Conversation ≈ 60 dB, a busy classroom ≈ 70 dB"),
			new Prop("on_at", "Starts at", 0.5, 0.0, 20.0, 0.05, "s"),
			new Prop("on_for", "Plays for", 2.0, 0.0, 20.0, 0.05, "s", "0 = until the end"),
			new Prop("show_waves", "Sound lines", true, { kind: "bool" })
		],
		tags: ["sound", "speaker", "tone", "pitch", "loudness", "frequency", "generator", "beep", "loudspeaker"],
		description: "A small speaker box playing one steady tone at the pitch and loudness you set (a tone generator).",
		source: "A pure tone; its level 1 m away is the setting (typical levels: conversation 60 dB, a busy classroom 65-75 dB [NIOSH]).",
		anchor: "the middle of its bottom", facts: "440 Hz · 70 dB at 1 m", ...common
	}))
	register(new ItemType("clapper", "Wooden clapper", CAT, build_clapper, {
		props: STRIKE_PROPS(0.5, "Clap at"),
		tags: ["sound", "clap", "echo", "click", "slapstick", "loud", "short"],
		description: "Two wooden boards that clap shut: one short, sharp, loud click (good for hearing an echo off a far wall).",
		source: "Hardwood plate modes near 1-4 kHz dying within ≈ 15 ms; ≈ 95 dB at 1 m (provisional).",
		anchor: "the middle of the bottom of its handle", facts: "a sharp click · ≈ 95 dB at 1 m", ...common
	}))
	register(new ItemType("bell-jar", "Bell in a jar", CAT, build_belljar, {
		props: [
			new Prop("pitch", "Bell pitch", 1500.0, 300.0, 4000.0, 10.0, "Hz"),
			new Prop("ring_at", "Rings from", 0.2, 0.0, 20.0, 0.05, "s"),
			new Prop("pump_at", "Pump starts", 1.0, 0.0, 20.0, 0.1, "s"),
			new Prop("pump_for", "Pumping takes", 4.0, 0.1, 20.0, 0.1, "s"),
			new Prop("air_left", "Air left", 0.0, 0.0, 100.0, 1.0, "%", "How much air the pump leaves in the jar (0 = a vacuum)"),
			new Prop("show_waves", "Sound lines", true, { kind: "bool" })
		],
		tags: ["vacuum", "bell", "jar", "air", "medium", "no sound", "pump", "sound needs air"],
		description: "An electric bell ringing inside a glass jar on a vacuum pump's plate. As the pump takes the air out, the bell is heard less and less: " +
			"sound needs air (a medium) to travel. A little still gets out through the plate.",
		source: "Sound radiated into the jar's air ∝ its pressure; jar glass 20 dB, the plate's path 55 dB under the bell (provisional calibrations).",
		anchor: "the middle of the bottom of its plate", facts: "rings at 18 strikes/s · pumped empty from 1 s to 5 s", ...common
	}))
}

// ---------------------------------------------------------------- listeners and reflectors
export const WEIGHTINGS = { "dB(A)": "A", "dB(Z)": "Z" }
export const RESPONSES = { fast: 0.125, slow: 1.0 }

function build_meter(c, P) {
	const h = P.height
	c.slab("tripod", 0.1, h - 0.12, 0.1, 0.0, (h - 0.12) / 2, { kind: "static", words: "the meter's tripod", look: "steel", material: steel(c) })
	const body = c.slab("body", 0.07, 0.1, 0.035, 0.0, h - 0.07, { kind: "static", words: "a sound level meter", look: "plastic", material: c.mat({ base: "ABS plastic", overrides: {} }) })
	c.ball("mic", 0.011, 0.0, h - 0.011, { kind: "static", words: "the meter's microphone", look: "steel", material: steel(c) })
	c.process("sound", "meter", {
		role: "meter", solid: body, at: { x: 0.0, y: 0.059 }, weighting: WEIGHTINGS[P.weighting], response: RESPONSES[P.response], floor: R6(P.room),
		listen: P.listen === "touching" ? "touch" : "air"
	})
}

function build_hydrophone(c, P) {
	const ph = P.probe_height
	const reach = P.reach
	const top = Math.max(ph + 0.12, P.arm_height)
	c.slab("rod", 0.012, top, 0.012, 0.0, top / 2, { kind: "static", words: "the hydrophone's stand", look: "steel", material: steel(c) })
	c.slab("arm", reach, 0.01, 0.01, reach / 2, top - 0.005, { kind: "static", words: "the stand's arm", look: "steel", material: steel(c) })
	c.slab("display", 0.08, 0.05, 0.06, -0.06, 0.025, { kind: "static", words: "the hydrophone's meter box", look: "plastic", material: c.mat({ base: "ABS plastic", overrides: {} }) })
	const probe = c.ball("probe", 0.008, reach, ph, { kind: "static", words: "a hydrophone probe", look: "rubber", material: steel(c) })
	c.process("sound", "meter", { role: "meter", solid: probe, at: { x: 0.0, y: 0.0 }, weighting: WEIGHTINGS[P.weighting], response: RESPONSES[P.response], floor: R6(P.room), listen: "water" })
}

// an oscilloscope's screen: 10 squares across, 8 up (a bench scope's graticule); how long one square across lasts, and how much sound
// pressure one square up is
export const SCOPE_TIME = { "0.5 ms a square": 0.0005, "1 ms a square": 0.001, "2 ms a square": 0.002, "5 ms a square": 0.005, "10 ms a square": 0.01 }
export const SCOPE_SCALE = { "0.01 Pa a square": 0.01, "0.02 Pa a square": 0.02, "0.05 Pa a square": 0.05, "0.1 Pa a square": 0.1, "0.2 Pa a square": 0.2, "0.5 Pa a square": 0.5, "1 Pa a square": 1.0 }

function build_scope(c, P) {
	// a bench oscilloscope with its microphone on a little stand beside it: the screen draws the sound's pressure at the microphone against
	// time. The microphone is a meter (flat, dB(Z), fast); the trace is the view's, from its readings: the wave's height from the level
	// (p = 20 µPa · 10^(L/20) rms, × √2 at a sine's peak), how close the waves are from the pitch (f × the screen's 10 squares of time)
	c.slab("body", 0.3, 0.16, 0.22, 0.0, 0.08, { kind: "static", words: "an oscilloscope", look: "plastic", material: c.mat({ base: "ABS plastic", overrides: {} }) })
	const mx = P.mic_side === "right" ? 0.21 : -0.21
	const mh = P.mic_height
	c.slab("stand", 0.008, mh - 0.011, 0.008, mx, (mh - 0.011) / 2, { kind: "static", words: "the oscilloscope microphone's stand", look: "steel", material: steel(c) })
	const mic = c.ball("mic", 0.011, mx, mh, { kind: "static", words: "the oscilloscope's microphone", look: "steel", material: steel(c) })
	c.process("sound", "meter", { role: "meter", solid: mic, at: { x: 0.0, y: 0.0 }, weighting: "Z", response: 0.125, floor: R6(P.room), listen: "air" })
}

export const ABSORB = { foam: 0.8, curtain: 0.49, carpet: 0.14, "cork board": 0.2 }
export const WALL_ABSORB = { steel: 0.03, "varnished hardwood": 0.1, "domino wood": 0.1 }

function build_panel(c, P) {
	const H = P.height
	const T = P.thickness
	const look = { foam: "foam", curtain: "carpet", carpet: "carpet", "cork board": "cork" }[P.surface]
	const base = { foam: "foam", curtain: "carpet", carpet: "carpet", "cork board": "cork" }[P.surface]
	const sid = c.slab("panel", T, H, 0.6, 0.0, H / 2, { kind: "static", words: `a ${P.surface} sound panel`, look, material: c.mat({ base, overrides: {} }) })
	c.process("sound", "echo", { role: "wall", solid: sid, a: { x: 0.0, y: R6(-H / 2) }, b: { x: 0.0, y: R6(H / 2) }, absorption: ABSORB[P.surface] })
}

function _listeners() {
	register(new ItemType("sound-meter", "Sound level meter", CAT, build_meter, {
		dynamic: false, module: "waves",
		props: [
			new Prop("height", "Microphone height", 0.3, 0.15, 1.6, 0.01, "m", "Its microphone's height above what it stands on"),
			new Prop("weighting", "Reads", "dB(A)", { kind: "choice", choices: Object.keys(WEIGHTINGS), help: "dB(A) weighs sounds as ears hear them; dB(Z) leaves them as they are" }),
			new Prop("response", "Response", "fast", { kind: "choice", choices: Object.keys(RESPONSES), help: "fast: 0.125 s; slow: 1 s" }),
			new Prop("room", "Quiet room level", 35.0, 0.0, 70.0, 1.0, "dB", "What it reads with nothing sounding (an empty classroom ≈ 35 dB [ANSI S12.60])"),
			new Prop("listen", "Listens", "in the air", { kind: "choice", choices: ["in the air", "touching"], help: "touching: pressed to the rod, rail or table it touches, it also hears what that solid carries" })
		],
		readouts: [
			new Readout("peak", "Loudest", { unit: "dB", digits: 1, help: "The highest reading so far" }),
			new Readout("level", "Reading", { unit: "dB", digits: 1, help: "What it reads now" }),
			new Readout("pitch", "Pitch heard", { unit: "Hz", digits: 1, help: "The note it hears most now (0: nothing over the room's level)" }),
			new Readout("heard", "First heard", { unit: "s", digits: 3, help: "When it first read 3 dB over the quiet room (−1: not yet)" }),
			new Readout("echo", "Echo after", { unit: "s", digits: 3, help: "How long after the first sound its first echo arrived (−1: none)" })
		],
		tags: ["sound meter", "decibel", "dB", "loudness", "microphone", "listener", "measure", "noise", "instrument", "ear"],
		description: "A sound level meter on a small tripod: the listener. It reads how loud it is where its microphone is (dB), the loudest so far, the pitch it " +
			"hears, when a sound first reached it and how long after it an echo came back. Sound gets 6 dB quieter for every doubling of distance.",
		source: "Levels by spherical spreading (−20·log10 r) along every path (Kinsler et al. 2000), A-weighting and fast/slow time weighting (IEC 61672-1); " +
			"speed of sound 331.3·√(1 + T/273.15) m/s in the room's air.",
		anchor: "the middle of the bottom of its tripod", facts: "dB(A), fast · quiet room 35 dB"
	}))
	register(new ItemType("hydrophone", "Hydrophone (underwater microphone)", CAT, build_hydrophone, {
		dynamic: false, module: "waves",
		props: [
			new Prop("probe_height", "Probe height", 0.08, 0.01, 0.8, 0.005, "m", "How high its probe hangs over what the stand stands on: put it under the water"),
			new Prop("reach", "Arm reach", 0.25, 0.05, 0.6, 0.01, "m", "How far the arm reaches out (to the right) over a tank's wall"),
			new Prop("arm_height", "Arm height", 0.4, 0.1, 1.2, 0.01, "m", "Over the tank's rim"),
			new Prop("weighting", "Reads", "dB(Z)", { kind: "choice", choices: Object.keys(WEIGHTINGS) }),
			new Prop("response", "Response", "fast", { kind: "choice", choices: Object.keys(RESPONSES) }),
			new Prop("room", "Quiet level", 30.0, 0.0, 70.0, 1.0, "dB", "What it reads with nothing sounding")
		],
		readouts: [
			new Readout("peak", "Loudest", { unit: "dB", digits: 1 }),
			new Readout("level", "Reading", { unit: "dB", digits: 1 }),
			new Readout("pitch", "Pitch heard", { unit: "Hz", digits: 1 }),
			new Readout("heard", "First heard", { unit: "s", digits: 3, help: "When it first read 3 dB over its quiet level (−1: not yet)" })
		],
		tags: ["hydrophone", "underwater", "water", "microphone", "sound in water", "listener", "medium"],
		description: "An underwater microphone hung from a lab stand's arm into a water tank (the Liquids module's). Under water it hears a sound " +
			"made in the same water straight through it, at 1481 m/s (over 4 × faster than in air); a sound from the air reaches it only " +
			"weakly, across the surface. Put the stand beside the tank and its probe under the water.",
		source: "Sound speed in fresh water 1481 m/s at 20 °C, sea water 1500 (Kinsler et al. 2000, App. A10); air to water: ≈ 0.1 % of the energy " +
			"crosses (−30 dB, provisional).",
		anchor: "the middle of the bottom of its stand", facts: "fresh water: 1481 m/s"
	}))
	register(new ItemType("oscilloscope", "Oscilloscope (sound wave screen)", CAT, build_scope, {
		dynamic: false, module: "waves",
		props: [
			new Prop("time_base", "Time a square", "1 ms a square", { kind: "choice", choices: Object.keys(SCOPE_TIME), help: "How long one square across the screen lasts (10 squares across): longer shows more waves" }),
			new Prop("scale", "Pressure a square", "0.1 Pa a square", { kind: "choice", choices: Object.keys(SCOPE_SCALE), help: "How much sound pressure one square up is: smaller draws the same sound taller" }),
			new Prop("mic_height", "Microphone height", 0.2, 0.05, 1.0, 0.01, "m", "Its microphone's height above what the scope stands on"),
			new Prop("mic_side", "Microphone at", "right", { kind: "choice", choices: ["right", "left"], help: "Which side of the scope its microphone stands, 21 cm from the scope's middle" }),
			new Prop("room", "Quiet room level", 35.0, 0.0, 70.0, 1.0, "dB", "What its microphone reads with nothing sounding")
		],
		readouts: [
			new Readout("peak", "Loudest", { unit: "dB", digits: 1, help: "The highest reading so far (flat, dB(Z))" }),
			new Readout("level", "Reading", { unit: "dB", digits: 1, help: "What it reads now" }),
			new Readout("pitch", "Pitch heard", { unit: "Hz", digits: 1, help: "The note it hears most now: how close its waves are (0: nothing over the room's level)" }),
			new Readout("heard", "First heard", { unit: "s", digits: 3, help: "When it first read 3 dB over the quiet room (−1: not yet)" })
		],
		tags: ["oscilloscope", "scope", "waveform", "sound wave", "amplitude", "frequency", "wavelength", "trace", "graph", "screen", "microphone", "loudness", "pitch", "listener"],
		description: "An oscilloscope with its microphone on a little stand beside it: its screen draws the sound wave the microphone hears, " +
			"pressure against time. A louder sound draws taller waves (a bigger amplitude); a higher sound draws them closer together " +
			"(more waves across: a higher frequency). Its microphone also reads like a sound meter (flat dB, fast).",
		source: "Sound pressure p = 20 µPa · 10^(L/20) rms, × √2 at a sine's peak (Kinsler et al. 2000); a bench oscilloscope's graticule of " +
			"10 × 8 squares.",
		anchor: "the middle of the bottom of the scope", facts: "1 ms a square · 0.1 Pa a square"
	}))
	register(new ItemType("sound-panel", "Sound panel", CAT, build_panel, {
		dynamic: false, module: "waves",
		props: [
			new Prop("height", "Height", 1.2, 0.2, 3.0, 0.01, "m"),
			new Prop("thickness", "Thickness", 0.05, 0.01, 0.2, 0.005, "m"),
			new Prop("surface", "Surface", "foam", { kind: "choice", choices: Object.keys(ABSORB), help: "How much sound it soaks up: foam most, then curtain, cork, carpet" })
		],
		tags: ["echo", "absorb", "foam", "curtain", "soundproof", "soft wall", "panel", "reflect"],
		description: "A soft panel that soaks up sound (acoustic foam, a curtain, carpet, cork) standing on the table or floor. A hard wall (the Wall item) " +
			"reflects sound back as an echo; this panel sends back little.",
		source: "Absorption coefficients at 500 Hz (Everest & Pohlmann 2009): foam ≈ 0.8, curtain 0.49, cork ≈ 0.2, carpet 0.14.",
		anchor: "the middle of its bottom", facts: "foam: takes in 80 % of the sound"
	}))
}

export const CARRIERS = { "steel-rod": ["rod"], "wooden-rod": ["rod"], "steel-beam": ["plank", "beam"], plank: ["plank"], table: ["top"] }
export const CARRIER_SPEED = {
	steel: [5050.0, "steel"], aluminium: [5150.0, "aluminium"], "varnished hardwood": [4000.0, "wood"], "domino wood": [4000.0, "wood"],
	"dark wood": [4000.0, "wood"], glass: [5170.0, "glass"], concrete: [3100.0, "concrete"]
}
const BUZZER_ON = ["sound", "sounding"]

function _build_hook(sb, scene) {
	void scene
	const items = [...sb.scene_items.values()]
	if (!sb.processes.some((p) => p.kind === "sound") && !items.some((i) => i.type === "buzzer")) return
	const type_of = new Map(items.map((i) => [i.id, i.type]))
	const touch = sb.processes.some((p) => p.kind === "sound" && p.role === "meter" && p.listen === "touch")
	const wet = sb.processes.some((p) => p.kind === "sound" && p.role === "meter" && p.listen === "water")
	const added = []
	if (wet) {
		for (const p of [...sb.processes]) {
			if (p.kind !== "liquid" || !(Array.isArray(p.layers) && p.layers.length)) continue
			let top = p.floor
			for (const layer of p.layers) top = top + layer.height
			const words = p.layers.map((layer) => String(layer.words ?? "")).join(" ")
			added.push({ kind: "sound", id: `${p.item}/underwater`, item: p.item, role: "water", x0: p.x0, x1: p.x1, floor: p.floor, top: R6(top), speed: words.includes("salt") || words.includes("sea") ? 1500.0 : 1481.0 })
		}
	}
	for (const s of sb.solids) {
		const t = type_of.get(s.item)
		const part = s.id.includes("/") ? s.id.slice(s.id.indexOf("/") + 1) : s.id
		if (t === "wall" && part === "wall" && !s.hidden_3d) {
			const h = s.body.height
			const P = props_of(sb.scene_items.get(s.item))
			added.push({
				kind: "sound", id: `${s.item}/echo`, item: s.item, role: "wall", solid: s.id, a: { x: 0.0, y: R6(-h / 2) }, b: { x: 0.0, y: R6(h / 2) },
				absorption: WALL_ABSORB[P.material] ?? 0.05
			})
		} else if (touch && s.body.kind === "slab" && t in CARRIERS && CARRIERS[t].includes(part)) {
			const w = s.body.width
			const h = s.body.height
			const P = props_of(sb.scene_items.get(s.item))
			const mat = P.material ?? "varnished hardwood"
			const [speed, label] = CARRIER_SPEED[mat] ?? [4000.0, "wood"]
			const long_x = w >= h
			const a = long_x ? { x: R6(-w / 2), y: 0.0 } : { x: 0.0, y: R6(-h / 2) }
			const b = long_x ? { x: R6(w / 2), y: 0.0 } : { x: 0.0, y: R6(h / 2) }
			added.push({ kind: "sound", id: `${s.item}/carry`, item: s.item, role: "carrier", solid: s.id, a, b, half: R6((long_x ? h : w) / 2), speed, gain: 10.0, material: label })
		}
	}
	for (const [iid, it] of sb.scene_items) {
		if (it.type !== "buzzer" || !("buzzer" in TYPES)) continue
		const sol = sb.solids.find((s) => s.item === iid)
		if (sol === undefined) continue
		const P = props_of(it)
		const key = ["tone", "pitch", "frequency", "tone_hz"].find((k) => typeof P[k] === "number")
		const f0 = key === undefined ? 2700.0 : P[key]
		added.push({
			kind: "sound", id: `${iid}/buzz`, item: iid, role: "buzzer", solid: sol.id, at: { x: 0.0, y: 0.0 }, f0: R6(f0),
			partials: [[1.0, 1.0, 0.02], [2.0, 0.3, 0.02], [3.0, 0.15, 0.02]], lp1: 65.0, on: [...BUZZER_ON]
		})
	}
	sb.processes.push(...added)
}

// ---------------------------------------------------------------- waves on a rope and a Slinky
export const END = { "tied to the post": "fixed", "ring on a pole": "free", "runs on (no reflection)": "open" }

function build_rope(c, P) {
	const L = P.length
	const h = P.height
	const flat = P.lying === "on the floor"
	const y = flat ? 0.02 : h
	c.slab("driver", 0.08, y + 0.04, 0.08, -0.04, (y + 0.04) / 2, { kind: "static", words: "a wave driver on a post", look: "dark wood", material: wood(c) })
	c.slab("post", 0.04, y + 0.06, 0.04, L + 0.02, (y + 0.06) / 2, { kind: "static", words: "a post holding the rope's far end", look: "dark wood", material: wood(c) })
	const mass = P.weight * L
	// (one segment every 2.5 cm, and at least 10 to a wavelength of its shake, up to 800)
	const v = Math.sqrt(P.tension / P.weight)
	const n = Math.trunc(Math.max(Math.min(240, Math.max(40, pyRound(L / 0.025, 0))), Math.min(800, Math.ceil((10 * L * P.frequency) / v))))
	const ribbon = P.ribbon
	const [ax, ay] = c.world(0.0, y)
	const [bx, by] = c.world(L, y)
	// (its diameter from its weight, ≈ 1000 kg/m³ of fibres and air: it lies on what its posts stand on; the air's drag ½·ρ·C_d·d per metre)
	const d = Math.sqrt((4 * P.weight) / (Math.PI * 1000.0))
	const fields = {
		line: "rope", a: { x: R6(ax), y: R6(ay) }, b: { x: R6(bx), y: R6(by) }, n, mass: R6(mass), tension: R6(P.tension), stiffness: R6((2000.0 * 4.0) / L),
		plane: flat ? "flat" : "vertical", damping: R6(P.damping),
		drive: { mode: P.shake === "keep shaking" ? "wave" : "pulse", dir: "across", amp: R6(P.amplitude), f: R6(P.frequency), at: R6(P.shake_at), cycles: Math.trunc(P.cycles) },
		end: END[P.far_end], keep: 40, floor: R6(c.oy + d / 2)
	}
	if (c.settings.air) fields.drag = R6((0.5 * 1.204 * 1.2 * d) / P.weight)
	if (ribbon > 0) fields.ribbon = R6(ribbon)
	c.process("wave-line", "wave", fields)
}

function build_slinky(c, P) {
	const L = P.length
	const flat = P.lying === "on the floor"
	const y = flat ? 0.035 : P.height
	c.slab("driver", 0.08, y + 0.04, 0.08, -0.04, (y + 0.04) / 2, { kind: "static", words: "a wave driver holding the Slinky's end", look: "dark wood", material: wood(c) })
	c.slab("post", 0.04, y + 0.06, 0.04, L + 0.02, (y + 0.06) / 2, { kind: "static", words: "a post holding the Slinky's far end", look: "dark wood", material: wood(c) })
	const k = P.stiffness
	const m = P.spring_mass
	const T = k * (L - 0.06)
	const along = P.push === "push and pull"
	const [ax, ay] = c.world(0.0, y)
	const [bx, by] = c.world(L, y)
	const fields = {
		line: "slinky", a: { x: R6(ax), y: R6(ay) }, b: { x: R6(bx), y: R6(by) }, n: 80, mass: R6(m), tension: R6(T), stiffness: R6(k),
		plane: flat ? "flat" : "vertical", damping: R6(P.damping),
		drive: { mode: P.shake === "keep shaking" ? "wave" : "pulse", dir: along ? "along" : "across", amp: R6(P.amplitude), f: R6(P.frequency), at: R6(P.shake_at), cycles: Math.trunc(P.cycles) },
		end: END[P.far_end], keep: 40, floor: R6(c.oy + 0.0335), closed: 0.06
	}
	if (P.ribbon > 0) fields.ribbon = R6(P.ribbon)
	c.process("wave-line", "wave", fields)
}

const LINE_READOUTS = () => [
	new Readout("speed", "Wave speed", { unit: "m/s", digits: 2, help: "How fast a wave runs along it" }),
	new Readout("wavelength", "Wavelength", { unit: "m", digits: 3, help: "speed ÷ frequency" }),
	new Readout("frequency", "Frequency", { unit: "Hz", digits: 2, help: "How many shakes a second" }),
	new Readout("arrive", "Reached the far end", { unit: "s", digits: 3, help: "When the wave first got to the far end (−1: not yet)" }),
	new Readout("reflection", "Came back", { unit: "", digits: 0, help: "−1 upside down, 1 the same way up, 0 nothing came back, −2 not yet" }),
	new Readout("loops", "Standing loops", { unit: "", digits: 0, help: "Loops of a standing wave over the last second (keep shaking)" }),
	new Readout("ribbon_across_mm", "Ribbon up-down", { unit: "mm", digits: 1, help: "How far the ribbon moved across (sideways or up and down)" }),
	new Readout("ribbon_along_mm", "Ribbon along", { unit: "mm", digits: 1, help: "How far the ribbon moved along the line" })
]

function _wave_lines() {
	const shake = () => [
		new Prop("shake", "Shake", "one pulse", { kind: "choice", choices: ["one pulse", "keep shaking"] }),
		new Prop("frequency", "Frequency", 3.0, 0.2, 20.0, 0.05, "Hz", "Shakes per second (a pulse lasts one shake). A tied line shows n standing loops at f = n·v/(2L)"),
		new Prop("amplitude", "Amplitude", 0.08, 0.005, 0.3, 0.005, "m", "How far the end is moved"),
		new Prop("shake_at", "Shake at", 0.5, 0.0, 20.0, 0.05, "s"),
		new Prop("cycles", "Shakes", 0, 0, 100, 1, "", "keep shaking: how many (0 = until the end)", { kind: "int" }),
		new Prop("far_end", "Far end", "tied to the post", { kind: "choice", choices: Object.keys(END), help: "tied: a pulse comes back upside down; a ring on a pole: the same way up; runs on: nothing comes back (those two on a line lying on the floor: held up, its free end hangs onto the table)" }),
		new Prop("ribbon", "Ribbon at", 0.5, 0.0, 1.0, 0.01, "", "Where along it a ribbon is tied (0 = no ribbon): watch it move without going anywhere"),
		new Prop("damping", "Losses", 1.5, 0.0, 5.0, 0.05, "1/s", "How fast its motion dies away: 1.5 is a real rope's (a standing wave settles in a few seconds, Q ≈ 10); 0 never settles")
	]
	register(new ItemType("wave-rope", "Wave rope", CAT, build_rope, {
		dynamic: false, module: "waves",
		props: [
			new Prop("length", "Length", 4.0, 1.0, 8.0, 0.05, "m"),
			new Prop("tension", "Tension", 10.0, 1.0, 100.0, 0.5, "N", "Pulled tighter = faster waves"),
			new Prop("weight", "Weight per metre", 0.1, 0.02, 1.0, 0.01, "kg/m", "A heavier rope carries slower waves (v = √(T/μ))"),
			new Prop("height", "Height", 0.6, 0.1, 1.5, 0.01, "m", "How high it is held"),
			new Prop("lying", "Lying", "held up", { kind: "choice", choices: ["held up", "on the floor"], help: "held up: it waves up and down; on the floor: side to side" }),
			...shake()
		],
		readouts: LINE_READOUTS(),
		tags: ["wave", "rope", "pulse", "transverse", "standing wave", "reflection", "wavelength", "frequency", "amplitude", "energy"],
		description: "A long rope pulled tight between a wave driver (left) and a post (right). The driver flicks one pulse or keeps shaking; the wave runs along " +
			"at √(tension ÷ weight per metre), reflects at the far end, and a ribbon tied on it only moves up and down: the wave carries energy, not the rope.",
		source: "v = √(T/μ) (Kinsler et al. 2000); a line of masses on the rope's tension, stepped by the module; standing waves at f_n = n·v/(2L).",
		anchor: "the bottom of the driver's post (the rope runs to the right)", facts: "4 m · 10 N · 0.1 kg/m → 10 m/s"
	}))
	register(new ItemType("slinky", "Slinky", CAT, build_slinky, {
		dynamic: false, module: "waves",
		props: [
			new Prop("length", "Stretched to", 3.0, 1.0, 6.0, 0.05, "m"),
			new Prop("spring_mass", "Mass", 0.2, 0.05, 0.6, 0.01, "kg", "The whole Slinky's mass"),
			new Prop("stiffness", "Spring constant", 1.0, 0.2, 5.0, 0.05, "N/m", "For the whole spring: stiffer = faster waves"),
			new Prop("push", "Moved", "push and pull", { kind: "choice", choices: ["push and pull", "side to side"], help: "push and pull: squeezes run along it (longitudinal, like sound); side to side: a transverse wave" }),
			new Prop("height", "Height", 0.5, 0.1, 1.5, 0.01, "m", "When held up"),
			new Prop("lying", "Lying", "on the floor", { kind: "choice", choices: ["on the floor", "held up"] }),
			...shake()
		],
		readouts: LINE_READOUTS(),
		tags: ["slinky", "spring", "wave", "longitudinal", "compression", "transverse", "pulse", "sound model"],
		description: "A metal Slinky stretched on the floor between a driver and a post. Pushed and pulled, squeezes (compressions) run along it like sound in " +
			"air; shaken side to side, a transverse wave runs along. Waves run at L·√(k/m).",
		source: "v = L·√(k/m) for a stretched Slinky (spring constant k of the whole spring, mass m); metal Slinky 0.2 kg, ≈ 80 turns, k ≈ 1 N/m (provisional).",
		anchor: "the bottom of the driver (the Slinky runs to the right)", facts: "3 m · 0.2 kg · k 1 N/m → 6.7 m/s"
	}))
}

// ---------------------------------------------------------------- the ripple tank
function build_tank(c, P) {
	// (water stays level: the tray is kept level however the item is turned, as a pendulum's hanger is)
	c.ca = 1.0
	c.sa = 0.0
	c.a = 0.0
	const L = P.length
	const W = P.width
	const d = P.depth
	const wall = 0.01
	const stand = 0.05
	c.slab("base", L + 2 * wall, 0.006, W + 2 * wall, 0.0, stand + 0.003, { kind: "static", words: "the ripple tank's glass bottom", look: "glass", material: c.mat({ base: "glass", overrides: {} }) })
	for (const side of [-1, 1]) {
		const nm = side < 0 ? "left" : "right"
		c.slab(`end-${nm}`, wall, 0.05, W + 2 * wall, side * (L / 2 + wall / 2), stand + 0.006 + 0.025, { kind: "static", words: "the tank's end wall", look: "plastic", material: c.mat({ base: "ABS plastic", overrides: {} }) })
		c.slab(`leg-${nm}`, 0.03, stand, W, side * (L / 2 - 0.02), stand / 2, { kind: "static", words: "the tank's leg", look: "steel", material: steel(c) })
	}
	const [x0, y0] = c.world(-L / 2, stand + 0.006 + d)
	const [x1] = c.world(L / 2, stand + 0.006 + d)
	const sx = x0 + P.dipper_at * (x1 - x0)
	const fields = {
		x0: R6(x0), x1: R6(x1), y: R6(y0), width: R6(W), depth: R6(d), f: R6(P.frequency), amp: R6(P.amplitude / 1000), at: R6(P.start_at),
		source: P.dipper === "point" ? "point" : "bar", sx: R6(sx), near: "beach", far: P.far_end === "wall" ? "wall" : "beach"
	}
	if (P.floater !== "none") {
		fields.floater = R6(x0 + P.floater_at * (x1 - x0))
		fields.floater_kind = P.floater
	}
	c.process("ripples", "water", fields)
}

function _tank() {
	register(new ItemType("ripple-tank", "Ripple tank", CAT, build_tank, {
		dynamic: false, module: "waves",
		props: [
			new Prop("length", "Length", 0.6, 0.3, 1.2, 0.01, "m"),
			new Prop("width", "Width (front to back)", 0.4, 0.2, 0.8, 0.01, "m"),
			new Prop("depth", "Water depth", 0.01, 0.005, 0.03, 0.001, "m", "Deeper water: faster, longer waves"),
			new Prop("frequency", "Dipper frequency", 5.0, 2.0, 20.0, 0.1, "Hz", "Faster dipping = shorter waves (v = f·λ)"),
			new Prop("amplitude", "Dipper amplitude", 1.5, 0.5, 5.0, 0.1, "mm", "How far the dipper bobs: bigger waves carry more energy"),
			new Prop("dipper", "Dipper", "point", { kind: "choice", choices: ["point", "bar"], help: "point: circles spread out; bar: straight waves" }),
			new Prop("dipper_at", "Dipper at", 0.1, 0.02, 0.98, 0.01, "", "Where along the tank (0 = left end)"),
			new Prop("far_end", "Far end", "beach", { kind: "choice", choices: ["beach", "wall"], help: "wall: the waves reflect; beach: soaked up" }),
			new Prop("floater", "Floating", "duck", { kind: "choice", choices: ["none", "cork", "duck"], help: "A small floating toy that rides the waves" }),
			new Prop("floater_at", "Floating at", 0.6, 0.05, 0.95, 0.01, "", "Where along the tank it floats"),
			new Prop("start_at", "Starts at", 0.5, 0.0, 20.0, 0.05, "s")
		],
		readouts: [
			new Readout("wavelength", "Wavelength", { unit: "m", digits: 4 }),
			new Readout("speed", "Wave speed", { unit: "m/s", digits: 3 }),
			new Readout("frequency", "Frequency", { unit: "Hz", digits: 2 }),
			new Readout("reach", "Reached the far end", { unit: "s", digits: 2, help: "When the first waves reached the far end (−1: not yet)" }),
			new Readout("floater_bob_mm", "Floater bobs", { unit: "mm", digits: 2, help: "How far the floater rises and falls over one wave" }),
			new Readout("floater_drift", "Floater drift", { unit: "m", digits: 4, help: "How far the floater has drifted on average (it bobs in place)" })
		],
		tags: ["ripple", "water wave", "wave", "tank", "duck", "cork", "wavelength", "frequency", "energy", "floating"],
		description: "A shallow glass-bottomed tray of water with a motor-driven dipper at one end. The dipper's ripples run across the water; a floating duck or " +
			"cork bobs up and down where it is while the waves pass (waves carry energy, not the water).",
		source: "Linear water waves ω² = (gk + σk³/ρ)·tanh(kh) (Lamb, Hydrodynamics 1932, §267; σ 0.0728 N/m), viscous decay 2νk²/c_g (Lamb §348); " +
			"a floater follows the water's orbit (A·coth(kh) along, A up).",
		anchor: "the middle of the bottom of its legs", facts: "1 cm deep · 5 Hz → λ ≈ 5.6 cm"
	}))
}

// ---------------------------------------------------------------- string telephone (engine6 crossmod; machines/mod_waves.py the same)
export const PHONE_STRINGS = { "cotton string": [0.001, 764.0, 2e9, 0.08], "fishing line": [0.0005, 1140.0, 3e9, 0.03], wire: [0.0003, 7850.0, 200e9, 0.001] }
export const VOICES = { none: 0.0, whisper: 40.0, quiet: 52.0, normal: 62.0, loud: 75.0, shout: 82.0 }
export const PHONE_CUP = { h: 0.09, mouth: 0.076, r: 0.0265, m: 0.00066, f: 590.0, v: 0.000266 }
const WHISPER_PARTIALS = [[1.0, 1.0, 0.03], [1.5, 0.9, 0.03], [2.0, 0.8, 0.03], [2.5, 0.6, 0.03], [3.0, 0.45, 0.03], [4.0, 0.3, 0.03]]
const VOICE_PARTIALS = [[1.0, 1.0, 0.03], [2.0, 1.0, 0.03], [3.0, 0.8, 0.03], [4.0, 0.6, 0.03], [5.0, 0.5, 0.03], [6.0, 0.4, 0.03], [8.0, 0.25, 0.03],
	[10.0, 0.18, 0.03], [12.0, 0.12, 0.03], [15.0, 0.08, 0.03]]

/** A string telephone's sag (m) and the distance between its cups' bottoms (m) for its props under gravity g, held at height y (the builder's). */
export function phone_shape(L, T, string, g, y) {
	const [d, rho] = PHONE_STRINGS[string] ?? PHONE_STRINGS["cotton string"]
	const w = ((rho * ((Math.PI * d * d) / 4)) * g)
	let sag = Math.min(0.15 * L, Math.max(0.005, y - 0.005))
	if (T > 0) sag = Math.min(sag, (((w * L) * L) / (8 * T)))
	return { sag, D: L - (((8 * sag) * sag) / (3 * L)) }
}

function build_telephone(c, P) {
	c.ca = 1.0
	c.sa = 0.0
	c.a = 0.0
	const L = P.length
	const T = P.pull
	const [d, rho, E, eta] = PHONE_STRINGS[P.string]
	const { sag, D } = phone_shape(L, T, P.string, c.settings.gravity, c.oy)
	const H = PHONE_CUP.h
	const M = PHONE_CUP.mouth
	const ghost = () => ({ kind: "static", material: c.mat({ base: "hollow plastic", overrides: {} }) })
	const talk = c.slab("cup-talk", H, M, M, -D / 2 - H / 2, 0.0, { ...ghost(), look: "paper cup", words: "a paper cup to talk into", ghost: true, stand: "self" })
	c.slab("cup-listen", H, M, M, D / 2 + H / 2, 0.0, { ...ghost(), look: "paper cup", words: "a paper cup to listen at", ghost: true, stand: "self" })
	// (its sag rides on the string's solid for the view, which draws it hanging so: render only)
	const line = c.slab("string", Math.max(0.01, D), 0.004, 0.004, 0.0, 0.0, {
		...ghost(), look: P.string === "wire" ? "steel" : "string",
		words: T > 0 ? `a ${P.string} pulled between the cups` : `a slack ${P.string} between the cups`, sag: R6(sag), ghost: true, stand: "self"
	})
	const lp1 = VOICES[P.voice]
	if (lp1 > 0) {
		const whisper = P.voice === "whisper"
		_source(c, talk, [-H / 2, 0.0], whisper ? 1000.0 : 220.0, whisper ? WHISPER_PARTIALS : VOICE_PARTIALS, lp1, [[R6(P.talk_at), 1.0]], 0.0, { hold: P.talk_for, show: P.show_waves, part: "voice" })
	}
	c.process("sound", "line", {
		role: "telephone", solid: line, a: { x: R6(-D / 2 - H), y: 0.0 }, b: { x: R6(D / 2 + H), y: 0.0 }, length: R6(L),
		diameter: d, rho, E, eta, tension: R6(T), pinched: !!P.pinched,
		cup: { r: PHONE_CUP.r, m: PHONE_CUP.m, f: PHONE_CUP.f, v: PHONE_CUP.v }, reach: 0.5, sag: R6(sag)
	})
}

function _telephone() {
	add_look("paper cup", { fill: "#f3efe6", shade: "#c9c2b3", roughness: 0.75, metalness: 0.0, clearcoat: 0.0 })
	add_look("string", { fill: "#e9dfc6", shade: "#b9ad91", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	register(new ItemType("string-telephone", "String telephone", CAT, build_telephone, {
		dynamic: false, module: "waves",
		props: [
			new Prop("length", "String length", 3.0, 0.5, 20.0, 0.05, "m", "From one cup's bottom to the other's"),
			new Prop("pull", "Pull on the string", 5.0, 0.0, 30.0, 0.05, "N",
				"How hard the two pull the cups apart: 2-10 N keeps it taut; under about 0.2 N it droops and carries little; 0: slack, it hangs loose and carries nothing"),
			new Prop("pinched", "Pinched", false, { kind: "bool", help: "A finger and thumb pinch the string: it cannot vibrate past them, so nothing gets through" }),
			new Prop("string", "String", "cotton string", { kind: "choice", choices: Object.keys(PHONE_STRINGS), help: "cotton string 1 mm; nylon fishing line 0.5 mm; steel wire 0.3 mm (carries the most)" }),
			new Prop("voice", "Talks", "whisper", {
				kind: "choice", choices: Object.keys(VOICES),
				help: "How loud the child talks into the left cup (1 m away: a whisper about 40 dB, quiet 52, normal 62, loud 75, a shout 82); none: no one talks (put a speaker or a fork at the cup)"
			}),
			new Prop("talk_at", "Talks at", 0.5, 0.0, 20.0, 0.05, "s"),
			new Prop("talk_for", "Talks for", 2.0, 0.2, 20.0, 0.05, "s"),
			new Prop("show_waves", "Sound lines", true, { kind: "bool", help: "Faint arcs spreading from the talking cup while the child talks" })
		],
		readouts: [
			...SOURCE_READOUTS(),
			new Readout("carries", "Carries sound", { unit: "", digits: 0, help: "Whether the string carries sound (taut, not pinched)", words: { 0: "no", 1: "yes" } }),
			new Readout("sag_mm", "String sag", { unit: "mm", digits: 0, help: "How far its middle hangs below a straight line" }),
			new Readout("loss_db", "Lost cup to cup", { unit: "dB", digits: 1, help: "How much quieter it is at an ear held to the far cup than at the talking cup's mouth (at 1 kHz)" }),
			new Readout("string_ms", "Speed along the string", { unit: "m/s", digits: 0, help: "How fast the sound runs along the string" })
		],
		tags: ["string telephone", "tin can telephone", "cup telephone", "cup phone", "telephone", "string", "sound travels", "vibration",
			"medium", "solid", "cups", "talk", "whisper", "taut", "slack"],
		description: "A string telephone: two paper cups joined by a string between their bottoms, held level and pulled apart. A child talks " +
			"(or whispers) into the left cup; pulled taut, the string carries the vibration along it to the right cup, where an ear (a " +
			"sound meter's microphone put at that cup's mouth) hears it far better than through the air. Slack or pinched, it carries " +
			"nothing: only the air brings the voice, much fainter.",
		source: "A sagging string's equivalent modulus [ERNST]; a lumped cup-string-cup model at 1 kHz (provisional): 9 oz paper cups (bottom Ø 53 mm, " +
			"0.66 g, its own resonance near 590 Hz), cotton string 1 mm (0.6 g/m, about 2 GPa, loss factor 0.08), nylon fishing line 0.5 mm " +
			"(3 GPa [CRC], 0.03), steel wire 0.3 mm (200 GPa [CRC], 0.001); a voice 1 m away: whisper about 40 dB (provisional), quiet 52 " +
			"[PEARSONS], normal 62, loud 75, shout 82 dB [ANSI-S35].",
		anchor: "the middle of its string, at the cups' height", facts: "3 m of cotton string, pulled with 5 N: about 24 dB down cup to cup",
		edit: [{ kind: "length", prop: "length" }]
	}))
}

// ---------------------------------------------------------------- goal kinds (machines/mod_waves.py has the same, number for number)
const isNum = (v) => typeof v === "number" && Number.isFinite(v)
const _last = (v) => (Array.isArray(v) && v.length ? v[v.length - 1] : null)
function _max(v) {
	let best = null
	for (const x of v ?? []) if (isNum(x) && (best === null || x > best)) best = x
	return best
}
function _src_of(ctx, g) {
	for (const key of ["source", "item", "buzzer"]) if (ctx.known(g[key])) return g[key]
	return null
}
function _pitch_of(ctx, iid) {
	const p = _last(ctx.state(iid, "pitch"))
	return isNum(p) ? p : null
}
function _sounded(ctx, iid) {
	let t = ctx.first_time(iid, "struck", (v) => v >= 1)
	if (t === null) t = ctx.first_time(iid, "sound_db", (v) => v > 0)
	return t
}
const _trim = (v, d = 2) => {
	const t = fmtF(v, d)
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t
}
const lbl = (g, text) => (typeof g.label === "string" && g.label ? g.label : text)
const r = (v, d) => (v === null ? null : pyRound(v, d))

export function goal_sounds(ctx, g) {
	const iid = _src_of(ctx, g)
	if (iid === null) return null
	const t = _sounded(ctx, iid)
	const pitch = _pitch_of(ctx, iid)
	const db = _max(ctx.state(iid, "sounding")) || _max(ctx.state(iid, "sound_db")) || 0.0
	const want = ctx.num(g.pitch_hz)
	let tol = ctx.num(g.tol_hz)
	const least = ctx.num(g.at_least_db)
	let ok = t !== null
	if (want !== null) {
		tol = tol === null ? Math.abs(want) * 0.02 : tol
		ok = ok && pitch !== null && Math.abs(pitch - want) <= tol
	}
	if (least !== null) ok = ok && db >= least
	const extra = (want !== null ? ` at ${_trim(want, 1)} Hz` : "") + (least !== null ? `, at least ${_trim(least, 1)} dB 1 m away` : "")
	return { label: lbl(g, `${ctx.name(iid)} sounds${extra}`), ok: !!ok, kind: "sounds", item: iid, pitch: r(pitch, 1), db: pyRound(db, 1), t: r(t, 3) }
}

export function goal_higher(ctx, g) {
	const a = g.a
	const b = g.b
	if (!(ctx.known(a) && ctx.known(b))) return null
	const pa = _pitch_of(ctx, a)
	const pb = _pitch_of(ctx, b)
	const ok = pa !== null && pb !== null && _sounded(ctx, a) !== null && _sounded(ctx, b) !== null && pa > pb
	return { label: lbl(g, `${ctx.name(a)} sounds higher than ${ctx.name(b)}`), ok: !!ok, kind: "higher", a, b, pitch_a: r(pa, 1), pitch_b: r(pb, 1) }
}

function _loudness(ctx, x, at) {
	if (ctx.state(x, "peak") !== null && at === null) return _max(ctx.state(x, "peak"))
	if (at !== null) return _max(ctx.state(at, `peak:${x}`))
	return _max(ctx.state(x, "sounding"))
}

export function goal_louder(ctx, g) {
	const a = g.a
	const b = g.b
	const at = ctx.known(g.at) ? g.at : null
	if (!(ctx.known(a) && ctx.known(b))) return null
	const la = _loudness(ctx, a, at)
	const lb = _loudness(ctx, b, at)
	const ok = la !== null && lb !== null && la > lb
	const where = at !== null ? ` at ${ctx.name(at)}` : ""
	return { label: lbl(g, `${ctx.name(a)} is louder than ${ctx.name(b)}${where}`), ok: !!ok, kind: "louder", a, b, db_a: r(la, 1), db_b: r(lb, 1) }
}

export function goal_hears(ctx, g) {
	const m = g.meter
	const s = g.source
	if (!(ctx.known(m) && ctx.known(s))) return null
	const peak = _max(ctx.state(m, `peak:${s}`))
	const at = _last(ctx.state(m, `at:${s}`))
	const room = ctx.state(m, "level")
	const floor = room && room.length ? room[0] : 35.0
	const least = ctx.num(g.at_least_db)
	const need = least === null ? floor : least
	const ok = peak !== null && at !== null && at >= 0 && peak >= need
	// (expect false: it does not hear it: a slack string telephone's far cup; engine6 crossmod)
	if (g.expect === false)
		return {
			label: lbl(g, `${ctx.name(m)} does not hear ${ctx.name(s)}` + (least !== null ? ` at ${_trim(least, 1)} dB or more` : "")),
			ok: !ok, kind: "hears", meter: m, source: s, db: r(peak, 1), t: at === null || at < 0 ? null : pyRound(at, 4)
		}
	return {
		label: lbl(g, `${ctx.name(m)} hears ${ctx.name(s)}` + (least !== null ? ` at ${_trim(least, 1)} dB or more` : "")),
		ok: !!ok, kind: "hears", meter: m, source: s, db: r(peak, 1), t: at === null || at < 0 ? null : pyRound(at, 4)
	}
}

export function goal_echo(ctx, g) {
	const m = g.meter
	if (!ctx.known(m)) return null
	const d = _last(ctx.state(m, "echo"))
	const want = ctx.num(g.delay_s)
	let tol = ctx.num(g.tol)
	tol = tol === null ? 0.005 : tol
	const ok = d !== null && d >= 0 && (want === null || Math.abs(d - want) <= tol)
	return {
		label: lbl(g, `${ctx.name(m)} hears an echo` + (want !== null ? ` ${_trim(want, 3)} s after the sound` : "")), ok: !!ok, kind: "echo", meter: m,
		delay: d === null || d < 0 ? null : pyRound(d, 4)
	}
}

export function goal_reaches(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const x = ctx.num(g.x)
	let t = null
	if (ctx.state(iid, "arrive") !== null) {
		if (x === null) {
			const v = _last(ctx.state(iid, "arrive"))
			t = isNum(v) && v >= 0 ? v : null
		} else {
			const P = props_of(ctx.items.get(iid))
			const st = (ctx.track.state ?? {})[iid] ?? {}
			const keys = Object.keys(st).filter((k) => k.slice(0, 1) === "d" && /^\d+$/.test(k.slice(1))).sort((p, q) => Number(p.slice(1)) - Number(q.slice(1)))
			if (keys.length) {
				const L = P.length ?? 1.0
				const k = Math.min(keys.length - 1, Math.max(0, Math.trunc(pyRound((x / L) * (keys.length - 1), 0))))
				const amp = P.amplitude ?? 0.05
				const base = (ctx.state(iid, keys[k]) ?? [0.0])[0]
				t = ctx.first_time(iid, keys[k], (v) => Math.abs(v - base) > 0.05 * amp)
			}
		}
	} else if (ctx.state(iid, "reach") !== null) {
		const v = _last(ctx.state(iid, "reach"))
		t = isNum(v) && v >= 0 ? v : null
	}
	const by = ctx.num(g.before_s)
	const where = x !== null ? `${_trim(x, 2)} m along` : "the far end"
	const when = by === null ? "" : ` by ${_trim(by)} s`
	return { label: lbl(g, `the wave on ${ctx.name(iid)} reaches ${where}${when}`), ok: t !== null && (by === null || t <= by), kind: "wave_reaches", item: iid, t: r(t, 3) }
}

export function swing_period(times, xs) {
	if (xs.length < 3) return null
	let lo = xs[0]
	let hi = xs[0]
	for (const v of xs) {
		if (v < lo) lo = v
		if (v > hi) hi = v
	}
	if (hi - lo < 1e-4) return null
	const mid = (lo + hi) / 2
	const ups = []
	for (let i = 1; i < xs.length; i++) {
		const a = xs[i - 1] - mid
		const b = xs[i] - mid
		if (a < 0 && 0 <= b && b !== a) ups.push(times[i - 1] + ((times[i] - times[i - 1]) * -a) / (b - a))
	}
	if (ups.length < 2) return null
	return (ups[ups.length - 1] - ups[0]) / (ups.length - 1)
}

export function goal_period(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	const sol = ctx.solids(iid, true)
	let per = null
	if (sol.length) {
		const sid = sol[sol.length - 1].id
		const fr = ctx.frames.filter((f) => sid in f.placements)
		const xs = fr.map((f) => f.placements[sid].x)
		const ys = fr.map((f) => f.placements[sid].y)
		const T = fr.map((f) => f.t)
		const span = (v) => {
			let lo = v[0]
			let hi = v[0]
			for (const q of v) {
				if (q < lo) lo = q
				if (q > hi) hi = q
			}
			return hi - lo
		}
		const use = xs.length && ys.length && span(ys) > span(xs) ? ys : xs
		per = swing_period(T, use)
	}
	const want = ctx.num(g.seconds)
	const tol = ctx.num(g.tol)
	const ok = per !== null && (want === null || Math.abs(per - want) <= (tol === null ? Math.abs(want) * 0.02 : tol))
	return {
		label: lbl(g, `${ctx.name(iid)} swings` + (want !== null ? ` once every ${_trim(want)} s` : "")), ok: !!ok, kind: "period", item: iid,
		period: r(per, 4), frequency: per === null || per <= 0 ? null : pyRound(1 / per, 4)
	}
}

export function goal_jumps(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let least = ctx.num(g.min_m)
	least = least === null ? 0.005 : least
	let best = 0.0
	for (const s of ctx.solids(iid, true)) {
		const sid = s.id
		let y0 = null
		for (const f of ctx.frames) {
			const p = f.placements[sid]
			if (p === undefined) continue
			if (y0 === null) y0 = p.y
			best = Math.max(best, p.y - y0)
		}
	}
	return { label: lbl(g, `${ctx.name(iid)} jumps at least ${ctx.short_m(least)}`), ok: best >= least, kind: "jumps", item: iid, rise_m: pyRound(best, 4) }
}

const REFLECTIONS = { "-1": "upside down", 1: "the same way up", 0: "not at all" }

export function goal_reflects(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "reflection") === null) return null
	const r = _last(ctx.state(iid, "reflection"))
	const way = typeof g.way === "string" ? g.way : null
	const want = { "upside down": -1, "same way up": 1, none: 0 }[way] ?? null
	const ok = r !== null && r !== -2 && (want === null ? r !== 0 : r === want)
	const said = { "upside down": "comes back upside down", "same way up": "comes back the same way up", none: "does not come back" }[way] ?? "comes back from its far end"
	return { label: lbl(g, `the pulse on ${ctx.name(iid)} ${said}`), ok: !!ok, kind: "reflects", item: iid, reflection: r === null || r === -2 ? null : REFLECTIONS[String(Math.trunc(r))] ?? "not yet" }
}

export function goal_standing(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "loops") === null) return null
	const n = _last(ctx.state(iid, "loops"))
	const want = ctx.num(g.loops)
	const ok = isNum(n) && n >= 1 && (want === null || n === want)
	const said = want === null ? `a standing wave forms on ${ctx.name(iid)}` : `a standing wave with ${_trim(want, 0)} loop${want === 1 ? "" : "s"} on ${ctx.name(iid)}`
	return { label: lbl(g, said), ok: !!ok, kind: "standing", item: iid, loops: n === null ? null : Math.trunc(n) }
}

const _near = (v, want, tol, share = 0.05) => Math.abs(v - want) <= (tol === null ? Math.abs(want) * share : tol)

export function goal_wavelength(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "wavelength") === null) return null
	const lam = _last(ctx.state(iid, "wavelength"))
	const want = ctx.num(g.m)
	const ok = isNum(lam) && lam > 0 && (want === null || _near(lam, want, ctx.num(g.tol)))
	const said = want !== null ? `the waves on ${ctx.name(iid)} are ${ctx.short_m(want)} long` : `${ctx.name(iid)} carries waves`
	return { label: lbl(g, said), ok: !!ok, kind: "wavelength", item: iid, wavelength_m: isNum(lam) ? pyRound(lam, 4) : null }
}

export function goal_wave_speed(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid) || ctx.state(iid, "speed") === null || ctx.state(iid, "wavelength") === null) return null
	const v = _last(ctx.state(iid, "speed"))
	const want = ctx.num(g.m_s)
	const ok = isNum(v) && v > 0 && (want === null || _near(v, want, ctx.num(g.tol)))
	const said = want !== null ? `the waves on ${ctx.name(iid)} run at ${_trim(want, 2)} m/s` : `waves run along ${ctx.name(iid)}`
	return { label: lbl(g, said), ok: !!ok, kind: "wave_speed", item: iid, speed_m_s: isNum(v) ? pyRound(v, 4) : null }
}

function _most_abs(v) {
	let best = null
	for (const x of v ?? []) if (isNum(x) && (best === null || Math.abs(x) > best)) best = Math.abs(x)
	return best
}

export function goal_stays_put(ctx, g) {
	const iid = g.item
	if (!ctx.known(iid)) return null
	let least = ctx.num(g.min_bob_mm)
	least = least === null ? 0.5 : least
	let most = ctx.num(g.max_drift_m)
	most = most === null ? 0.01 : most
	let bob
	let drift
	let what
	const it = ctx.items.get(iid)
	if (ctx.state(iid, "floater_bob_mm") !== null) {
		bob = _max(ctx.state(iid, "floater_bob_mm"))
		drift = _most_abs(ctx.state(iid, "floater_drift"))
		what = props_of(it).floater ?? "floater"
	} else if (ctx.state(iid, "ribbon_across_mm") !== null) {
		const P = props_of(it)
		const pushed = it.type === "slinky" && P.push === "push and pull"
		bob = _last(ctx.state(iid, pushed ? "ribbon_along_mm" : "ribbon_across_mm"))
		drift = pushed ? 0.0 : (_last(ctx.state(iid, "ribbon_along_mm")) || 0.0) / 1000
		what = "ribbon"
	} else return null
	const ok = bob !== null && drift !== null && bob >= least && drift <= most
	return { label: lbl(g, `the ${what} on ${ctx.name(iid)} bobs but stays put`), ok: !!ok, kind: "stays_put", item: iid, bob_mm: r(bob, 2), drift_m: r(drift, 5) }
}

export function goal_trace(ctx, g) {
	const iid = ["oscilloscope", "item"].map((k) => g[k]).find((v) => ctx.known(v)) ?? null
	if (iid === null || ctx.items.get(iid)?.type !== "oscilloscope") return null
	const P = props_of(ctx.items.get(iid))
	const tb = SCOPE_TIME[P.time_base] ?? 0.001
	const pa = SCOPE_SCALE[P.scale] ?? 0.1
	const lv = ctx.state(iid, "level") ?? []
	const ph = ctx.state(iid, "pitch") ?? []
	let k = -1
	for (let i = 0; i < lv.length; i++) if (isNum(lv[i]) && (k < 0 || lv[i] > lv[k])) k = i
	const f0 = k >= 0 && k < ph.length && isNum(ph[k]) && ph[k] > 0 ? ph[k] : _max(ph)
	let waves = null
	let tall = null
	if (k >= 0 && isNum(f0) && f0 > 0) {
		waves = f0 * 10 * tb
		tall = (Math.SQRT2 * 2e-5 * pow(10.0, lv[k] / 20)) / pa
	}
	let tol = ctx.num(g.tol)
	tol = tol === null ? 0.1 : Math.abs(tol)
	const wa = ctx.num(g.waves_across)
	const sh = ctx.num(g.squares_high)
	const ok = waves !== null && (wa === null || Math.abs(waves - wa) <= tol * Math.abs(wa)) && (sh === null || Math.abs(tall - sh) <= tol * Math.abs(sh))
	const parts = [...(wa !== null ? [`${_trim(wa, 1)} waves across`] : []), ...(sh !== null ? [`${_trim(sh, 1)} squares high`] : [])]
	const said = `${ctx.name(iid)} shows a wave ` + (parts.length ? parts.join(", ") : "on its screen")
	return { label: lbl(g, said), ok: !!ok, kind: "trace", item: iid, waves_across: r(waves, 2), squares_high: r(tall, 2) }
}

// ---------------------------------------------------------------- the AI's view of the module (web/sim/plugins.js)
const SOURCES = ["tuning-fork", "plucked-ruler", "drum", "monochord", "rubber-band", "xylophone-bar", "glass-bottle", "speaker", "clapper", "bell-jar"]
const SWINGERS = ["pendulum", "rope-pendulum", "swing", "hanging-spring", "wrecking-ball"]
const LISTENERS = ["sound-meter", "hydrophone", "oscilloscope"]
const P_REF_PA = 2e-5 // (the reference sound pressure of 0 dB: 20 µPa)
const fmt = (v, d = 1) => (isNum(v) ? _trim(v, d) : "?")

/** The pitch (Hz) an item of this module would sound with these props (the builder's own formula), or null. */
export function pitchOf(type, P) {
	if (type === "tuning-fork" || type === "speaker" || type === "bell-jar") return P.pitch
	if (type === "plucked-ruler") return ruler_pitch(P.overhang, P.ruler)
	if (type === "drum") return drum_pitch(P.diameter, P.tension)
	if (type === "monochord") return string_pitch(P.length, P.tension, P.gauge / 1000)
	if (type === "rubber-band") return band_pitch(P.length, P.tension, P.width)
	if (type === "xylophone-bar") {
		const [E, rho] = BARS[P.metal]
		return bar_pitch(P.length, P.thickness / 1000, E, rho)
	}
	if (type === "glass-bottle") return bottle_pitch(P.size, P.fill, P.play)
	if (type === "clapper") return 1200.0
	return null
}

/** A record's world point at time t: its solid's placement in the track's frame nearest t (a static solid's is in frame 0), composed with `at`. */
function pointAt(rec, track, t) {
	const fr = track?.frames ?? []
	let k = 0
	while (k + 1 < fr.length && fr[k + 1].t <= t) k++
	const p = fr[k]?.placements?.[rec.solid] ?? fr[0]?.placements?.[rec.solid]
	const at = rec.at ?? { x: 0, y: 0 }
	if (!p) return { x: at.x, y: at.y }
	const c = Math.cos(p.angle ?? 0)
	const s = Math.sin(p.angle ?? 0)
	return { x: p.x + at.x * c - at.y * s, y: p.y + at.x * s + at.y * c }
}

/** The sounds a run made, for audio and the view (spec "track.sounds", derived from the track: the engine's track carries only readings):
 *  [{t, item, kind: "tone", hz, partials ([[Hz, amplitude, τ s]]), level_db (1 m away), decay_s, dur_s, x, y (where it sounded)}], from the doc's
 *  sound records and the track's readings (each frame where a source's "struck" count rises is a strike at its strike_t, at its strike_level;
 *  a buzzer sounds while its sound_db reading is above zero). */
export function soundsOf(doc, track) {
	const out = []
	const st = track?.state ?? {}
	const T = (track?.frames ?? []).map((f) => f.t)
	for (const p of doc?.processes ?? []) {
		if (p.kind !== "sound" || (p.role !== "source" && p.role !== "buzzer")) continue
		const item = p.item
		const s = st[item] ?? {}
		const partials = (p.partials ?? []).map(([ratio, amp, tau]) => [ratio * p.f0, amp, tau])
		const decay = partials.length ? partials[0][2] : 0.2
		if (p.role === "buzzer") {
			const db = s.sound_db ?? []
			let on = -1
			for (let k = 0; k <= db.length; k++) {
				const v = k < db.length ? db[k] : 0
				if (v > 0 && on < 0) on = k
				if ((v <= 0 || k === db.length) && on >= 0) {
					out.push({ t: T[on], item, kind: "tone", hz: p.f0, partials, level_db: p.lp1, decay_s: 0.02, dur_s: (T[Math.min(k, T.length - 1)] ?? T[on]) - T[on], ...pointAt(p, track, T[on]) })
					on = -1
				}
			}
			continue
		}
		const n = s.struck ?? []
		const ts = s.strike_t ?? []
		const lv = s.strike_level ?? []
		let prev = 0
		for (let k = 0; k < n.length; k++) {
			if (n[k] > prev) {
				const count = Math.round(n[k] - prev)
				for (let j = 0; j < count; j++) {
					const level = lv[k] ?? 1
					// the jar's bell: what reaches the room falls with the air in the jar (the engine's own rule, for the audio)
					let gain = level
					if (p.jar) {
						const u = p.jar.t1 > p.jar.t0 ? Math.max(0, Math.min(1, (ts[k] - p.jar.t0) / (p.jar.t1 - p.jar.t0))) : ts[k] >= p.jar.t0 ? 1 : 0
						const pct = Math.max(0, p.jar.from + (p.jar.to - p.jar.from) * u)
						gain = level * (10 ** (-p.jar.glass / 20) * (pct / 100) + 10 ** (-p.jar.base / 20))
					}
					out.push({ t: ts[k], item, kind: "tone", hz: p.f0, partials, level_db: p.lp1 + 20 * Math.log10(Math.max(1e-6, gain)), decay_s: decay, dur_s: p.hold ?? 0, ...pointAt(p, track, ts[k]) })
				}
				prev = n[k]
			}
		}
	}
	out.sort((a, b) => a.t - b.t)
	return out
}

/** The tones a listener hears in the exported video: soundsOf's, each delayed by distance ÷ c and weaker by −20·log10(distance) to the first
 *  sound meter's microphone (the scene's listener), or as heard 1 m away when the scene has no meter; none through a vacuum (settings.air false). */
export function toneEvents(doc, track) {
	const air = doc?.settings?.air !== false
	if (!air) return []
	const c = 331.3 * Math.sqrt(1 + (doc?.settings?.roomTemperature ?? 20) / 273.15)
	const meter = (doc?.processes ?? []).find((p) => p.kind === "sound" && p.role === "meter")
	return soundsOf(doc, track).map((e) => {
		if (!meter) return { ...e, heard_db: e.level_db, delay: 0 }
		const m = pointAt(meter, track, e.t)
		const r = Math.max(0.05, Math.hypot(m.x - e.x, m.y - e.y))
		return { ...e, heard_db: e.level_db - 20 * Math.log10(r), delay: r / c }
	})
}

const GOALS = [
	{
		kind: "sounds", aliases: ["sound", "makes_sound", "rings", "plays", "buzzes"],
		fields: { source: "item?", item: "item?", buzzer: "item?", pitch_hz: "number?", tol_hz: "number?", at_least_db: "number?" }, subject: ["source"],
		about: "sounds {source, pitch_hz?, tol_hz?, at_least_db?}: the source (a tuning fork, drum, ruler, string, bar, speaker, clapper, bell, buzzer) makes a sound during the run, at that pitch (within tol_hz, default 2 %), at least that loud 1 m away",
		label: (g, n) => `${n(g.source ?? g.item ?? g.buzzer)} sounds${Number.isFinite(g.pitch_hz) ? ` at ${g.pitch_hz} Hz` : ""}`,
		summarize: goal_sounds,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => SOURCES.includes(i.type))
			return s.length ? { kind: "sounds", source: pick(s).id, ...(pick([true, false]) ? { pitch_hz: pick([256, 440, 157, 35]) } : {}) } : null
		}
	},
	{
		kind: "higher", aliases: ["higher_pitch", "pitch_higher"], fields: { a: "item", b: "item" }, subject: ["a"],
		about: "higher {a, b}: a's note is higher (a higher pitch, more vibrations a second) than b's; both must sound",
		label: (g, n) => `${n(g.a)} sounds higher than ${n(g.b)}`, summarize: goal_higher,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => SOURCES.includes(i.type))
			return s.length >= 2 ? { kind: "higher", a: pick(s).id, b: pick(s).id } : null
		}
	},
	{
		kind: "louder", aliases: ["louder_than"], fields: { a: "item", b: "item", at: "item?" }, subject: ["a"],
		about: "louder {a, b, at?}: a is louder than b (two sound meters: their loudest readings; two sources: their level 1 m away, or with at = a sound meter, how loud each is there)",
		label: (g, n) => `${n(g.a)} is louder than ${n(g.b)}${g.at ? ` at ${n(g.at)}` : ""}`, summarize: goal_louder,
		sample: (scene, pick) => {
			const m = scene.items.filter((i) => LISTENERS.includes(i.type))
			return m.length >= 2 ? { kind: "louder", a: pick(m).id, b: pick(m).id } : null
		}
	},
	{
		kind: "hears", aliases: ["heard", "hear"], fields: { meter: "item", source: "item", at_least_db: "number?", expect: "bool?" }, subject: ["source"],
		about: "hears {meter, source, at_least_db?, expect?}: the sound meter hears the source (its sound reaches the meter at least as loud as the quiet room, or at least at_least_db); expect false: it does not (a slack or pinched string-telephone)",
		label: (g, n) => `${n(g.meter)} ${g.expect === false ? "does not hear" : "hears"} ${n(g.source)}`, summarize: goal_hears,
		sample: (scene, pick) => {
			const m = scene.items.filter((i) => LISTENERS.includes(i.type))
			const s = scene.items.filter((i) => SOURCES.includes(i.type) || i.type === "string-telephone")
			return m.length && s.length ? { kind: "hears", meter: pick(m).id, source: pick(s).id, ...(pick([0, 1, 2, 3]) === 0 ? { expect: false } : {}) } : null
		}
	},
	{
		kind: "echo", aliases: ["echoes", "hears_echo"], fields: { meter: "item", delay_s: "number?", tol: "number?" }, subject: ["meter"],
		about: "echo {meter, delay_s?, tol?}: the sound meter hears an echo off a wall (delay_s after the first sound, within tol: default 5 ms; delay = extra path ÷ 343 m/s)",
		label: (g, n) => `${n(g.meter)} hears an echo`, summarize: goal_echo,
		sample: (scene, pick) => {
			const m = scene.items.filter((i) => LISTENERS.includes(i.type))
			return m.length ? { kind: "echo", meter: pick(m).id } : null
		}
	},
	{
		kind: "wave_reaches", aliases: ["wave_arrives", "arrives", "wave reaches"], fields: { item: "item", x: "number?", before_s: "number?" },
		about: "wave_reaches {item, x?, before_s?}: the wave on a wave rope or Slinky (or a ripple tank's ripples) reaches its far end, or x m along it, by before_s if given",
		label: (g, n) => `the wave on ${n(g.item)} reaches ${Number.isFinite(g.x) ? `${g.x} m along` : "the far end"}`, summarize: goal_reaches,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => ["wave-rope", "slinky", "ripple-tank"].includes(i.type))
			return s.length ? { kind: "wave_reaches", item: pick(s).id, ...(pick([true, false]) ? { before_s: 2 } : {}) } : null
		}
	},
	{
		kind: "reflects", aliases: ["reflection", "bounces_back", "comes_back"], fields: { item: "item", way: "string?" },
		about: "reflects {item, way?}: a pulse on a wave rope or Slinky comes back from its far end, way \"upside down\" (a tied end), \"same way up\" (a ring on a pole) or \"none\" (it must not come back: the rope runs on)",
		label: (g, n) => `the pulse on ${n(g.item)} comes back${g.way ? ` ${g.way}` : ""}`, summarize: goal_reflects,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => ["wave-rope", "slinky"].includes(i.type))
			return s.length ? { kind: "reflects", item: pick(s).id, ...(pick([true, false]) ? { way: pick(["upside down", "same way up", "none"]) } : {}) } : null
		}
	},
	{
		kind: "jumps", aliases: ["jump", "hops", "bounces_up", "thrown_up"], fields: { item: "item", min_m: "number?" },
		about: "jumps {item, min_m?}: something of the item (rice grains on a drum's head, a ball by a tuning fork) is thrown up at least min_m (default 5 mm) above where it started",
		label: (g, n) => `${n(g.item)} jumps`, summarize: goal_jumps,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => i.type === "rice")
			return s.length ? { kind: "jumps", item: pick(s).id, ...(pick([true, false]) ? { min_m: 0.01 } : {}) } : null
		},
		// (the make-it-work search's targeted tries: a drum struck at or before the scene lets things go throws its rice while the grains are
		// still being set down; struck 0.3 s after the release, they lie on its head)
		aim: (g, entry, scene) => {
			if (entry?.ok !== false) return []
			const release = isNum(scene?.release) ? scene.release : 0
			const out = []
			for (const d of scene?.items ?? []) {
				if (!["drum", "tuning-fork"].includes(d.type)) continue
				const at = isNum(d.props?.strike_at) ? d.props.strike_at : 0.5
				if (at > release + 0.05) continue
				out.push({ changes: [{ kind: "prop", id: d.id, key: "strike_at", from: at, to: pyRound(release + 0.3, 2) }], cost: 0.5 })
			}
			return out
		}
	},
	{
		kind: "standing", aliases: ["standing_wave", "loops", "standing_loops"], fields: { item: "item", loops: "number?" },
		about: "standing {item, loops?}: a wave rope or Slinky kept shaking shows a standing wave of `loops` loops at the end (a tied line driven at f = n·v/(2L) shows n; give it damping ≥ 1 and a small shake, ≤ 2 cm, and at least 4 s)",
		label: (g, n) => `a standing wave${Number.isFinite(g.loops) ? ` with ${g.loops} loops` : ""} on ${n(g.item)}`, summarize: goal_standing,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => ["wave-rope", "slinky"].includes(i.type))
			return s.length ? { kind: "standing", item: pick(s).id, ...(pick([true, false]) ? { loops: pick([1, 2, 3]) } : {}) } : null
		}
	},
	{
		kind: "wavelength", aliases: ["wave_length", "wavelength_m"], fields: { item: "item", m: "number?", tol: "number?" },
		about: "wavelength {item, m?, tol?}: the waves on a wave rope, Slinky or ripple tank are m metres long (speed ÷ frequency; within tol m, default 5 %)",
		label: (g, n) => `the waves on ${n(g.item)} are ${g.m} m long`, summarize: goal_wavelength,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => ["wave-rope", "slinky", "ripple-tank"].includes(i.type))
			return s.length ? { kind: "wavelength", item: pick(s).id, ...(pick([true, false]) ? { m: pick([0.05, 1, 3.33, 4]) } : {}) } : null
		}
	},
	{
		kind: "wave_speed", aliases: ["speed_of_wave", "wave_speed_m_s"], fields: { item: "item", m_s: "number?", tol: "number?" },
		about: "wave_speed {item, m_s?, tol?}: the waves on a wave rope (√(T/μ)), Slinky (L·√(k/m)) or ripple tank run at m_s m/s (within tol, default 5 %)",
		label: (g, n) => `the waves on ${n(g.item)} run at ${g.m_s} m/s`, summarize: goal_wave_speed,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => ["wave-rope", "slinky", "ripple-tank"].includes(i.type))
			return s.length ? { kind: "wave_speed", item: pick(s).id, ...(pick([true, false]) ? { m_s: pick([10, 6.71, 0.3]) } : {}) } : null
		}
	},
	{
		kind: "stays_put", aliases: ["bobs_in_place", "stays_in_place", "does_not_drift"], fields: { item: "item", max_drift_m: "number?", min_bob_mm: "number?" },
		about: "stays_put {item, max_drift_m?, min_bob_mm?}: what rides the waves bobs but goes nowhere: a ripple-tank's duck or cork bobs ≥ min_bob_mm (default 0.5) while drifting ≤ max_drift_m (default 1 cm); a wave rope's or Slinky's ribbon moves ≥ min_bob_mm and travels no more than max_drift_m along (waves carry energy, not the water or rope)",
		label: (g, n) => `the floater or ribbon on ${n(g.item)} bobs but stays put`, summarize: goal_stays_put,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => ["ripple-tank", "wave-rope", "slinky"].includes(i.type))
			return s.length ? { kind: "stays_put", item: pick(s).id, ...(pick([true, false]) ? { max_drift_m: 0.005, min_bob_mm: 1 } : {}) } : null
		}
	},
	{
		kind: "trace", aliases: ["shows_wave", "waveform", "screen_shows"], fields: { oscilloscope: "item?", item: "item?", waves_across: "number?", squares_high: "number?", tol: "number?" }, subject: ["oscilloscope", "item"],
		about: "trace {oscilloscope, waves_across?, squares_high?, tol?}: an oscilloscope's screen at its loudest shows that many waves across (pitch × 10 × time a square) and that many squares high (its pressure ÷ Pa a square), each within tol × it (default 0.1 = 10 %); without numbers, that it shows a wave",
		label: (g, n) => `${n(g.oscilloscope ?? g.item)} shows the wave`, summarize: goal_trace,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => i.type === "oscilloscope")
			return s.length ? { kind: "trace", oscilloscope: pick(s).id, ...(pick([true, false]) ? { waves_across: pick([4.4, 8.8, 2]), squares_high: pick([1, 2, 3]) } : {}) } : null
		}
	},
	{
		kind: "period", aliases: ["swings", "swing_period", "oscillates"], fields: { item: "item", seconds: "number?", tol: "number?" },
		about: "period {item, seconds?, tol?}: the item (a pendulum, a rope pendulum, a swing, a weight on a hanging spring) swings back and forth, once every `seconds` (within tol, default 2 %), measured from the run (frequency = 1 ÷ period)",
		label: (g, n) => `${n(g.item)} swings${Number.isFinite(g.seconds) ? ` once every ${g.seconds} s` : ""}`, summarize: goal_period,
		sample: (scene, pick) => {
			const s = scene.items.filter((i) => SWINGERS.includes(i.type))
			return s.length ? { kind: "period", item: pick(s).id } : null
		}
	}
]

/** IEC 61672-1 A-weighting (dB) at f (the engine's aWeight; for the AI's words only). */
const aWeightDb = (f) => {
	const f2 = f * f
	const ra = (148693636 * f2 * f2) / ((f2 + 424.36) * Math.sqrt((f2 + 11599.29) * (f2 + 544496.41)) * (f2 + 148693636))
	return 20 * Math.log10(ra) + 2.0
}
/**
 * What a sound level meter (dB(A), fast: 0.125 s) 1 m away reads at its loudest for one strike of this source record at `level`: each partial's
 * mean square (its share of lp1, A-weighted) through the meter's exponential average, the closed form of a decay (held `hold` s first), summed
 * and its highest found on a 2 ms grid over 2 s. The source's own `sounding` reading is the unweighted level at the strike's instant: a short
 * low note reads well under it on a meter (a 157 Hz drum hit: −11 dB of A-weighting, −5 dB of the fast average).
 */
export function meterReading1m(rec, level = 1) {
	const parts = Array.isArray(rec?.partials) ? rec.partials : []
	if (!parts.length || !(level > 0)) return null
	let norm = 0
	for (const [, a] of parts) norm += a * a
	norm = norm > 0 ? Math.sqrt(norm) : 1
	const p1 = P_REF_PA * Math.pow(10, (rec.lp1 ?? 60) / 20)
	const w = 8
	const hold = rec.hold ?? 0
	const qs = parts
		.map(([ratio, a, tau]) => {
			const f = ratio * rec.f0
			if (!(f > 0) || f > 20000 || !(tau > 0)) return null
			const p = (p1 * level * (a / norm) * Math.pow(10, aWeightDb(f) / 20))
			return { q: p * p, beta: 2 / tau }
		})
		.filter(Boolean)
	const avg = (q, beta, u) => {
		const dec = (Q, v) => (Math.abs(w - beta) < 1e-9 * w ? Q * w * v * Math.exp(-w * v) : ((Q * w) / (w - beta)) * (Math.exp(-beta * v) - Math.exp(-w * v)))
		if (hold <= 0) return dec(q, u)
		if (u <= hold) return q * (1 - Math.exp(-w * u))
		return q * (1 - Math.exp(-w * hold)) * Math.exp(-w * (u - hold)) + dec(q, u - hold)
	}
	let best = 0
	for (let u = 0.002; u <= Math.max(2, hold + 1); u += 0.002) {
		let ms = 0
		for (const { q, beta } of qs) ms += avg(q, beta, u)
		if (ms > best) best = ms
	}
	return best > 0 ? 10 * Math.log10(best / (P_REF_PA * P_REF_PA)) : null
}

const pct = (a, b) => (isNum(a) && isNum(b) && a !== 0 ? `${b > a ? "+" : ""}${_trim(((b - a) / a) * 100, 0)} %` : "")
const dbRatio = (a, b) => (isNum(a) && isNum(b) && a > 0 && b > 0 ? `${b > a ? "+" : ""}${_trim(20 * Math.log10(b / a), 1)} dB` : "")

export const plugin = {
	title: "Sound and waves",
	howto:
		"Sound comes from something vibrating: a tuning-fork, plucked-ruler, drum, monochord (one guitar string), rubber-band (shoebox guitar), xylophone-bar, speaker, clapper " +
		"or bell-jar sounds at its strike_at time (hits × every s apart), as loud as its strength (twice the strength = twice the vibration = 6 dB louder). Its PITCH is set " +
		"by its own size and tightness: tuning-fork `pitch` (Hz); plucked-ruler `overhang` (shorter = higher, ∝ 1/overhang²; it clamps itself to the table's right edge, " +
		"or its left edge with edge \"left\": two rulers = one on each edge); drum `tension` (∝ √tension) and `diameter`; monochord `length` (∝ 1/length), `tension` (∝ √tension), `gauge` (heavier = lower); " +
		"rubber-band `width` (wider = lower), `length`, `tension`; xylophone-bar `length` (∝ 1/length²); glass-bottle `fill` (tapped: more water = lower; blown: more water = higher). A sound-meter is the LISTENER (no people): it reads dB (A-weighted " +
		"by default) where its microphone is; sound falls 6 dB per doubling of distance, arrives after distance ÷ 343 m/s, reflects off Wall items (an echo: the meter's " +
		"`echo` reading is the delay) and is soaked up by a sound-panel (foam, curtain). In a vacuum (scene settings.air false) nothing travels through the air; the bell-jar " +
		"shows that by pumping its own jar empty. A meter set to listen \"touching\" and pressed against a steel-rod, wooden-rod, plank or the table also hears what that solid " +
		"carries (faster than air: steel 5050 m/s); a hydrophone's probe hung under the water of a water-tank (Liquids) hears a source in that water at 1481 m/s. An oscilloscope's microphone (on a little stand 21 cm to its right, or left with mic_side) listens like a meter and its screen draws the wave it hears: louder = taller waves (amplitude: `scale` Pa a square), higher = more waves across its 10 squares (pitch × 10 × `time_base`: 440 Hz at 1 ms a square shows 4.4 waves). Rice grains laid ON a drum's head jump when it is struck (harder = higher). A ball that hits a drum, fork or xylophone bar " +
		"sounds it. Sound lines and audio in the video are automatic. Waves: a wave-rope (v = √(tension ÷ weight per metre)) or slinky (push and pull = compressions like " +
		"sound; v = L·√(k/m)) is shaken at its left end by a driver (one pulse or keep shaking at `frequency`); its far end is tied (a pulse comes back upside down), a ring on " +
		"a pole (same way up) or runs on (nothing comes back): use those two on a rope lying \"on the floor\" (held up, a free end hangs μgL²/(2T) down onto the table); a ribbon on it only moves across (the wave carries energy, not the rope); driven at f = n·v/(2L) a tied rope " +
		"shows n standing loops (goal standing {item, loops}): give it a SMALL shake (amplitude ≤ 0.02 m), damping ≥ 1 (the default 1.5 is a real rope's) and ≥ 4 s, and the picture settles within a few seconds; a big shake or damping 0 makes loops that never settle. " +
		"A rope is cut into segments of ≤ 2.5 cm and ≥ 10 a wavelength (up to 800): waves shorter than about 4 segments do not travel (a warning says so). A held-up rope or Slinky lies on the table where it would sag or swing below it. " +
		"Rice on a drum (or a ball on a fork) is thrown only by the drum's own strikes (strike_at, hits), never by landing on it; strike it AFTER the scene's release (release + 0.3 s): the head rings only ≈ 0.2 s, so a strike before the grains are let go throws them little. " +
		"Every drum hit moves its head at the same speed for the same strength (loose or tight: rice jumps alike); harder (strength) throws higher (× strength²); a heavy thing on a drum barely moves. " +
		"A ripple-tank's dipper makes water waves (wavelength from frequency, depth and the scene's gravity); its duck or cork bobs in place (goal stays_put); a ripple tank always stays level. Goals for waves: wave_reaches, reflects, standing, wavelength {item, m}, wave_speed {item, m_s}, stays_put; for an oscilloscope's picture: trace {oscilloscope, waves_across, squares_high}. Pendulum timing: a pendulum's " +
		"period is 2π√(L/g) (the `period` goal measures it). " +
		"A string-telephone is two paper cups with a string between their bottoms, held level (no stand: place it on: air, y_m 0.2-0.5 over the table; its anchor is the string's middle, " +
		"so its cups reach length/2 + 0.09 m either side: give the stage room). Its own child talks into its LEFT cup (voice: whisper by default, quiet, normal, loud, shout, or none for a speaker or fork put at that cup; talk_at, talk_for). " +
		"Pulled taut (pull 2-10 N, 5 by default) the string carries the sound to its RIGHT cup: about 24 dB under what goes into the left cup for 3 m of cotton string (3 dB more a metre; steel wire about 16 dB; fishing line 29 but only 0.5 dB more a metre). " +
		"The ear is a sound-meter with its microphone at the right cup's mouth: meter x = phone.x + length/2 + 0.12, its height = the phone's height over what the meter stands on (within 50 cm of a cup's mouth it hears the string; the voice goes either way). " +
		"A whisper reaches it through the string (about 39 dB(A)) but not through the air (about 30 dB 3 m away, under a quiet room's 35). Slack (pull 0), drooping (under about 0.2 N) or pinched (pinched true) it carries nothing or little: only the air is left. " +
		"Its readings: carries (0/1), loss_db, sag_mm, string_ms (≈ 1600 m/s along cotton: faster than the air). Goals: hears {meter, source: the telephone} and, for a slack or pinched one, hears {meter, source, expect: false}.",
	prompt: {
		plan:
			"Sound lessons: use the sound items (tuning-fork, plucked-ruler, drum, monochord, rubber-band, xylophone-bar, speaker, clapper, bell-jar) and a sound-meter as " +
			"the listener at the requested distance (no people). Compare pitch with two sources whose size/tightness differ (goal higher) and loudness with strength or " +
			"distance (goal louder / hears). Echo: a clapper and a meter standing together, a Wall at the requested distance (the echo returns after 2 × distance ÷ 343 s; " +
			"set the stage wide enough to hold the wall). Rice ON a drum's head (place: on the drum). Waves: wave-rope / slinky / ripple-tank items, goal wave_reaches. To SHOW a sound wave's shape (amplitude, frequency) use an oscilloscope, its microphone near the source (goals hears / louder name the oscilloscope as the meter). " +
			"Standing waves: wave-rope keep shaking at f = n·v/(2L), amplitude ≤ 0.02, damping ≥ 1, seconds ≥ 5; goal standing {item, loops: n}. A wave's length or speed: goals wavelength {item, m} / wave_speed {item, m_s}; a duck or ribbon that bobs in place: stays_put {item}; an oscilloscope's picture: trace {oscilloscope, waves_across?, squares_high?}. " +
			"Rice on a drum: strike_at at least 0.3 s after the scene's release (the grains must lie on the head when it is struck). " +
			"Give `seconds` long enough for the sound or wave to happen (a fork rings ≈ 2 s; a rope wave crosses in length ÷ speed). " +
			"String telephone: a string-telephone on: air (y_m 0.3) with a sound-meter at its RIGHT cup (meter x = phone.x + length/2 + 0.12, meter height = 0.3 on the table), voice whisper so the air alone does not reach the meter; taut against slack or pinched: two telephones one above the other (y_m 0.3 and 0.9) or one changed in an edit, each with its own meter; goals hears {meter, source: phone} and hears {meter, source: the slack phone, expect: false}.",
		edit:
			"Sound items' pitch follows their size and tightness (ruler overhang, string length/tension/gauge, drum tension, bar length, fork pitch); loudness follows `strength` " +
			"and the meter's distance (−6 dB per doubling). Readings: sources `sounding` (dB 1 m away), `pitch`; meters (sound-meter, hydrophone, oscilloscope) `peak`, `level`, `heard`, `echo` (an oscilloscope's screen: waves across = pitch × 10 × time_base, height = its pressure ÷ scale); ropes/slinkies " +
			"`speed`, `wavelength`, `arrive`, `reflection`, `loops`; ripple tanks `wavelength`, `speed`, `floater_bob_mm`, `floater_drift`. Goal kinds standing {item, loops}, wavelength {item, m}, wave_speed {item, m_s}, stays_put {item}, trace {oscilloscope, waves_across, squares_high} check those. " +
			"A standing wave settles only with damping ≥ 1 and a shake ≤ 2 cm. A drum's rice jumps only when the drum is struck after the release.",
		refine: "A sound source must have its strike time inside the run; a drum with rice (or a fork with a ball) must be struck after the scene's release (strike_at ≥ release + 0.3); a sound-meter must stand where the request puts the listener; walls for echoes at the requested distance; a standing wave needs damping ≥ 1, amplitude ≤ 0.02 and f = n·v/(2L)."
	},
	examples: [
		{ ask: "A shorter ruler makes a higher sound", how: "two plucked-ruler items on the table's right edge (one per table or one at a time), overhang 0.15 and 0.10 (35 → 79 Hz); goal higher {a: the 10 cm one, b: the 15 cm one}" },
		{ ask: "Hit the drum harder and the rice jumps higher and it is louder", how: "two drums (strength 0.5 and 1.0, or hits at different times), rice ON each head (rice y = drum height), struck 0.3 s or more after the release, a sound-meter between them; goals jumps {item: rice}, louder {a: harder drum, b: softer drum}" },
		{ ask: "The farther away, the quieter the tuning fork sounds", how: "a tuning-fork and sound-meters 1, 2 and 4 m away (microphones at the fork's height); each doubling reads 6 dB less; goals hears {meter, source} and louder {a: near meter, b: far meter}" },
		{ ask: "An echo off a wall 17 m away comes back a tenth of a second later", how: "a wide stage (x to 20 m), a clapper and a sound-meter just behind it, a Wall 17.15 m away (height 3); goal echo {meter, delay_s: 0.1}" },
		{ ask: "A guitar string an octave higher when it is half as long", how: "two monochords: length 0.648 and 0.324 (329.6 → 659 Hz); goal higher {a: short, b: long}" },
		{ ask: "A pulse on a rope reflects upside down from the tied end", how: "a wave-rope (length 4, tension 10 N, weight 0.1 kg/m: 10 m/s), shake one pulse, far_end tied to the post; goals wave_reaches {item: rope, before_s: 1}, reflects {item: rope, way: \"upside down\"}" },
		{ ask: "A standing wave with 3 loops on a rope", how: "a wave-rope length 4, tension 10, weight 0.1 (v 10 m/s), keep shaking at f = 3·10/(2·4) = 3.75 Hz, amplitude 0.015, damping 1.5, seconds 6; goal standing {item: rope, loops: 3}" },
		{ ask: "A duck bobs on ripples but stays where it is", how: "a ripple-tank (depth 0.02, frequency 5, floater duck at 0.6), seconds 4; goal stays_put {item: tank} (readings floater_bob_mm and floater_drift ≈ 0)" },
		{ ask: "Faster dipping makes shorter water waves", how: "two ripple-tanks, frequency 5 and 10 Hz; goals wavelength {item: each, m: its wavelength reading} (v = f·λ)" },
		{ ask: "A ball hitting a xylophone bar makes it ring", how: "a xylophone-bar with a ball held above it (or rolling off a ramp onto it); goal sounds {source: bar}" },
		{ ask: "A bell in a jar goes quiet as the air is pumped out", how: "a bell-jar (pump_at 1, pump_for 4, air_left 0) and a sound-meter 1 m away; the meter's level falls by about 35 dB" },
		{ ask: "Shorter xylophone bars ring higher", how: "xylophone-bars 0.20 and 0.141 m long (779 → 1558 Hz); goal higher" },
		{ ask: "A pendulum's swing time depends on its length", how: "pendulums of different length; goal period {item, seconds} (T = 2π√(L/g): 1 m → 2.0 s)" },
		{ ask: "A bottle xylophone: more water, lower note", how: "four glass-bottles (fill 0.1, 0.35, 0.6, 0.85, play tap) tapped one after another (strike_at 0.4, 0.9, 1.4, 1.9); goals higher {a: emptier, b: fuller}" },
		{ ask: "On an oscilloscope, a louder sound makes taller waves and a higher sound makes the waves closer together", how: "two speakers far apart (3 m: 440 Hz at 70 dB and 880 Hz at 70 dB, or the same pitch at 60 and 72 dB), an oscilloscope with its microphone 30 cm from each (time_base 1 ms a square: 4.4 and 8.8 waves across); goals hears {meter: scope, source: its speaker}, louder {a: the louder speaker's scope, b: the other}" },
		{
			ask: "A string telephone carries a whisper when the string is pulled tight, and nothing when it is slack",
			how: "two string-telephones of 3 m cotton string, one above the other (y_m 0.3 and 0.9 over the table, x 1.3), each with its own child whispering; the top one pull 5 N (taut), the bottom one pull 0 (slack); a sound-meter at each right cup (x 2.97, height 0.3 on the table; the top one on: air with height 0.12 at y_m 0.78); goals hears {meter: top meter, source: taut phone}, hears {meter: bottom meter, source: slack phone, expect: false}",
			plan: {
				seconds: 3,
				items: [
					{ id: "taut", type: "string-telephone", name: "Taut telephone", props: { pull: 5 }, place: { on: "air", x: 1.3, y_m: 0.9 } },
					{ id: "slack", type: "string-telephone", name: "Slack telephone", props: { pull: 0 }, place: { on: "air", x: 1.3, y_m: 0.3 } },
					{ id: "ear1", type: "sound-meter", name: "Ear at the taut one", props: { height: 0.12 }, place: { on: "air", x: 2.97, y_m: 0.78 } },
					{ id: "ear2", type: "sound-meter", name: "Ear at the slack one", props: { height: 0.3 }, place: { on: "table", x: 2.97 } }
				],
				goals: [{ kind: "hears", meter: "ear1", source: "taut" }, { kind: "hears", meter: "ear2", source: "slack", expect: false }]
			}
		},
		{ ask: "Sound travels faster through water than through air", how: "a water-tank (Liquids), a tuning-fork (box false) standing in its water, a hydrophone beside the tank with its probe under the water (reach over the wall), a sound-meter in the air; the hydrophone's at:fork reading is distance ÷ 1481 m/s" }
	],
	goals: GOALS,
	knobs: [
		{ type: "plucked-ruler", key: "overhang", how: "m", steps: [-0.04, -0.02, -0.01, 0.01, 0.02, 0.04], more: "let {it} stick out further (lower pitch)", less: "pull {it} in (higher pitch)", why: "the ruler's pitch goes as 1 ÷ overhang²: 15 cm → 35 Hz, 10 cm → 79 Hz" },
		{ type: "monochord", key: "length", how: "rel", more: "lengthen {it}'s string (lower pitch)", less: "shorten {it}'s string (higher pitch)", why: "a string's pitch goes as 1 ÷ its length: half as long is an octave higher" },
		{ type: "monochord", key: "tension", how: "rel", more: "tighten {it}'s string (higher pitch)", less: "loosen {it}'s string (lower pitch)", why: "pitch goes as √tension: four times the tension is an octave higher" },
		{ type: "rubber-band", key: "tension", how: "rel", more: "stretch {it} tighter (higher)", less: "loosen {it} (lower)", why: "pitch goes as √tension" },
		{ type: "rubber-band", key: "width", how: "rel", more: "use a wider band on {it} (lower)", less: "use a thinner band on {it} (higher)", why: "a wider band is heavier per length: lower pitch" },
		{ type: "xylophone-bar", key: "length", how: "rel", more: "use a longer bar for {it} (lower)", less: "use a shorter bar for {it} (higher)", why: "a bar's pitch goes as 1 ÷ length²" },
		{ type: "drum", key: "tension", how: "rel", more: "tighten {it}'s head (higher)", less: "loosen {it}'s head (lower)", why: "a drum's pitch goes as √(head tension)" },
		{ type: "tuning-fork", key: "pitch", how: "rel", more: "use a higher fork for {it}", less: "use a lower fork for {it}", why: "the fork's pitch is its own (a shorter-pronged fork is higher)" },
		{ type: "drum", key: "strength", how: "rel", steps: [0.1, 0.2, 0.4, 0.7, 1.0], more: "hit {it} harder (louder: rice jumps higher)", less: "hit {it} more softly (quieter: rice jumps lower)", why: "twice the strength is twice the head's speed: +6 dB, and grains thrown off 2× faster (4× higher); a loose or a tight head throws them alike" },
		{ type: "tuning-fork", key: "strength", how: "rel", steps: [0.1, 0.2, 0.4, 0.7, 1.0], more: "strike {it} harder", less: "strike {it} more softly", why: "twice the strength: +6 dB" },
		{ type: "plucked-ruler", key: "strength", how: "rel", steps: [0.1, 0.2, 0.4, 0.7, 1.0], more: "pluck {it} harder", less: "pluck {it} more gently", why: "twice the strength: +6 dB" },
		{ type: "speaker", key: "level", how: "abs", steps: [-12, -6, -3, 3, 6, 12], more: "turn {it} up", less: "turn {it} down", why: "its level 1 m away, in dB" },
		{ type: "tuning-fork", key: "strike_at", how: "abs", steps: [-0.4, -0.2, 0.2, 0.5], more: "strike {it} later", less: "strike {it} sooner", why: "when it sounds" },
		{ type: "drum", key: "strike_at", how: "abs", steps: [-0.4, -0.2, 0.2, 0.3, 0.5], more: "hit {it} later", less: "hit {it} sooner", why: "when it sounds; rice on it jumps only when it is struck after the scene lets things go (the head rings ≈ 0.2 s)" },
		{ type: "sound-meter", key: "room", how: "abs", steps: [-10, -5, 5], cost: 3, more: "make the room noisier for {it}", less: "make the room quieter for {it}", why: "what it reads with nothing sounding" },
		{ type: "wave-rope", key: "tension", how: "rel", more: "pull {it} tighter (faster waves)", less: "slacken {it} (slower waves)", why: "v = √(tension ÷ weight per metre)" },
		{ type: "wave-rope", key: "frequency", how: "rel", more: "shake {it} faster (shorter waves)", less: "shake {it} slower (longer waves)", why: "wavelength = speed ÷ frequency; a tied rope shows n loops at f = n·v/(2L)" },
		{ type: "wave-rope", key: "amplitude", how: "rel", more: "shake {it} harder (taller waves)", less: "shake {it} more gently (a standing wave settles)", why: "how far the driver moves the rope's end; a standing wave needs ≤ 2 cm to settle into clean loops" },
		{ type: "wave-rope", key: "damping", how: "abs", steps: [-0.5, 0.5, 1.0], cost: 2, more: "give {it} more losses (it settles sooner)", less: "give {it} fewer losses", why: "how fast its motion dies away (1/s): a standing wave settles in about 3 ÷ damping seconds" },
		{ type: "wave-rope", key: "length", how: "rel", cost: 2, more: "lengthen {it}", less: "shorten {it}", why: "a longer rope: the wave takes longer to cross; a tied rope's loops at f = n·v/(2L)" },
		{ type: "slinky", key: "amplitude", how: "rel", more: "push {it} further", less: "push {it} more gently", why: "how far the driver moves its end" },
		{ type: "wave-rope", key: "far_end", how: "choice", more: "change how {it}'s far end is held", less: "change how {it}'s far end is held", why: "tied: a pulse returns upside down; ring on a pole: the same way up; runs on: no reflection" },
		{ type: "slinky", key: "stiffness", how: "rel", more: "use a stiffer {it} (faster)", less: "use a softer {it} (slower)", why: "v = L·√(k/m)" },
		{ type: "slinky", key: "frequency", how: "rel", more: "shake {it} faster", less: "shake {it} slower", why: "wavelength = speed ÷ frequency" },
		{ type: "ripple-tank", key: "frequency", how: "rel", more: "dip {it} faster (shorter waves)", less: "dip {it} slower (longer waves)", why: "faster dipping: shorter water waves (v = f·λ)" },
		{ type: "ripple-tank", key: "depth", how: "rel", more: "deepen {it}'s water (faster, longer waves)", less: "make {it}'s water shallower", why: "shallow water waves run at about √(g·depth)" },
		{ type: "ripple-tank", key: "amplitude", how: "rel", more: "dip {it} deeper (taller ripples: the duck bobs more)", less: "dip {it} more gently", why: "how far the dipper bobs: the duck bobs that much where it floats" },
		{ type: "oscilloscope", key: "scale", how: "choice", more: "change {it}'s pressure a square", less: "change {it}'s pressure a square", why: "a smaller Pa a square draws the same sound taller" },
		{ type: "oscilloscope", key: "time_base", how: "choice", more: "change {it}'s time a square", less: "change {it}'s time a square", why: "a longer time a square shows more waves across" },
		{ type: "glass-bottle", key: "fill", how: "abs", steps: [-0.2, -0.1, -0.05, 0.05, 0.1, 0.2], more: "pour more water into {it}", less: "pour some water out of {it}", why: "tapped, more water lowers the note; blown, more water (less air) raises it" },
		{ type: "bell-jar", key: "air_left", how: "abs", steps: [-50, -20, 20, 50], more: "leave more air in {it}", less: "pump {it} emptier", why: "the bell's sound reaching the room falls with the air in the jar" },
		{ type: "string-telephone", key: "pull", how: "abs", steps: [-4, -2, 2, 4, 8], more: "pull {it}'s string tighter", less: "let {it}'s string go slacker", why: "a taut string carries the voice (2-10 N); under about 0.2 N it droops and carries little, at 0 nothing" },
		{ type: "string-telephone", key: "pinched", how: "bool", cost: 2, more: "pinch {it}'s string", less: "let go of {it}'s string", why: "a pinched string cannot vibrate past the fingers: nothing gets through" },
		{ type: "string-telephone", key: "voice", how: "choice", cost: 2, more: "talk louder into {it}", less: "talk more quietly into {it}", why: "a louder voice into the near cup is louder at the far one, and through the air too" },
		{ type: "string-telephone", key: "length", how: "rel", cost: 2, more: "lengthen {it}'s string", less: "shorten {it}'s string", why: "cotton string loses about 3 dB a metre (fishing line 0.5, wire almost none)" }
	],
	digest(item, run, h) {
		const out = []
		const st = run?.track?.state?.[item.id]
		const last = (k) => _last(st?.[k])
		const P = item.props ?? {}
		if (SOURCES.includes(item.type)) {
			const tp = TYPES[item.type]
			const full = tp ? { ...tp.defaults(), ...P } : P
			const f = pitchOf(item.type, full)
			if (isNum(f)) out.push(`pitch ${fmt(f, 1)} Hz (set by its own props)`)
			if (item.type === "rubber-band" && isNum(full.tension) && isNum(full.width) && full.tension > band_hold(full.width))
				out.push(`pulled ${fmt(full.tension, 1)} N: more than a ${fmt(full.width, 1)} mm band holds (it snaps past ≈ ${fmt(band_hold(full.width), 1)} N), so taken as ${fmt(band_hold(full.width), 1)} N`)
			const rel = isNum(run?.scene?.release) ? run.scene.release : isNum(run?.doc?.release?.at) ? run.doc.release.at : null
			const grains = (run?.doc?.solids ?? []).some((q) => q.words === "a grain of rice")
			if (item.type === "drum" && rel !== null && grains) {
				const at = isNum(full.strike_at) ? full.strike_at : 0.5
				if (at <= rel + 0.05) out.push(`struck at ${fmt(at, 2)} s, when the scene lets things go (${fmt(rel, 2)} s) or before: what lies on it is thrown only while it still rings (≈ ${item.type === "drum" ? "0.2" : "2"} s); strike it after the release (release + 0.3 s)`)
			}
			if (st) {
				const n = last("struck")
				const peak = _max(st.sounding)
				const first = (run.track.frames ?? []).find((fr, k) => (st.struck?.[k] ?? 0) >= 1)
				// (the reading is the unweighted level at the strike's instant: said with what a fast dB(A) meter 1 m away would show, which is what
				// a sound-meter there reads)
				const rec = (run?.doc?.processes ?? []).find((q) => q.kind === "sound" && q.role === "source" && q.item === item.id)
				const meter = rec ? meterReading1m(rec, _max(st.strike_level) ?? 1) : null
				out.push(
					n > 0
						? `sounded ${n} time${n === 1 ? "" : "s"}, first at ${fmt(first?.t, 2)} s, loudest ${fmt(peak, 1)} dB 1 m away at the strike's instant (unweighted)${isNum(meter) ? `: a sound-meter (dB(A), fast) 1 m away reads about ${fmt(meter, 0)} dB` : ""}`
						: "never sounded during the run (its strike time is after the run ends?)"
				)
			}
		}
		if (LISTENERS.includes(item.type) && st) {
			const room = st.level?.[0]
			out.push(`reads ${fmt(last("level"), 1)} dB at the end, loudest ${fmt(last("peak"), 1)} dB (quiet room ${fmt(room, 0)} dB)`)
			const heard = last("heard")
			out.push(heard >= 0 ? `first heard a sound at ${fmt(heard, 3)} s` : "heard nothing over the room")
			const echo = last("echo")
			if (echo >= 0) out.push(`an echo arrived ${fmt(echo * 1000, 1)} ms after the first sound`)
			for (const k of Object.keys(st)) {
				if (!k.startsWith("peak:")) continue
				const src = k.slice(5)
				const at = _last(st[`at:${src}`])
				const pk = _last(st[k])
				if (isNum(at) && at >= 0) out.push(`hears ${h?.nameOf ? h.nameOf(src) : src}: arrived at ${fmt(at, 4)} s, its loudest ${fmt(pk, 1)} dB here`)
			}
			if (item.type === "oscilloscope") {
				const tp = TYPES[item.type]
				const full = tp ? { ...tp.defaults(), ...P } : P
				const tb = SCOPE_TIME[full.time_base] ?? 0.001
				const pa = SCOPE_SCALE[full.scale] ?? 0.1
				// (at its loudest moment: the level then, and the pitch it heard then)
				const lv = st.level ?? []
				let k = -1
				for (let i = 0; i < lv.length; i++) if (isNum(lv[i]) && (k < 0 || lv[i] > lv[k])) k = i
				const pk = k >= 0 ? lv[k] : null
				const f0 = k >= 0 && st.pitch?.[k] > 0 ? st.pitch[k] : _max(st.pitch)
				if (isNum(f0) && f0 > 0 && isNum(pk)) {
					const tall = (Math.SQRT2 * P_REF_PA * Math.pow(10, pk / 20)) / pa
					out.push(`its screen shows ${fmt(f0 * 10 * tb, 1)} waves across (${fmt(f0, 0)} Hz at ${full.time_base}), at the loudest ${fmt(tall, 2)} squares high from the middle line${tall > 4 ? " (off the screen: a larger Pa a square fits it)" : ""} (${full.scale})`)
				} else out.push("its screen shows a flat line (nothing heard over the room)")
			}
		}
		if ((item.type === "wave-rope" || item.type === "slinky") && st) {
			out.push(`wave speed ${fmt(last("speed"), 2)} m/s, wavelength ${fmt(last("wavelength"), 3)} m at ${fmt(last("frequency"), 2)} Hz`)
			{
				const tp = TYPES[item.type]
				const full = tp ? { ...tp.defaults(), ...P } : P
				const v = last("speed")
				// (held up, a free or open far end has no hold up and down: it hangs μ·g·L²/(2T) under its start, on the table if that is lower)
				if (item.type === "wave-rope" && full.lying !== "on the floor" && full.far_end !== "tied to the post" && full.tension > 0) {
					const g = isNum(run?.doc?.settings?.gravity) ? run.doc.settings.gravity : 9.81
					const drop = (full.weight * g * full.length * full.length) / (2 * full.tension)
					if (drop > full.height) out.push(`held up, its free far end hangs ${fmt(drop, 2)} m down (μ·g·L²/(2T)) and lies on the table: a free end's reflection shows on a rope lying on the floor (lying "on the floor"), or pulled tighter`)
				}
				if (full.shake === "keep shaking" && isNum(v) && isNum(full.length) && v > 0) {
					const n = (2 * full.length * full.frequency) / v
					const near = Math.round(n)
					out.push(near >= 1 && Math.abs(n - near) < 0.05 ? `driven at ${fmt(full.frequency, 2)} Hz = ${near}·v/(2L): its ${near}${near === 1 ? "st" : near === 2 ? "nd" : near === 3 ? "rd" : "th"} standing wave (${near} loop${near === 1 ? "" : "s"})` : `driven at ${fmt(full.frequency, 2)} Hz, between standing waves (n·v/(2L) = ${[1, 2, 3, 4].map((k) => fmt((k * v) / (2 * full.length), 2)).join(", ")} Hz)`)
					if (full.amplitude > 0.02 || full.damping < 1) out.push(`its shake ${fmt(full.amplitude * 100, 1)} cm with losses ${fmt(full.damping, 2)}/s: a standing wave will not settle into clean loops (needs ≤ 2 cm and ≥ 1/s)`)
				}
			}
			const arr = last("arrive")
			out.push(arr >= 0 ? `the wave reached the far end at ${fmt(arr, 3)} s` : "the wave never reached the far end in the run")
			const refl = last("reflection")
			if (refl !== null && refl !== -2) out.push(refl === -1 ? "the pulse came back upside down" : refl === 1 ? "the pulse came back the same way up" : "nothing came back from the far end")
			if (last("loops") > 0) out.push(`standing wave: ${last("loops")} loop${last("loops") === 1 ? "" : "s"}`)
			if (isNum(last("ribbon_across_mm"))) out.push(`the ribbon moved ${fmt(last("ribbon_across_mm"), 0)} mm across and ${fmt(last("ribbon_along_mm"), 0)} mm along`)
		}
		if (item.type === "string-telephone") {
			// (engine6 crossmod: what its string carries, and where an ear must be to hear it)
			const tp = TYPES[item.type]
			const full = tp ? { ...tp.defaults(), ...P } : P
			const g = isNum(run?.doc?.settings?.gravity) ? run.doc.settings.gravity : 9.81
			const { sag, D } = phone_shape(full.length, full.pull, full.string, g, isNum(item.y) ? item.y : 1)
			const carries = last("carries")
			if (carries === 1) out.push(`its ${full.string} carries sound: ${fmt(last("loss_db"), 1)} dB lost cup to cup (${fmt(full.length, 2)} m pulled with ${fmt(full.pull, 2)} N, sagging ${fmt(sag * 1000, 0)} mm); the sound runs along it at ${fmt(last("string_ms"), 0)} m/s`)
			else if (carries === 0 || !st)
				out.push(`its string carries NOTHING: ${full.pinched ? "it is pinched" : !(full.pull > 0) ? "it is slack (no pull: it hangs " + fmt(sag * 100, 0) + " cm)" : "it cannot carry"}; only the air brings the voice`)
			if (isNum(item.x)) out.push(`an ear (a sound-meter's microphone) hears it within 50 cm of its right cup's mouth, at x ${fmt(item.x + D / 2 + 0.09, 2)} m (and the left cup's, at x ${fmt(item.x - D / 2 - 0.09, 2)} m, for a sound at the right cup)`)
			if (st && isNum(last("struck")) && last("struck") > 0) out.push(`its child ${full.voice === "whisper" ? "whispered" : "talked"} into the left cup at ${fmt(full.talk_at, 2)} s for ${fmt(full.talk_for, 2)} s (${full.voice}, ${fmt(VOICES[full.voice], 0)} dB 1 m away)`)
		}
		if (item.type === "ripple-tank" && st) {
			out.push(`water waves: wavelength ${fmt(last("wavelength") * 100, 2)} cm, speed ${fmt(last("speed"), 3)} m/s at ${fmt(last("frequency"), 1)} Hz`)
			if (isNum(last("floater_bob_mm"))) out.push(`the ${P.floater ?? "duck"} bobs ${fmt(last("floater_bob_mm"), 1)} mm and drifts ${fmt(Math.abs(last("floater_drift")) * 1000, 1)} mm`)
		}
		if (SWINGERS.includes(item.type) && run?.track?.frames && run?.doc?.solids) {
			const sol = run.doc.solids.filter((s) => s.item === item.id && s.kind === "dynamic")
			if (sol.length) {
				const sid = sol[sol.length - 1].id
				const fr = run.track.frames.filter((f) => f.placements?.[sid])
				const per = swing_period(fr.map((f) => f.t), fr.map((f) => f.placements[sid].x))
				if (per !== null) out.push(`swings once every ${fmt(per, 3)} s (${fmt(1 / per, 3)} Hz)`)
			}
		}
		return out.length ? out : null
	},
	place: {},
	words: {
		change(type, key, a, b, nameOf) {
			void nameOf
			if (type === "oscilloscope" && key === "scale" && SCOPE_SCALE[a] && SCOPE_SCALE[b])
				return `${_trim(SCOPE_SCALE[a], 3)} → ${_trim(SCOPE_SCALE[b], 3)} Pa a square (the same sound drawn ${_trim(SCOPE_SCALE[a] / SCOPE_SCALE[b], 2)} × as tall)`
			if (type === "oscilloscope" && key === "time_base" && SCOPE_TIME[a] && SCOPE_TIME[b])
				return `${_trim(SCOPE_TIME[a] * 1000, 3)} → ${_trim(SCOPE_TIME[b] * 1000, 3)} ms a square (${_trim(SCOPE_TIME[b] / SCOPE_TIME[a], 2)} × as many waves across)`
			if (!isNum(a) || !isNum(b)) return null
			const tp = TYPES[type]
			const P0 = tp ? tp.defaults() : {}
			const pitch = (k, v) => pitchOf(type, { ...P0, [k]: v })
			if (type === "plucked-ruler" && key === "overhang")
				return `the ruler's overhang ${_trim(a * 100, 1)} → ${_trim(b * 100, 1)} cm (pitch ${fmt(pitch(key, a), 0)} → ${fmt(pitch(key, b), 0)} Hz)`
			if (type === "glass-bottle" && key === "fill") return `water ${_trim(a * 100, 0)} → ${_trim(b * 100, 0)} % full (pitch ${fmt(pitch(key, a), 0)} → ${fmt(pitch(key, b), 0)} Hz)`
			if (["monochord", "rubber-band", "xylophone-bar", "drum"].includes(type) && ["length", "tension", "gauge", "width", "diameter"].includes(key)) {
				const unit = { length: "m", tension: type === "drum" ? "N/m" : "N", gauge: "g/m", width: "mm", diameter: "m" }[key]
				return `${key} ${_trim(a, 3)} → ${_trim(b, 3)} ${unit} (pitch ${fmt(pitch(key, a), 0)} → ${fmt(pitch(key, b), 0)} Hz)`
			}
			if (key === "strength") return `struck ${_trim(b / a, 2)} × as hard (${dbRatio(a, b)})`
			if (LISTENERS.includes(type) && key === "x") return `the ${type === "oscilloscope" ? "oscilloscope" : type === "hydrophone" ? "hydrophone" : "meter"} moved ${_trim(Math.abs(b - a), 2)} m ${b > a ? "right" : "left"}`
			if (type === "wave-rope" && key === "tension") return `the rope's tension ${_trim(a, 1)} → ${_trim(b, 1)} N (wave speed ${pct(Math.sqrt(a), Math.sqrt(b))})`
			if (key === "frequency") return `frequency ${_trim(a, 2)} → ${_trim(b, 2)} Hz (wavelength ${pct(1 / a, 1 / b)})`
			return null
		}
	}
}
