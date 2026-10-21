// The softbody module: things that change shape when they are pushed, and spring back (elastic) or stay changed (plastic).
// A port of machines/mod_softbody.py, line by line (same names, same order, same numbers); plain ES module, no dependencies beyond web/sim.
// web/sim/modules/index.js registers it (register_all, as a catalog file's) after the catalog files; its `plugin` export is the AI's view of it
// (goal kinds, digest, knobs, prompt lines, change words: web/sim/plugins.js). The engine side is tooling/src/sim/modules/softbody.ts with the
// physics in tooling/src/sim/softbody.ts. Sources: see the Python file's docstring ([SOFUOGLU], [TABOR], [CROSS], [FIBA], [JOHNSON], [GIBSON],
// [FPL], [PMMA], [ASM], [TRELOAR], [GENT], [ALLIANCE], [RAYLEIGH], [BOUNCE], [ISO2533]).
// (a module file takes everything from the framework object register_all gets: web/sim/items.js FRAMEWORK, its `py` = pymath.js)
let register, ItemType, Prop, Readout, register_goal_kind, register_build_hook, register_common_prop, MATERIALS, add_look, CATEGORIES, TYPES, props_of, define_material, GOAL_KINDS
let pyRound, pyRoundInt, floatRepr, fmtF, cos, sin, pymin, pymax
let F = null

export const MODULE = "softbody"
const CATEGORY = "Soft & bendy"
const G = 9.81

// ---------------------------------------------------------------- the beam materials: E (Pa), strength (Pa), ductile, damping ratio, ruler thickness (m)
// strength: a ductile beam's yield stress (past the moment that first yields it, σ·b·t²/6, it keeps a permanent bend), a brittle one's modulus of
// rupture (σ·b·t²/6 snaps it)
export const BEAM = {
	"varnished hardwood": [12.0e9, 100.0e6, false, 0.02, 0.0035,
		"Hardwood along the grain (maple, beech): E 11.9-12.6 GPa, modulus of rupture 103-109 MPa [FPL]; wood's damping ratio about 0.01-0.02."],
	pine: [8.9e9, 62.0e6, false, 0.02, 0.018, "Pine along the grain: E 8.5-8.9 GPa, modulus of rupture 59-65 MPa [FPL]; damping ratio about 0.02."],
	acrylic: [3.2e9, 110.0e6, false, 0.025, 0.003,
		"Acrylic (PMMA): E 3.1-3.3 GPa, flexural strength about 110 MPa [PMMA]; loss factor about 0.05 (damping ratio 0.025, approximate)."],
	steel: [200.0e9, 500.0e6, true, 0.002, 0.0005,
		"Stainless rule steel: E 193-200 GPa [ASM]; yield 500 MPa used (cold-rolled 301/304 strip is 500-1300 MPa); damping ratio about 0.002."],
	aluminium: [69.0e9, 240.0e6, true, 0.003, 0.0015, "Aluminium 6061/6063-T6: E 69 GPa, yield 214-276 MPa (240 used) [ASM]; damping ratio about 0.003."],
	card: [3.5e9, 25.0e6, true, 0.04, 0.001,
		"Paperboard: E about 3-5 GPa along the machine direction, strength about 20-40 MPa (approximate); it creases (a permanent bend) rather than snaps."]
}
const RULER_MATERIALS = ["varnished hardwood", "acrylic", "steel", "aluminium"]
const PLANK_MATERIALS = ["pine", "varnished hardwood", "aluminium", "steel", "acrylic", "card"]
const BEAM_DENSITY = { pine: 500.0, card: 700.0 }

// ---------------------------------------------------------------- rubber bands [ALLIANCE] [TRELOAR] [GENT]
export const BAND_SIZES = { thin: 1.6e-3 * 0.79e-3, medium: 6.35e-3 * 0.79e-3, thick: 12.7e-3 * 0.79e-3 } // one strand's cross-section, m²
const RUBBER_E = 1.5e6 // Pa: natural rubber, E = 3G with G ≈ 0.5 MPa [TRELOAR]
const RUBBER_LOCK = 40.0 // Gent's J_m: the strand's stretch stiffens toward λ ≈ 6.5 (a band breaks about there) [GENT]
const RESILIENCE = 0.8 // the share of its pull a shortening band gives back (natural rubber's rebound resilience, about 0.75-0.85)
// λ at which a band snaps: natural-rubber gum stretches 700-800 % in a tensile test (Mark, Erman & Roland, The Science and Technology of Rubber,
// 4th ed., 2013, ch. 1); an office band, cut from tube with nicked edges, breaks sooner, at about 500 % (6 × its length; approximate). On the
// Gent curve (J_m 40) that is about 18 MPa: a #64 strand (6.35 × 0.79 mm) then pulls about 90 N.
export const BAND_SNAP = 6.0
export const BAND_CARS = ["toy-car", "cart", "truck"]
export const AXLE_R = 0.0015 // m: a band car's axle, a 3 mm bamboo skewer (the usual school build), the band winds onto

// ---------------------------------------------------------------- clay [SOFUOGLU] [TABOR]
export const CLAY_FLOW = { firm: 175000.0, normal: 120000.0, soft: 80000.0 } // Pa: plasticine's flow stress, cold, at room temperature, warm
const CLAY_DENSITY = 1570.0 // kg/m³: Van Aken plasticine (Eckerson et al. 2008), as items.py's modelling clay
const DENT = 3.0 // the flow pressure over the flow stress (Tabor's ≈ 3: physics.ts DENT_PRESSURE)
const CLAY_STIFF = 50.0 // the clay's elastic part: this many times its flow resistance 2π·R·p (it springs back about 2 % of a dent)

// ---------------------------------------------------------------- the inflated and foam balls
// key: [name, diameter m, mass kg, wall m, gauge Pa, [e_flat, e_top, p_half kPa] [BOUNCE], most kPa, material, look, description, source]
export const BALLS = {
	"playground-ball": ["Playground ball", 0.216, 0.4, 0.0025, 14000.0, [0.3, 0.85, 3.1], 35.0, "playground rubber", "playground",
		"A red rubber playground ball (8.5 inch). It flattens where it lands or is pressed and springs back round; pumped up harder it " +
		"bounces higher.",
		"8.5 in (21.6 cm) rubber playground ball, about 0.4 kg, inflated to about 2 psi (14 kPa; makers say 1.5-2.5 psi; 35 kPa, 5 psi, " +
		"the most here: past it the skin overstretches). Contact force = over-pressure × the flat's area [CROSS], the gas compressed as it " +
		"flattens [ISO2533]; bounce e 0.75 at 14 kPa, rising with the pressure [BOUNCE]."],
	"exercise-ball": ["Exercise ball", 0.65, 1.1, 0.002, 4000.0, [0.25, 0.8, 1.5], 10.0, "exercise PVC", "exercise",
		"A big, soft inflated exercise ball (65 cm). It squashes a lot under a weight or when it lands, and springs back.",
		"65 cm PVC exercise (Swiss) ball, about 1.1 kg, at about 4 kPa over the air (0.6 psi; a 70 kg person sitting on it presses it about 10 cm, " +
		"approximate; 10 kPa the most here) [CROSS] [ISO2533]; bounce e 0.65 at 4 kPa, rising with the pressure [BOUNCE]."]
}

/** [BOUNCE] An inflated ball's coefficient of restitution at a gauge pressure (kPa): e_flat + (e_top − e_flat)·p/(p + p_half). */
export function bounce_e(fit, kpa) {
	const [e_flat, e_top, half] = fit
	const p = pymax(0.0, kpa)
	return e_flat + ((e_top - e_flat) * p) / (p + half)
}
// the foams a foam ball can be, and the share of its landing speed it leaves the floor with (mod_softbody.py FOAMS [D3574], approximate)
const FOAMS = { "stress ball": 0.55, "slow foam": 0.2 }
const FOAM = ["Foam ball", 0.07, 0.022, 100000.0, 0.3, 0.55,
	"A squishy foam stress ball (7 cm). Squeeze it and it springs back.",
	"Flexible polyurethane foam ball, 7 cm, about 22 g (≈ 120 kg/m³): E about 0.1 MPa, ν 0.3 [GIBSON]; Hertz contact [JOHNSON]; bounce e ≈ 0.55 (approximate)."]

export function register_all(g) {
	;({ register, ItemType, Prop, Readout, register_goal_kind, register_build_hook, register_common_prop, MATERIALS, add_look, CATEGORIES, TYPES, props_of, define_material, GOAL_KINDS } = g)
	;({ pyRound, pyRoundInt, floatRepr, fmtF, cos, sin, pymin, pymax } = g.py)
	F = g
	if (!CATEGORIES.includes(CATEGORY)) CATEGORIES.push(CATEGORY)
	_looks()
	_materials()
	_clay()
	_balls()
	_rulers()
	_band_launcher()
	_coil_spring()
	_band_cars()
	_goals()
}

function _looks() {
	add_look("playground", { fill: "#d6342b", shade: "#a3231c", roughness: 0.62, metalness: 0.0, clearcoat: 0.1 })
	add_look("exercise", { fill: "#3a7bd5", shade: "#285aa0", roughness: 0.45, metalness: 0.0, clearcoat: 0.2 })
	add_look("foam ball", { fill: "#f5c433", shade: "#c99a1c", roughness: 0.95, metalness: 0.0, clearcoat: 0.0 })
	add_look("acrylic", { fill: "#e8f1f6", shade: "#b9c9d3", roughness: 0.08, metalness: 0.0, clearcoat: 0.6, transmission: 0.55 })
	add_look("rubber band", { fill: "#c98a5a", shade: "#9a6239", roughness: 0.7, metalness: 0.0, clearcoat: 0.0 })
}

function _mat(key, kw) {
	const v = { ...kw }
	if (!("rolling" in v)) v.rolling = 0.0
	if (!("side" in v)) v.side = 0.0
	// (every number a float in the Python: no int keys)
	if (!(key in MATERIALS)) define_material(key, v, [])
}

function _materials() {
	_mat("soft clay", {
		density: CLAY_DENSITY, bounce: 0.05, friction: 0.9, rolling: 0.3, look: "clay",
		source: "Plasticine 1570 kg/m³ (Eckerson et al. 2008); its flow stress 0.08-0.175 MPa [SOFUOGLU]: it squashes on every hit and keeps the dent " +
			"(tooling/src/sim/softbody.ts, law clay). Friction 0.9 and rolling 0.3 as items.py's modelling clay (provisional)."
	})
	_mat("playground rubber", {
		density: 1100.0, bounce: 0.75, friction: 0.7, rolling: 0.02, look: "playground",
		source: "A rubber playground ball's skin (about 1100 kg/m³); its weight is set per item. Its bounce comes from its soft contact (softbody law pressure)."
	})
	_mat("exercise PVC", {
		density: 1300.0, bounce: 0.65, friction: 0.6, rolling: 0.02, look: "exercise",
		source: "PVC film about 1300 kg/m³; the ball's weight is set per item. Its bounce comes from its soft contact (softbody law pressure)."
	})
	_mat("polyurethane foam", {
		density: 120.0, bounce: 0.55, friction: 0.8, rolling: 0.03, look: "foam ball",
		source: "Flexible polyurethane foam about 120 kg/m³ [GIBSON]; its bounce comes from its soft contact (softbody law hertz)."
	})
	_mat("acrylic", { density: 1190.0, bounce: 0.6, friction: 0.4, rolling: 0.0, look: "acrylic", source: "Acrylic (PMMA) 1190 kg/m³ [PMMA]; friction and bounce provisional." })
	_mat("pine", { density: 500.0, bounce: 0.6, friction: 0.45, rolling: 0.0, look: "light wood", source: "Pine about 450-550 kg/m³ [FPL]; friction as wood on wood (provisional)." })
	_mat("card", {
		density: 700.0, bounce: 0.3, friction: 0.45, rolling: 0.0, look: "cardboard",
		source: "Solid paperboard (card) about 700 kg/m³ (approximate); friction and bounce provisional."
	})
	_mat("rubber band", {
		density: 1100.0, bounce: 0.3, friction: 0.8, rolling: 0.0, look: "rubber band",
		source: "Natural rubber about 920-1100 kg/m³; a leather or rubber pouch grips (friction 0.8 provisional)."
	})
}

// ---------------------------------------------------------------- clay
function _clay() {
	const build = (c, P) => {
		const R = P.diameter / 2
		const sigma = CLAY_FLOW[P.softness]
		const p = DENT * sigma
		const sid = c.ball("clay", R, 0.0, 0.0, { material: c.mat({ density: CLAY_DENSITY }), look: "clay", words: "a ball of modelling clay" })
		c.process("softbody", "soft", {
			role: "ball", solid: sid, law: "clay", R: pyRound(R, 5), flow: pyRound(p, 1),
			kc: pyRound(CLAY_STIFF * 2 * Math.PI * R * p, 3), e: 0.05, hard: pyRound(0.3 * R, 5)
		})
	}
	register(new ItemType("soft-clay", "Squashy clay ball", CATEGORY, build, {
		material: "soft clay", materials: ["soft clay"], module: MODULE,
		props: [new Prop("diameter", "Diameter", 0.06, 0.02, 0.2, 0.002, "m"),
			new Prop("softness", "Softness", "normal", {
				kind: "choice", choices: Object.keys(CLAY_FLOW),
				help: "firm: cold clay (flows at 0.175 MPa); normal: room temperature (0.12 MPa); soft: warmed in the hands (0.08 MPa)"
			})],
		readouts: [new Readout("dent_mm", "Dent (stays)", { unit: "mm", digits: 1, help: "How deep its deepest flat spot is: the squash it keeps" }),
			new Readout("squash_mm", "Squash now", { unit: "mm", digits: 1, help: "How flat it is pressed where it touches, now" }),
			new Readout("force_n", "Pushing force", { unit: "N", digits: 2, help: "What presses on it where it touches" })],
		tags: ["clay", "plasticine", "play-doh", "squash", "squish", "dent", "flatten", "plastic", "deform", "keeps its shape", "mould"],
		description: "A ball of modelling clay that SQUASHES: it flattens where it lands, is hit or pressed, and keeps the dent (it does not " +
			"spring back or bounce). A heavy weight on it flattens it a little; a hard throw flattens it a lot.",
		source: "Plasticine 1570 kg/m³; flow stress 0.08-0.175 MPa [SOFUOGLU], dent pressure 3 × that [TABOR]: dropped 1 m, a 6 cm ball flattens " +
			"about 7 mm (½mv² = p·π·R·δ²). tooling/src/sim/softbody.ts law clay.",
		anchor: "its middle", facts: "6 cm · 177 g · keeps its dents", edit: [{ kind: "radius", prop: "diameter" }]
	}))
}

// ---------------------------------------------------------------- inflated and foam balls
function _shell_density(R, wall, mass) {
	const inner = R - wall
	return mass / ((4.0 / 3.0) * Math.PI * (R * R * R - inner * inner * inner))
}

function _balls() {
	const inflated = (key) => {
		const [name, d0, m0, wall, gauge0, fit, most, material, look, description, source] = BALLS[key]
		const build = (c, P) => {
			const R = P.diameter / 2
			const mass = P.mass
			const gauge = P.pressure * 1000.0
			const w = pymin(wall, R / 4)
			const sid = c.ball("ball", R, 0.0, 0.0, { material: c.mat({ density: pyRound(_shell_density(R, w, mass), 4) }), wall: w, look, words: `a ${name.toLowerCase()}` })
			// (its bounce from its pressure [BOUNCE]; the gas stiffens it smoothly as it flattens, so planck's rigid stop is kept for 0.85 R)
			c.process("softbody", "soft", {
				role: "ball", solid: sid, law: "pressure", R: pyRound(R, 5), gauge: pyRound(gauge, 1), e: pyRound(bounce_e(fit, P.pressure), 4),
				hard: pyRound(0.85 * R, 5)
			})
		}
		register(new ItemType(key, name, CATEGORY, build, {
			material, materials: [material], module: MODULE,
			props: [new Prop("diameter", "Diameter", d0, pyRound(d0 / 3, 3), pyRound(d0 * 2, 3), 0.005, "m"),
				new Prop("mass", "Weight", m0, pyRound(m0 / 4, 3), pyRound(m0 * 4, 3), 0.01, "kg"),
				new Prop("pressure", "Air pressure", pyRound(gauge0 / 1000.0, 1), 0.5, most, 0.5, "kPa",
					"How hard it is pumped up (over the air outside): pumped harder it squashes less and bounces higher (it leaves the floor " +
					`at ${floatRepr(pyRound(bounce_e(fit, 2.0), 2))} of the speed it lands with at 2 kPa, ${floatRepr(pyRound(bounce_e(fit, gauge0 / 1000.0), 2))} at ` +
					`${floatRepr(pyRound(gauge0 / 1000.0, 1))}, ${floatRepr(pyRound(bounce_e(fit, most), 2))} at ${floatRepr(most)} kPa)`)],
			readouts: [new Readout("squash_mm", "Squash", { unit: "mm", digits: 1, help: "How flat it is pressed where it touches, now" }),
				new Readout("force_n", "Pushing force", { unit: "N", digits: 2, help: "What presses on it where it touches" }),
				new Readout("energy_j", "Stored energy", { unit: "J", digits: 3, help: "The energy its squash holds (it gives it back as it springs round)" })],
			tags: ["ball", "bouncy", "bounce", "squash", "squishy", "elastic", "springs back", "inflated", "pumped up", "flat ball", "air pressure", "rubber",
				"deform", "soft"],
			description, source: source + " tooling/src/sim/softbody.ts law pressure.",
			anchor: "its middle", facts: `${floatRepr(pyRound(d0 * 100, 1))} cm · ${floatRepr(m0)} kg · ${floatRepr(pyRound(gauge0 / 1000.0, 1))} kPa`,
			edit: [{ kind: "radius", prop: "diameter" }]
		}))
	}
	for (const key of Object.keys(BALLS)) inflated(key)

	const [name, d0, m0, E, nu, e, description, source] = FOAM
	const build_foam = (c, P) => {
		const R = P.diameter / 2
		const vol = (4.0 / 3.0) * Math.PI * R * R * R
		const slow = P.foam === "slow foam"
		const sid = c.ball("ball", R, 0.0, 0.0, { material: c.mat({ density: pyRound(P.mass / vol, 3) }), look: "foam ball", words: slow ? "a slow-foam ball" : "a foam stress ball" })
		c.process("softbody", "soft", { role: "ball", solid: sid, law: "hertz", R: pyRound(R, 5), E: pyRound(P.stiffness * 1000.0, 1), nu, e: FOAMS[P.foam], hard: pyRound(0.6 * R, 5) })
	}
	register(new ItemType("foam-ball", name, CATEGORY, build_foam, {
		material: "polyurethane foam", materials: ["polyurethane foam"], module: MODULE,
		props: [new Prop("diameter", "Diameter", d0, 0.03, 0.2, 0.002, "m"),
			new Prop("mass", "Weight", m0, 0.005, 0.2, 0.001, "kg"),
			new Prop("stiffness", "Foam stiffness", pyRound(E / 1000.0, 1), 20.0, 1000.0, 5.0, "kPa", "Its foam's Young's modulus: softer squashes more"),
			new Prop("foam", "Foam", "stress ball", { kind: "choice", choices: Object.keys(FOAMS),
				help: "stress ball: springy polyurethane foam, it leaves the floor at 0.55 of the speed it lands with; slow foam: " +
					"memory foam that barely bounces (0.2: a soft ball that lands and stays)" })],
		readouts: [new Readout("squash_mm", "Squash", { unit: "mm", digits: 1, help: "How flat it is pressed where it touches, now" }),
			new Readout("force_n", "Pushing force", { unit: "N", digits: 2, help: "What presses on it where it touches" }),
			new Readout("energy_j", "Stored energy", { unit: "J", digits: 4, help: "The energy its squash holds" })],
		tags: ["stress ball", "foam", "squishy", "squeeze", "elastic", "springs back", "soft", "sponge ball", "deform", "soft ball", "memory foam"],
		description: description + " Slow foam (memory foam) barely bounces: a soft ball that lands and stays.",
		source: source + " Slow foam e ≈ 0.2 [D3574]. tooling/src/sim/softbody.ts law hertz.",
		anchor: "its middle", facts: "7 cm · 22 g · soft foam", edit: [{ kind: "radius", prop: "diameter" }]
	}))
}

// ---------------------------------------------------------------- bending beams
/** N segments of a beam from x0 (item frame, along s = +1 right or -1 left), their bottom at height y, and the softbody record that joins and
 *  bends them (each joint: where one segment ends and the next begins). `clamp`: [the static part they leave (its end at x0), its length], or
 *  null (a free beam). */
function _beam(c, P, { mat, L, t, b, s, y, x0, clamp, N }) {
	const [E, strength, ductile, zeta] = BEAM[mat]
	const rho = mat in BEAM_DENSITY ? BEAM_DENSITY[mat] : MATERIALS[mat].density
	const tc = pymax(t, 0.002)
	const seg = L / N
	const I = (b * t * t * t) / 12.0
	const EI = E * I
	// its first mode: a clamped beam's (1.8751²), a free one's resting on its ends (π²) [RAYLEIGH]
	const shape = clamp ? 1.8751 * 1.8751 : Math.PI * Math.PI
	const omega = shape * Math.sqrt(EI / (rho * b * t * L * L * L * L))
	const material = c.mat({ base: mat, density: pyRound((rho * t) / tc, 3) })
	const sids = []
	for (let i = 0; i < N; i++) sids.push(c.slab(`seg${i + 1}`, seg, tc, b, s * (x0 + (i + 0.5) * seg), y + tc / 2, { material, kind: "dynamic", words: "a bending beam" }))
	const joints = []
	let prev = clamp ? clamp[0] : null
	for (let i = 0; i < N; i++) {
		const part = `seg${i + 1}`
		if (prev !== null) {
			// (the pin and the bend are the engine's softbody beam joint: no document pin, so nothing draws an axle there)
			// (at a clamp the spring stands for half a segment: 2·EI/ℓ, made a little stiffer, EI/(ℓ·(1/2 − 1/(6N))), so an end load bends the N pieces
			// exactly as F·L³/(3EI) (the plain rigid-segment method gives 1 + 1/(2N²) of it))
			const k = ((clamp && i === 0 ? 1.0 / (0.5 - 1.0 / (6.0 * N)) : 1.0) * EI) / seg
			const j = { a: c.sid(prev), b: c.sid(part), k: pyRound(k, 6), c: pyRound((2 * zeta * k) / omega, 9) }
			if (ductile) j.my = pyRound((strength * b * t * t) / 6.0, 6)
			else j.mu = pyRound((strength * b * t * t) / 6.0, 6)
			joints.push(j)
		}
		prev = part
	}
	const rec = { role: "beam", solids: sids, joints, tip: { x: pyRound((s * seg) / 2, 6), y: 0.0 }, ductile, segment: pyRound(seg, 6) }
	if (clamp) Object.assign(rec, { clamp: c.sid(clamp[0]), base: { x: pyRound((s * clamp[1]) / 2, 6), y: 0.0 }, axis: { x: s, y: 0.0 } })
	c.process("softbody", "beam", rec)
	return sids
}

const EDGE = 0.004 // m: a clamped beam's block or stand ends this far short of where it starts to bend

function _thickness(P, mat) {
	const t = P.thickness_mm / 1000.0
	return t > 0 ? t : BEAM[mat][4]
}

function _segments(L, size) {
	return pymax(6, pymin(16, pyRoundInt(L / size)))
}

const BEAM_READOUTS = () => [
	new Readout("bend_mm", "Bend", { unit: "mm", digits: 1, help: "How far its end is below the straight line it had (a free plank: how far its middle sags)" }),
	new Readout("energy_j", "Stored energy", { unit: "J", digits: 4, help: "The energy its bend holds (it gives it back as it springs straight)" }),
	new Readout("set_deg", "Permanent bend", { unit: "°", digits: 1, help: "A metal or card beam bent too far keeps this much bend" }),
	new Readout("broken", "Broken", { unit: "", digits: 0, help: "1 once it has snapped (wood, acrylic) or creased 10° or more (card, metal): the fracture module's breaks goal reads it" })
]

function _rulers() {
	const build_ruler = (c, P) => {
		const mat = P.material
		const L = P.length
		const ov = pymin(P.overhang, L - 0.04)
		const t = _thickness(P, mat)
		const b = P.width
		const s = P.facing === "right" ? 1 : -1
		const BW = 0.1
		const BH = 0.05
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		// (the block's edge 4 mm short of the bend's root, and the clamped part a ghost: the bending ruler's first piece touches neither as it bends)
		c.slab("block", BW, BH, 0.08, s * (-BW / 2 - EDGE), BH / 2, { kind: "static", material: wood, look: "wood", words: "a wooden block" })
		const held = L - ov
		const tc = pymax(t, 0.002)
		c.slab("held", held, tc, b, s * (-held / 2), BH + tc / 2, { kind: "static", material: c.mat({ base: mat, overrides: {} }), words: "the clamped end of the ruler", ghost: true })
		c.slab("clamp", 0.03, 0.012, b + 0.012, s * -0.02, BH + tc + 0.006, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "a clamp" })
		_beam(c, P, { mat, L: ov, t, b, s, y: BH, x0: 0.0, clamp: ["held", held], N: _segments(ov, 0.025) })
	}
	register(new ItemType("flex-ruler", "Bending ruler", CATEGORY, build_ruler, {
		material: "varnished hardwood", materials: RULER_MATERIALS, module: MODULE,
		props: [new Prop("overhang", "Overhang", 0.2, 0.05, 0.6, 0.005, "m", "How far it sticks out past the block's edge: the part that bends"),
			new Prop("length", "Ruler length", 0.3, 0.15, 1.0, 0.01, "m", "The whole ruler (15 cm, 30 cm, a metre stick); 4 cm at least stay clamped"),
			new Prop("thickness_mm", "Gauge", 0.0, 0.0, 10.0, 0.1, "mm", "Its thickness; 0: the material's usual ruler (wood 3.5, acrylic 3, steel 0.5, aluminium 1.5 mm)"),
			new Prop("width", "Width", 0.03, 0.01, 0.08, 0.001, "m", "Front to back"),
			new Prop("facing", "Sticks out to", "right", { kind: "choice", choices: ["right", "left"] })],
		readouts: BEAM_READOUTS(),
		tags: ["ruler", "bend", "bending", "cantilever", "flex", "springy", "deflection", "hooke", "elastic", "diving board", "beam", "stiffness"],
		description: "A ruler clamped to a wooden block, sticking out over the block's edge. A load on its end bends it down (twice the load, twice the " +
			"bend; twice as long, 8 times the bend), and it springs back straight when the load is gone. Wood and acrylic snap if bent too far; " +
			"steel and aluminium keep a permanent bend.",
		source: "Euler-Bernoulli cantilever: tip deflection F·L³/(3·E·I), I = b·t³/12 [RAYLEIGH]; E and strength from [FPL] [PMMA] [ASM]. Built of 4-14 " +
			"rigid segments with bending springs E·I/ℓ (tooling/src/sim/softbody.ts role beam: within 1 % of F·L³/(3EI)).",
		anchor: "the floor under the block's edge, where the ruler leaves the block", facts: "30 cm wooden ruler · 20 cm over the edge",
		edit: [{ kind: "length", prop: "overhang" }]
	}))

	const build_board = (c, P) => {
		const mat = P.material
		const L = P.length
		const t = P.thickness_mm / 1000.0
		const b = P.width
		const s = P.facing === "right" ? 1 : -1
		const H = P.stand_height
		const SW = 0.15
		const tc = pymax(t, 0.002)
		c.slab("stand", SW, H, pymax(0.1, b), s * (-SW / 2 - EDGE), H / 2, {
			kind: "static", material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "dark wood", words: "the board's stand"
		})
		const held = 0.2
		c.slab("held", held, tc, b, s * (-held / 2), H + tc / 2, { kind: "static", material: c.mat({ base: mat, overrides: {} }), words: "the board's fixed end", ghost: true })
		c.slab("clamp", 0.05, 0.02, b + 0.02, s * -0.03, H + tc + 0.01, { kind: "static", material: c.mat({ base: "steel", overrides: {} }), look: "steel", words: "the board's bolted clamp" })
		_beam(c, P, { mat, L, t, b, s, y: H, x0: 0.0, clamp: ["held", held], N: _segments(L, 0.08) })
	}
	register(new ItemType("springboard", "Diving board", CATEGORY, build_board, {
		material: "pine", materials: PLANK_MATERIALS, module: MODULE,
		props: [new Prop("length", "Length", 1.0, 0.2, 5.0, 0.01, "m", "The part past its stand: the part that bends"),
			new Prop("thickness_mm", "Gauge", 18.0, 1.0, 80.0, 0.5, "mm", "Its thickness: the bend falls as the thickness cubed (twice as thick, 8 times less bend)"),
			new Prop("width", "Width", 0.25, 0.03, 0.6, 0.005, "m", "Front to back"),
			new Prop("stand_height", "Stand height", 0.3, 0.05, 1.5, 0.01, "m"),
			new Prop("facing", "Sticks out to", "right", { kind: "choice", choices: ["right", "left"] })],
		readouts: BEAM_READOUTS(),
		tags: ["diving board", "springboard", "board", "plank", "bend", "spring", "cantilever", "bounce", "elastic", "launch"],
		description: "A board bolted on a stand at one end, its far end free (a diving board). A weight on the end bends it down; it springs " +
			"back and can throw what lands on it.",
		source: "Euler-Bernoulli cantilever F·L³/(3EI) [RAYLEIGH]; pine E 8.9 GPa [FPL], aluminium 69 GPa [ASM] (a pool's springboard is a 4.9 m " +
			"aluminium board). tooling/src/sim/softbody.ts role beam.",
		anchor: "the floor under the stand's edge, where the board leaves the stand", facts: "1 m pine board · 18 mm · on a 30 cm stand",
		edit: [{ kind: "length", prop: "length" }]
	}))

	const build_plank = (c, P) => {
		const mat = P.material
		const L = P.length
		const t = P.thickness_mm / 1000.0
		const b = P.width
		_beam(c, P, { mat, L, t, b, s: 1, y: 0.0, x0: -L / 2, clamp: null, N: _segments(L, 0.035) })
	}
	register(new ItemType("flex-plank", "Bendy plank", CATEGORY, build_plank, {
		material: "pine", materials: PLANK_MATERIALS, module: MODULE,
		props: [new Prop("length", "Length", 0.6, 0.1, 5.0, 0.01, "m"),
			new Prop("thickness_mm", "Gauge", 6.0, 0.3, 60.0, 0.1, "mm", "Its thickness: a card strip is about 1 mm, a thin plank 6 mm, a shelf board 18 mm"),
			new Prop("width", "Width", 0.1, 0.01, 0.6, 0.005, "m", "Front to back")],
		readouts: BEAM_READOUTS(),
		tags: ["bridge", "plank", "beam", "board", "card", "strip", "sag", "bend", "span", "load", "paper bridge", "elastic"],
		description: "A plank (or a card or metal strip) that rests on whatever is under it. Laid across two supports it is a bridge: it sags in " +
			"the middle under a load (centre load: F·L³/(48EI)), springs back when unloaded; card creases and wood snaps when overloaded.",
		source: "Euler-Bernoulli beam on two supports: centre deflection F·L³/(48·E·I) [RAYLEIGH]; materials [FPL] [PMMA] [ASM]. tooling/src/sim/softbody.ts role beam.",
		anchor: "the middle of its underside", facts: "60 cm pine · 6 mm thick · 10 cm wide", edit: [{ kind: "length", prop: "length" }]
	}))
}

// ---------------------------------------------------------------- the rubber-band launcher
const BOARD = [0.35, 0.3, 0.012, 0.08] // m: the launch board reaches 35 cm behind the posts and 30 cm past them; 12 mm thick, 8 cm wide

function _band_launcher() {
	const build = (c, P) => {
		const H = P.height
		const d = P.draw
		const spread = pymax(P.spread, BOARD[3] + 0.01)
		const n = Math.trunc(P.bands)
		const [back_len, front_len, bt, bw] = BOARD
		// the launch board: a car or a block sits on it in front of the pouch and rolls off its front end; the two posts the band is hooked on stand
		// at x = 0 beside it (front and back of the launch line: what is launched passes between them; the 3D view draws them and the band)
		c.slab("board", back_len + front_len, bt, bw, (front_len - back_len) / 2, bt / 2, {
			kind: "static", material: c.mat({ base: "varnished hardwood", overrides: {} }), look: "wood", words: "the launcher's board"
		})
		const y = bt + H
		// the pouch: a shallow V (two light rubber flaps welded at its back), its open side toward +x, its tips at x = -draw
		const pouch = c.mat({ base: "rubber band", density: pyRound(0.002 / (0.016 * 0.003 * 0.03 * 2), 3) })
		const arm = 0.016
		const th = 0.003
		const ang = 25.0
		const rad = (ang * Math.PI) / 180.0
		const back = -d - arm * cos(rad)
		const sid = c.slab("pouch", th, 0.004, 0.03, back, y, { material: pouch, kind: "dynamic", words: "the launcher's pouch", angularDamping: 40.0 })
		for (const [k, sgn] of [[1, 1], [2, -1]]) {
			// (each flap welded to the pouch's back: its middle in the pouch's frame, turned ±25° so its tip reaches x = -draw)
			c.slab(`flap${k}`, arm, th, 0.03, 0.0, 0.0, { material: pouch, kind: "dynamic", words: "the launcher's pouch" })
			const s = c.sb.solids[c.sb.solids.length - 1]
			s.parent = sid
			s.at = { x: pyRound((arm / 2) * cos(rad), 5), y: pyRound(((sgn * arm) / 2) * sin(rad), 5) }
			s.angle = pyRound(sgn * rad, 6)
		}
		const [ax, ay] = c.world(0.0, y)
		c.process("softbody", "band", {
			role: "band", pad: sid, anchor: { x: pyRound(ax, 6), y: pyRound(ay, 6) }, spread: pyRound(spread, 5),
			l0: pyRound(spread / 2 / 1.05, 6), area: BAND_SIZES[P.band], E: RUBBER_E, n, resilience: RESILIENCE, lock: RUBBER_LOCK, snap: BAND_SNAP
		})
	}
	register(new ItemType("band-launcher", "Rubber-band launcher", CATEGORY, build, {
		module: MODULE,
		props: [new Prop("draw", "Pulled back", 0.1, 0.0, 0.2, 0.005, "m",
			"How far the pouch is pulled back behind the posts (more: more stretch, more energy). 20 cm at most: the band is then about 5 times " +
			"its length; at 6 times a rubber band snaps"),
			new Prop("bands", "Bands", 1, 1, 4, 1, "", "Rubber bands each side, side by side (more: stiffer)", { kind: "int" }),
			new Prop("band", "Rubber band", "medium", {
				kind: "choice", choices: Object.keys(BAND_SIZES),
				help: "thin (#19, 1.6 mm wide), medium (#64, 6.35 mm), thick (#84, 12.7 mm): a wider band pulls harder"
			}),
			new Prop("spread", "Post spread", 0.1, 0.09, 0.3, 0.005, "m", "How far apart the two posts are (front to back), either side of the board"),
			new Prop("height", "Band height", 0.03, 0.005, 0.3, 0.001, "m", "The band's height above the board: the middle of a toy car's flat back (about 3 cm), a ball's middle (its radius)")],
		readouts: [new Readout("stretch_cm", "Band stretch", { unit: "cm", digits: 1, help: "How much longer each band is than unstretched" }),
			new Readout("tension_n", "Pull", { unit: "N", digits: 2, help: "How hard the bands pull the pouch toward the posts" }),
			new Readout("energy_j", "Stored energy", { unit: "J", digits: 3, help: "The elastic energy in the stretched bands" }),
			new Readout("broken", "Snapped", { unit: "", digits: 0, help: "1 once its band has snapped (stretched to 6 times its length)" })],
		tags: ["rubber band", "launcher", "slingshot", "catapult", "elastic", "stretch", "energy", "fling", "shoot", "launch", "potential energy"],
		description: "A launch board with a rubber band stretched between two posts at its front, its pouch pulled back. Put a toy car, a block or " +
			"a ball on the board just in front of the pouch: when the scene lets go the band snaps forward and flings it off the board's " +
			"front end (tilt the launcher to shoot up). Pulled farther, it stores more energy.",
		source: "Rubber strands: F = A0·(E/3)·(λ − 1/λ²) [TRELOAR], E 1.5 MPa, Gent-stiffened (J_m 40) [GENT]; band sizes [ALLIANCE]; it gives back " +
			"about 80 % of its pull as it shortens (rebound resilience); it snaps at 6 × its length (BAND_SNAP). tooling/src/sim/softbody.ts role band.",
		anchor: "the board's bottom under the posts", facts: "#64 band · pulled 10 cm · ≈ 0.6 J",
		edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- the coil spring
function _coil_spring() {
	const build = (c, P) => {
		const k = P.stiffness
		const rest = P.rest_length
		const W = P.width
		const damp = P.damping
		const th = 0.008
		const wood = c.mat({ base: "varnished hardwood", overrides: {} })
		c.slab("base", W + 0.04, 0.02, 0.1, 0.0, 0.01, { kind: "static", material: wood, look: "wood", words: "the spring's base" })
		const mp = 700.0 * W * th * 0.08
		const comp = pymin((mp * G) / k, rest * 0.8)
		const ply = c.mat({ base: "varnished hardwood", overrides: {} })
		const sid = c.slab("platform", W, th, 0.08, 0.0, 0.02 + rest - comp + th / 2, { material: ply, kind: "dynamic", words: "the spring's platform" })
		const cr = pymin(0.025, W / 3)
		c.joint("spring", "spring", {
			a: "base", b: "platform", anchorA: [0.0, 0.01], anchorB: [0.0, -th / 2], rest, stiffness: k, damping: damp,
			coils: pymax(6, pyRoundInt(rest / 0.01)), coilRadius: pyRound(cr, 4)
		})
		const [ux, uy] = c.world(0.0, 1.0)
		const [ox, oy] = c.world(0.0, 0.0)
		c.process("softbody", "guide", { role: "guide", solid: sid, axis: { x: pyRound(ux - ox, 6), y: pyRound(uy - oy, 6) } })
		// (its readings zeroed with the empty platform resting on it, as a lab zeroes its scale: `tare`, the platform's own squash)
		c.process("softbody", "readings", {
			role: "spring", a: c.sid("base"), b: sid, anchorA: { x: 0.0, y: 0.01 }, anchorB: { x: 0.0, y: pyRound(-th / 2, 5) }, rest, k, tare: pyRound(comp, 6)
		})
	}
	register(new ItemType("coil-spring", "Coil spring", CATEGORY, build, {
		module: MODULE,
		props: [new Prop("stiffness", "Stiffness", 200.0, 10.0, 5000.0, 5.0, "N/m", "How many newtons squash it by a metre: a stiffer spring squashes less"),
			new Prop("rest_length", "Length", 0.12, 0.03, 0.4, 0.005, "m", "Its length with nothing on it"),
			new Prop("width", "Platform width", 0.1, 0.04, 0.3, 0.005, "m"),
			new Prop("damping", "Damping", 0.5, 0.0, 20.0, 0.1, "N·s/m", "Friction that settles its bouncing")],
		readouts: [new Readout("compression_mm", "Squashed by", {
			unit: "mm", digits: 1, help: "How much what is on it squashes it: zeroed with the empty platform resting on it, as a lab zeroes its scale (each 100 g: 981 ÷ k mm)"
		}),
			new Readout("force_n", "Spring force", { unit: "N", digits: 2, help: "How hard it pushes back on what is on it (k × that squash: the load's weight once still)" }),
			new Readout("energy_j", "Stored energy", { unit: "J", digits: 4, help: "½·k·x² of that squash" })],
		tags: ["spring", "coil", "hooke", "compress", "squash", "elastic", "springs back", "weigh", "force", "stiffness", "potential energy"],
		description: "A coil spring standing on a base with a platform on top, kept upright by a guide. Weights on the platform squash it by " +
			"weight ÷ stiffness (Hooke's law: twice the weight, twice the squash); it springs back when they are taken off.",
		source: "Hooke's law F = k·x; stored energy ½·k·x² (textbook). The coil is the engine's spring joint; the guide is a straight slide.",
		anchor: "the middle of its base's bottom", facts: "200 N/m · 12 cm", edit: []
	}))
}

// ---------------------------------------------------------------- rubber-band cars (common props of toy cars, carts and trucks)
function _band_cars() {
	const applies = (t) => BAND_CARS.includes(t.key)
	register_common_prop(new Prop("band_turns", "Rubber-band turns", 0.0, 0.0, 30.0, 0.5, "turns",
		"A rubber band wound this many turns on its rear axle (0: none): it drives the car forward when the scene lets go"), applies)
	register_common_prop(new Prop("band_size", "Rubber band", "medium", {
		kind: "choice", choices: Object.keys(BAND_SIZES),
		help: "The band wound on its axle: thin, medium (#64) or thick: a thicker band pushes harder"
	}), applies)
	register_build_hook(_band_hook)
}

function _band_hook(sb, scene) {
	const ids = new Set(sb.solids.map((s) => s.id))
	for (const item of scene.items ?? []) {
		if (!BAND_CARS.includes(item.type)) continue
		const props = item.props ?? {}
		const turns = props.band_turns
		if (typeof turns !== "number" || !(turns > 0)) continue
		const size = Object.prototype.hasOwnProperty.call(BAND_SIZES, props.band_size) ? props.band_size : "medium"
		const iid = item.id
		const wheel = `${iid}/rear`
		const chassis = `${iid}/chassis`
		if (!ids.has(wheel) || !ids.has(chassis)) continue
		const P = props_of(item)
		const rec = { kind: "softbody", id: `${iid}/band`, item: iid, role: "motor", wheel, chassis }
		if (ids.has(`${iid}/front`)) rec.front = `${iid}/front`
		Object.assign(rec, {
			turns: pyRound(pymin(30.0, turns), 3), r: AXLE_R, l0: pyRound(0.6 * P.length, 5), area: BAND_SIZES[size],
			E: RUBBER_E, n: 2, resilience: RESILIENCE, lock: RUBBER_LOCK, sense: -1
		})
		sb.processes.push(rec)
	}
}

// ---------------------------------------------------------------- goals (machines/mod_softbody.py reports the same, number for number)
const DEFORM_KEYS = ["bend_mm", "dent_mm", "squash_mm", "compression_mm", "stretch_cm", "band_stretch_cm"]
const PEAK_KEYS = ["squash_mm", "stretch_cm", "band_stretch_cm"]

function _series(ctx, iid, key) {
	const v = ctx.state(iid, key)
	return v && v.length ? v.filter((x) => typeof x === "number") : null
}

/** [how much the item is deformed in mm at the end, at its most, the reading used] by its own reading: a beam's bend, clay's dent, a ball's
 *  squash, a spring's compression, a band's stretch (cm become mm); null when it has none. */
export function deformation(ctx, iid) {
	for (const key of DEFORM_KEYS) {
		const v = _series(ctx, iid, key)
		if (v && v.length) {
			const k = key.endsWith("_cm") ? 10.0 : 1.0
			let most = Math.abs(v[0])
			for (const x of v) most = pymax(most, Math.abs(x))
			return [v[v.length - 1] * k, most * k, key]
		}
	}
	return null
}

function _peak_energy(ctx, iid) {
	let best = null
	for (const key of ["energy_j", "band_energy_j"]) {
		const v = _series(ctx, iid, key)
		if (v && v.length) {
			let m = v[0]
			for (const x of v) m = pymax(m, x)
			best = best === null ? m : pymax(best, m)
		}
	}
	return best
}

function _snapped(ctx, iid) {
	const v = _series(ctx, iid, "broken")
	return !!(v && v.length) && v[v.length - 1] >= 1
}

/** [how high the item rises after its first landing (m), the time it landed] by its frames: the highest its centre gets before it comes down
 *  again, less where its centre was as it touched (its lowest point plus its squash there: the bottom of a ball's rise over what it landed on);
 *  null when it never falls 1 cm and turns back up. The mean of its moving parts for a thing of several. */
export function bounce_height(ctx, iid) {
	const sols = ctx.solids(iid, true).map((x) => x.id)
	if (!sols.length) return null
	const ys = []
	for (const f of ctx.frames) {
		const pl = f.placements
		let y = 0.0
		for (const sid of sols) {
			if (!Object.prototype.hasOwnProperty.call(pl, sid)) return null
			y += pl[sid].y
		}
		ys.push(y / sols.length)
	}
	let top = ys[0]
	let k1 = null
	for (let k = 1; k < ys.length - 1; k++) {
		top = pymax(top, ys[k])
		if (top - ys[k] >= 0.01 && ys[k] <= ys[k - 1] && ys[k] < ys[k + 1]) {
			k1 = k
			break
		}
	}
	if (k1 === null) return null
	const sq = ctx.state(iid, "squash_mm")
	const squash = sq !== null && k1 < sq.length && typeof sq[k1] === "number" ? sq[k1] : 0.0
	const touch = ys[k1] + squash / 1000.0
	let apex = ys[k1]
	for (let j = k1 + 1; j < ys.length; j++) {
		apex = pymax(apex, ys[j])
		if (j + 1 < ys.length && ys[j] <= ys[j - 1] && ys[j] < ys[j + 1]) break
	}
	return [pymax(0.0, apex - touch), ctx.times[k1]]
}

function _fmt(v) {
	const t = fmtF(v, 2)
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t
}

export function squashes(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.at_least_mm)
	least = least === null ? 1.0 : least
	const v = _series(ctx, g.item, "dent_mm")
	const dent = v && v.length ? v[v.length - 1] : null
	const ok = dent !== null && dent >= least - 1e-9
	return { label: g.label || `${ctx.name(g.item)} squashes and stays squashed`, ok, kind: "squashes", item: g.item, dent_mm: dent === null ? null : pyRound(dent, 2) }
}

export function springs_back(ctx, g) {
	if (!ctx.known(g.item)) return null
	const d = deformation(ctx, g.item)
	const dent = _series(ctx, g.item, "dent_mm")
	const set_deg = _series(ctx, g.item, "set_deg")
	const kept = (dent && dent.length ? dent[dent.length - 1] : 0.0) >= 0.5 || (set_deg && set_deg.length ? set_deg[set_deg.length - 1] : 0.0) >= 0.5 || _snapped(ctx, g.item)
	const peak = d === null ? null : d[1]
	const ok = peak !== null && peak >= 2.0 - 1e-9 && !kept
	return { label: g.label || `${ctx.name(g.item)} springs back`, ok, kind: "springs_back", item: g.item, peak_mm: peak === null ? null : pyRound(peak, 2) }
}

// (another module's "bends", registered before this one: the heat module's bimetal strip. A thing that is not one of these beams is judged by
// it, so both modules' items keep their own rule under the one kind; set by _goals)
let other_bends = null
export function bends(ctx, g) {
	if (!ctx.known(g.item)) return null
	if (other_bends !== null && !BEAM_TYPES.includes(ctx.items.get(g.item)?.type)) return other_bends(ctx, g)
	let lo = ctx.num(g.at_least_mm)
	const hi = ctx.num(g.at_most_mm)
	lo = lo === null && hi === null ? 1.0 : lo
	const v = _series(ctx, g.item, "bend_mm")
	const end = v && v.length ? v[v.length - 1] : null
	const ok = end !== null && (lo === null || end >= lo - 1e-9) && (hi === null || end <= hi + 1e-9)
	const bounds = (lo !== null ? ` at least ${_fmt(lo)} mm` : "") + (hi !== null ? ` at most ${_fmt(hi)} mm` : "")
	return { label: g.label || `${ctx.name(g.item)} bends${bounds}`, ok, kind: "bends", item: g.item, bend_mm: end === null ? null : pyRound(end, 2) }
}

export function deforms_more(ctx, g) {
	if (!ctx.known(g.a) || !ctx.known(g.b)) return null
	const da = deformation(ctx, g.a)
	const db = deformation(ctx, g.b)
	// (a squash or a band's stretch is judged at its most, a bend, a dent or a spring's compression where it ends)
	const va = da === null ? null : PEAK_KEYS.includes(da[2]) ? da[1] : da[0]
	const vb = db === null ? null : PEAK_KEYS.includes(db[2]) ? db[1] : db[0]
	// (by 5 % and 0.2 mm; bends under 1 mm, a stiff ruler's, by a quarter and 0.02 mm)
	const ok = va !== null && vb !== null && (va > vb * 1.05 + 0.2 || (va < 1.0 && va >= vb * 1.25 + 0.02))
	const out = {
		label: g.label || `${ctx.name(g.a)} bends or squashes more than ${ctx.name(g.b)}`, ok, kind: "deforms_more",
		a: g.a, b: g.b, a_mm: va === null ? null : pyRound(va, 2), b_mm: vb === null ? null : pyRound(vb, 2)
	}
	if (va !== null && vb !== null && Math.abs(va) < 1.0 && Math.abs(vb) < 1.0) out.small = true
	return out
}

export function stores(ctx, g) {
	if (!ctx.known(g.item)) return null
	let least = ctx.num(g.at_least_j)
	least = least === null ? 0.01 : least
	const e = _peak_energy(ctx, g.item)
	const ok = e !== null && e >= least - 1e-12
	return { label: g.label || `${ctx.name(g.item)} stores at least ${_fmt(least)} J`, ok, kind: "stores", item: g.item, energy_j: e === null ? null : pyRound(e, 4) }
}

export function bounces(ctx, g) {
	if (!ctx.known(g.item)) return null
	let lo = ctx.num(g.at_least_m)
	const hi = ctx.num(g.at_most_m)
	const bounds = (lo !== null ? ` at least ${_fmt(lo)} m` : "") + (hi !== null ? ` at most ${_fmt(hi)} m` : "")
	lo = lo === null && hi === null ? 0.02 : lo
	const b = bounce_height(ctx, g.item)
	const h = b === null ? null : b[0]
	const ok = h !== null && (lo === null || h >= lo - 1e-9) && (hi === null || h <= hi + 1e-9)
	return { label: g.label || `${ctx.name(g.item)} bounces${bounds}${bounds ? " high" : ""}`, ok, kind: "bounces", item: g.item, bounce_m: h === null ? null : pyRound(h, 3) }
}

export function bounces_more(ctx, g) {
	if (!ctx.known(g.a) || !ctx.known(g.b)) return null
	const ba = bounce_height(ctx, g.a)
	const bb = bounce_height(ctx, g.b)
	const ha = ba === null ? null : ba[0]
	const hb = bb === null ? null : bb[0]
	const ok = ha !== null && hb !== null && ha > hb * 1.05 + 0.01
	return {
		label: g.label || `${ctx.name(g.a)} bounces higher than ${ctx.name(g.b)}`, ok, kind: "bounces_more",
		a: g.a, b: g.b, a_m: ha === null ? null : pyRound(ha, 3), b_m: hb === null ? null : pyRound(hb, 3)
	}
}

function _goals() {
	other_bends = GOAL_KINDS?.get?.("bends") ?? null
	register_goal_kind("squashes", squashes)
	register_goal_kind("springs_back", springs_back)
	register_goal_kind("bends", bends)
	register_goal_kind("deforms_more", deforms_more)
	register_goal_kind("stores", stores)
	register_goal_kind("bounces", bounces)
	register_goal_kind("bounces_more", bounces_more)
}

// ================================================================ the AI's view of the module (web/sim/plugins.js)
export const SOFT_TYPES = ["soft-clay", "playground-ball", "exercise-ball", "foam-ball", "flex-ruler", "springboard", "flex-plank", "band-launcher", "coil-spring"]
const BEAM_TYPES = ["flex-ruler", "springboard", "flex-plank"]
const BALL_TYPES = ["playground-ball", "exercise-ball", "foam-ball"]
const trimNum = (v, d = 2) => {
	// (never "-0": a reading a hair under zero)
	const x = Number(v)
	const s = (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d)
	return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s
}
const cm = (m) => `${trimNum(m * 100, 1)} cm`
const MATERIAL_WORDS = { "varnished hardwood": "wood", pine: "pine", acrylic: "acrylic (plastic)", steel: "steel", aluminium: "aluminium", card: "card" }
const an = (w) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`)
const BAND_WORDS = { thin: "1.6 mm", medium: "6.35 mm", thick: "12.7 mm" }
/** A beam's own numbers from its props: E·I (N·m²), its free length L (m), its thickness (m), what a 100 g load at its end (or middle) bends it. */
export function beamNumbers(type, P) {
	const mat = P.material ?? (type === "flex-ruler" ? "varnished hardwood" : "pine")
	const B = BEAM[mat] ?? BEAM.pine
	const t = type === "flex-ruler" ? ((P.thickness_mm ?? 0) > 0 ? P.thickness_mm / 1000 : B[4]) : (P.thickness_mm ?? (type === "springboard" ? 18 : 6)) / 1000
	const b = P.width ?? (type === "flex-ruler" ? 0.03 : type === "springboard" ? 0.25 : 0.1)
	const L = type === "flex-ruler" ? Math.min(P.overhang ?? 0.2, (P.length ?? 0.3) - 0.04) : (P.length ?? (type === "springboard" ? 1.0 : 0.6))
	const EI = (B[0] * b * t * t * t) / 12
	const F = 0.1 * G
	const per100g = type === "flex-plank" ? (F * L * L * L) / (48 * EI) : (F * L * L * L) / (3 * EI)
	return { mat, E: B[0], t, b, L, EI, per100g, ductile: B[2] }
}
const startOf = (run, id, key) => {
	const v = run?.track?.state?.[id]?.[key]
	return Array.isArray(v) && v.length ? v[0] : null
}
const endOf = (run, id, key) => {
	const v = run?.track?.state?.[id]?.[key]
	return Array.isArray(v) && v.length ? v[v.length - 1] : null
}
const maxOf = (run, id, key) => {
	const v = run?.track?.state?.[id]?.[key]
	return Array.isArray(v) && v.length ? v.reduce((a, x) => Math.max(a, x), -Infinity) : null
}

/** A run as a goal check reads it (bounce_height's ctx): the item's solids, the frames, the readings. */
const runCtx = (run) => {
	const frames = run?.track?.frames ?? []
	return {
		frames,
		times: frames.map((f) => f.t),
		solids: (iid, dynamic = false) => (run?.doc?.solids ?? []).filter((x) => x.item === iid && (!dynamic || x.kind === "dynamic")),
		state: (iid, key) => {
			const v = run?.track?.state?.[iid]?.[key]
			return Array.isArray(v) ? v : null
		}
	}
}
/** What a thing of the run weighs (kg), from the document: each moving solid's volume × its material's density. */
const massOfItem = (run, iid) => {
	let m = 0
	for (const s of run?.doc?.solids ?? []) {
		if (s.item !== iid || s.kind !== "dynamic") continue
		const mat = run.doc.materials?.[s.material] ?? MATERIALS[String(s.material ?? "").replace(/ \[[^\]]*\]$/, "")]
		const b = s.body
		if (!mat || !b) continue
		let v = 0
		if (b.kind === "ball") v = (4 / 3) * Math.PI * (b.radius ** 3 - (b.wall > 0 && b.wall < b.radius ? (b.radius - b.wall) ** 3 : 0))
		else if (b.kind === "slab") v = b.width * b.height * (Number(b.depth) || 0) * (((b.taper ?? 1) + 1) / 2)
		else if (b.kind === "polygon" && Array.isArray(b.points)) {
			let a = 0
			const p = b.points
			for (let i = 0; i < p.length; i++) a += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y
			v = Math.abs(a / 2) * (Number(b.depth) || 0)
		}
		m += v * (mat.density ?? 0)
	}
	return m
}
/** The loads resting on a clamped ruler or board at the run's end: [{id, kg, a (m from where it leaves its block)}], by where their moving parts'
 *  middle is (over its free part, within 15 cm above its top). */
function loadsOn(item, run, n) {
	const last = run?.track?.frames?.at?.(-1)?.placements
	if (!last) return []
	const s = (run?.resolved?.[item.id]?.facing ?? item.props?.facing ?? "right") === "left" ? -1 : 1
	const x0 = Number(item.x) || 0
	const top = (Number(item.y) || 0) + (item.type === "flex-ruler" ? 0.05 : (run?.resolved?.[item.id]?.stand_height ?? item.props?.stand_height ?? 0.3)) + n.t
	const out = []
	for (const other of run?.scene?.items ?? []) {
		if (other.id === item.id) continue
		const sols = (run.doc?.solids ?? []).filter((x) => x.item === other.id && x.kind === "dynamic" && last[x.id])
		if (!sols.length) continue
		const cx = sols.reduce((a, x) => a + last[x.id].x, 0) / sols.length
		const cy = sols.reduce((a, x) => a + last[x.id].y, 0) / sols.length
		const a = s * (cx - x0)
		if (!(a > 0 && a <= n.L + 0.005 && cy > top - 0.02 && cy < top + 0.15)) continue
		out.push({ id: other.id, kg: massOfItem(run, other.id), a: Math.min(a, n.L) })
	}
	return out
}
/** The softbody types a module knob may turn only alone: changing one of two compared rulers' material is a second difference (not a fair test). */
const alone = (it, scene) => !(scene?.items ?? []).some((o) => o.id !== it.id && o.type === it.type)
const wound = (it) => (Number(it?.props?.band_turns) || 0) > 0
const eOf = (type, kpa) => (BALLS[type] ? bounce_e(BALLS[type][5], kpa) : null)

export const plugin = {
	title: "Soft and bendy things (elastic and plastic): squashing clay, bouncing and how high it bounces, bending rulers, stretched and wound rubber bands, coil springs",
	howto: [
		"ELASTIC things squash, bend or stretch under a push and spring back (they store energy and give it back); PLASTIC things (soft-clay) squash and KEEP the dent.",
		"soft-clay: a modelling-clay ball (6 cm, 177 g): dropped or hit it flattens where it lands and stays flat, it barely bounces (dropped 1 m: a 7 mm flat); a heavy weight resting on it dents it a little; `softness` firm | normal | soft (warm clay dents deeper). Its force_n reads everything pressing on it (a 1 kg mass on it on the table: about 21 N, the mass's push and the table's). playground-ball (21.6 cm, 0.4 kg, `pressure` 14 kPa, at most 35), exercise-ball (65 cm, 1.1 kg, 4 kPa, at most 10) and foam-ball (7 cm squishy foam, `stiffness` kPa): they flatten where they land or are pressed and spring back round, bouncing. MORE AIR BOUNCES HIGHER: dropped 1 m (its bottom 1 m above the table) a playground ball's first bounce rises 0.27 m at 2 kPa (nearly flat), 0.41 m at 5, 0.55 m at 14, 0.61 m at 30 kPa; an exercise ball 0.20 m at 1 kPa, 0.39 m at 4, 0.46 m at 8. Less pressure (or softer foam) squashes more. Readings: squash_mm, force_n, energy_j (clay also dent_mm: the squash it keeps). Check a bounce with bounces {item, at_least_m?} or bounces_more {a, b}.",
		"Bending beams: flex-ruler is a ruler CLAMPED to a 10 × 5 cm wooden block that stands on the table; its anchor is the floor under the block's edge and its free part (`overhang`, default 0.2 m) sticks out to the right of x (`facing` left: to the left) at 5 cm + its thickness above the table. A load bends the end by F·a²·(3L − a)/(6EI) for a load centred a from the block's edge (at the very end, a = L: F·L³/(3EI)), so in a comparison put EVERY load's centre at the same distance from the block's edge: place {on: <ruler id>, x: <ruler x + overhang − (half the widest load's width + 0.01)>} on every ruler (gram-mass widths: 20 g 1.5 cm, 100 g 2.6 cm, 200 g 3.2 cm, 500 g 4.4 cm, 1 kg 5.5 cm; pennies, coin-flat, steel-washer, steel-weight-1kg too). Per 100 g at the end of 20 cm out: a wooden ruler (3.5 mm) about 2 mm, acrylic (3 mm) about 12 mm, aluminium (1.5 mm) about 4.5 mm, steel (0.5 mm) about 42 mm; twice the load twice the bend, twice the overhang 8 times. springboard (a diving board): a board bolted on a stand, its anchor the floor under the stand's edge, the board's top at stand_height + thickness. flex-plank: a plank, card strip or metal strip that rests on what is under it (anchor: the middle of its underside): lay it across two supports (two wooden-blocks or books, `fixed`, its ends resting on them) for a bridge that sags F·L³/(48·E·I) under a load in the middle. Wood and acrylic SNAP past their strength; steel, aluminium and card keep a permanent bend. Readings: bend_mm (the free end's drop, a plank's sag), energy_j, set_deg.",
		"band-launcher: a launch board (65 cm long, 12 mm thick: from 35 cm behind its anchor to 30 cm in front) with a rubber band between two posts at its anchor and the pouch (its tips 0.016·cos 25° in front of its back) pulled back `draw` m (default 0.1, at most 0.2: the band is then about 5 times its length; a rubber band SNAPS at 6 times, an event, and then throws nothing); put the thing to launch ON the board just in front of the pouch: place {on: <launcher id>, x: <launcher x − draw + half its length + 0.003>} (a toy-car's half length is 0.1 m; a ball's its radius) and set the band `height` above the board to the middle of the thing's back (a toy car 0.03, a ball its radius). At the release the band throws it forward (+x); tilt the launcher (angle_deg) to shoot up. Stored with 1 medium band: 0.13 J pulled 5 cm, 0.59 J at 10 cm, 1.5 J at 15 cm, 3.0 J at 20 cm (about as the square of the pull); each more band (`bands` 1-4) as much again; a thick `band` twice a medium one. A toy car on the board takes roughly half of it: pulled 15 cm it rolls about 3.8 m on a table, so give a launched car room or an end stop. Readings: stretch_cm, tension_n, energy_j, broken.",
		"Rubber-band cars: a toy-car, cart or truck with props {band_turns: 1-30} has a rubber band wound on its 3 mm rear axle that drives it forward when the scene lets go; `band_size` thin | medium (#64, default) | thick. On a table a toy car goes about: medium band 2 turns 0.4 m, 3 turns 0.9 m, 4 turns 1.5 m, 6 turns 3.1 m, 10 turns 7 m; thin band 5 turns 0.6 m, 10 turns 2 m, 15 turns 4 m, 20 turns 6.5 m; thick band 3 turns 1.8 m. So on a 3.7 m table compare few turns (2 vs 5 medium, or 5 vs 10 thin), or the car drives off its end. A band that pulls harder than the tyres grip SPINS THE WHEELS (an event) and the extra turns are wasted: a medium band past about 19 turns, a thick one past about 8; more turns never go less far. A 2 kg truck barely moves on one band. The distance comes from band_turns and band_size: never make a band car go farther with start_speed or a different surface under the other car. Readings: band_turns, band_stretch_cm, band_tension_n, band_energy_j.",
		"coil-spring: a coil spring on a base with a platform (anchor: the middle of the base's bottom; the platform's top about 2 cm + length above it): weights put on the platform (place {on: <spring id>}) squash it by weight ÷ stiffness (200 N/m: 4.9 mm per 100 g, 9.8 mm per 200 g: Hooke's law). Its readings are zeroed with its own platform resting on it, as a lab zeroes its scale: compression_mm (what the load squashes it), force_n (k × that: the load's weight), energy_j."
	].join(" "),
	prompt: {
		plan: [
			"Elastic vs plastic: drop a soft-clay ball and a playground-ball (or foam-ball) side by side from the same height (place on air, y_m, held: true): goals squashes {item: clay} and springs_back {item: ball}.",
			"Bounce lessons (more air bounces higher, a flat ball): two playground-balls (or exercise-balls) side by side 0.5 m apart, held on air at the same y_m (their bottoms the same height above the table), different `pressure` (e.g. 3 vs 20 kPa); goal bounces_more {a: the pumped one, b: the flat one}, or bounces {item, at_least_m}. A ball bouncing on a springboard or a trampoline: bounces too.",
			"Bending lessons: one flex-ruler per load, side by side on the table 0.5 m or more apart (each facing right), loads ON the free end, every load's centre at the SAME distance from its ruler's block (place {on: <ruler id>, x: <ruler x + overhang − (half the widest load's width + 0.01)>} for all of them); compare with deforms_more {a: more bent, b: less bent} or bends {item, at_least_mm}. For a visible bend use an acrylic or steel ruler, or a 1 kg steel weight on a wooden one. A bridge: a flex-plank resting across two fixed wooden-blocks (place it on air at the blocks' top height, its ends over them) with loads in its middle.",
			"Rubber bands: band-launcher (draw at most 0.2 m: a band snaps at 6 times its length) with the thing to launch on its board right in front of the pouch (x = launcher x − draw + its half length + 0.003); to compare pull-backs use two launchers in two lanes (the second one fixed higher on a shelf or far apart, with room or an end stop for the thing it throws) and measure's farther {a, b} or moves {item, min_m}. Rubber-band cars: a toy-car with props {band_turns} (on a 3.7 m table: medium band 2 vs 5 turns, or band_size thin 5 vs 10 turns: more turns drive farther). A coil spring: weights on its platform; deforms_more {a, b} compares two springs' squash.",
			"A request that asks to COMPARE (which squashes more, which bounces higher, which bends more) without saying the answer: report what happens; never put a material or pressure setting (foam stiffness, a ball's pressure, a beam's material, clay's softness, a spring's stiffness) in the plan's tune knobs to make a guessed outcome come true.",
			"Goals: squashes {item, at_least_mm?} (clay keeps a dent), springs_back {item} (deforms ≥ 2 mm and keeps nothing), bends {item, at_least_mm?, at_most_mm?} (a beam's bend at the end), deforms_more {a, b}, stores {item, at_least_j?} (peak elastic energy), bounces {item, at_least_m?, at_most_m?} (how high its first bounce rises), bounces_more {a, b} (a's first bounce higher); a beam that snaps or creases, or a launcher whose band snaps, counts for the fracture module's breaks {item}."
		].join("\n"),
		edit: "Soft & bendy: a beam bends more when longer (overhang or length: ∝ L³), thinner (thickness_mm: ∝ 1/t³), narrower (width) or of a softer material (acrylic < wood < aluminium < steel in stiffness), or with a heavier load or one farther out; clay dents deeper when softer (softness) or hit harder; a ball squashes more with less pressure and bounces higher with more; a launcher throws farther with more draw (at most 0.2 m), more bands or a thicker band; a band car drives farther with more band_turns (until its wheels spin) and its distance comes from band_turns and band_size: never meet a farther or faster goal for a band car with start_speed or by changing another car's lane or surface (say that the goal contradicts the stored energy instead); a coil spring squashes more when softer (stiffness). In a comparison of two rulers, boards or planks change the thing compared (overhang, length, the load), not one beam's material.",
		refine: "Soft & bendy: a load meant for a ruler's end must rest ON the ruler (place on: the ruler, x at its free end), every compared ruler's load at the same distance from its block; the thing a band-launcher throws must sit on its board touching the pouch; a bridge's plank must rest on both supports. Fix a failing bends/deforms_more goal with the beam's overhang/length, thickness or the load's weight, never by fixing the beam or by making only one of two compared beams of another material. A band car's race is decided by band_turns and band_size: never by start_speed or another lane's surface. A failing bounces goal: the ball's pressure (pump it up) or the drop height. In a request that asks to COMPARE soft things, never change what they are made of (a ball's pressure, foam stiffness, a beam's material, clay's softness, a spring's stiffness) from what the request or its usual value says: if a weight will not sit on a soft ball, fix how it sits (centred, lighter, held), and any such change you must make goes in the plan's differences."
	},
	examples: [
		{ ask: "Does a ruler bend more with more coins on its end?", how: "two flex-rulers (acrylic) at x 0.3 and 1.3, one with 2 pennies, one with 8 pennies on its end (place on the ruler at x + 0.185: the same distance from the block on both); goal deforms_more {a: ruler with 8, b: ruler with 2}" },
		{ ask: "Clay vs a bouncy ball dropped from 1 m", how: "soft-clay and playground-ball held on air at y_m 1.0, 0.5 m apart; goals squashes {clay}, springs_back {ball}" },
		{ ask: "A ball pumped up with more air bounces higher", how: "two playground-balls held on air at y_m 1.0, 0.6 m apart, pressure 20 and 3 kPa; goal bounces_more {a: the 20 kPa ball, b: the 3 kPa ball} (from 1 m about 0.59 m against 0.33 m)" },
		{ ask: "Pull a rubber band back farther to launch a car farther", how: "two band-launchers (draw 0.05 and 0.15) in two lanes, a toy-car on each board in front of its pouch, room in front of each (the 15 cm one throws a car about 3.8 m on a table: an end stop or a long lane); goal farther {a: car of the 0.15 launcher, b: the other}" },
		{ ask: "Wind a rubber-band car more and it goes farther", how: "two toy-cars in two lanes (one on a shelf plank above the other), props {band_turns: 5, band_size: thin} and {band_turns: 10, band_size: thin} (about 0.6 m and 2 m); goal farther {a: the 10-turn car, b: the 5-turn car}" },
		{ ask: "Hooke's law: hang more weight, more stretch", how: "three coil-springs (200 N/m) 0.6 m apart with gram-masses 100 g, 200 g and 500 g on their platforms (place on: the spring); readings 4.9, 9.8 and 24.5 mm (zeroed with the platform on); goal deforms_more {a: the 500 g spring, b: the 200 g spring}" }
	],
	goals: [
		{
			kind: "squashes", aliases: ["squash", "dents", "dent", "flattens", "stays_squashed", "plastic", "deforms_permanently"], fields: { item: "item", at_least_mm: "number?" },
			about: "squashes {item, at_least_mm?}: it ends with a permanent dent at least that deep (default 1 mm): clay that keeps its squash",
			label: (g, nameOf) => `${nameOf(g.item)} squashes and stays squashed`,
			summarize: (ctx, g) => squashes(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => i.type === "soft-clay")
				return xs.length ? { kind: "squashes", item: pick(xs).id, ...(pick([true, false]) ? { at_least_mm: pick([0.5, 2, 5]) } : {}) } : null
			}
		},
		{
			kind: "springs_back", aliases: ["springs_back_to_shape", "elastic", "returns_to_shape", "spring_back"], fields: { item: "item" },
			about: "springs_back {item}: it squashes, bends or stretches at least 2 mm during the run and keeps no change of shape (no dent, no permanent bend, not snapped)",
			label: (g, nameOf) => `${nameOf(g.item)} springs back`,
			summarize: (ctx, g) => springs_back(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => SOFT_TYPES.includes(i.type))
				return xs.length ? { kind: "springs_back", item: pick(xs).id } : null
			}
		},
		{
			kind: "bends", aliases: ["bend", "sags", "sag", "deflects", "bent"], fields: { item: "item", at_least_mm: "number?", at_most_mm: "number?" },
			about: "bends {item, at_least_mm?, at_most_mm?}: a ruler's, board's or plank's bend at the end (its free end's drop, a plank's sag) is within those mm (default at least 1); a bimetal-strip (the heat module's): its tip moves at least at_least_mm as it heats",
			label: (g, nameOf) => `${nameOf(g.item)} bends${Number.isFinite(g.at_least_mm) ? ` at least ${g.at_least_mm} mm` : ""}${Number.isFinite(g.at_most_mm) ? ` at most ${g.at_most_mm} mm` : ""}`,
			summarize: (ctx, g) => bends(ctx, g),
			detail: (e) => `${e?.ok ? "yes" : "no"} (${e?.most_mm !== undefined ? `its tip moved ${trimNum(e.most_mm, 1)} mm at most` : `it ended bent ${trimNum(e?.bend_mm ?? 0, 1)} mm`})`,
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => BEAM_TYPES.includes(i.type))
				return xs.length ? { kind: "bends", item: pick(xs).id, ...(pick([true, false]) ? { at_least_mm: pick([0.2, 1, 5]) } : { at_most_mm: pick([1, 10, 50]) }) } : null
			}
		},
		{
			kind: "deforms_more", aliases: ["bends_more", "squashes_more", "stretches_more", "compresses_more", "more_bent"], fields: { a: "item", b: "item" },
			subject: ["a", "b"],
			about: "deforms_more {a, b}: a ends more bent (or dented, or a spring more squashed; a ball's squash or a band's stretch at its most) than b, by 5 % and 0.2 mm or more (bends both under 1 mm: by a quarter and 0.02 mm; the result then says small)",
			label: (g, nameOf) => `${nameOf(g.a)} bends or squashes more than ${nameOf(g.b)}`,
			summarize: (ctx, g) => deforms_more(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => SOFT_TYPES.includes(i.type))
				return xs.length >= 2 ? { kind: "deforms_more", a: pick(xs).id, b: pick(xs).id } : null
			}
		},
		{
			kind: "stores", aliases: ["stores_energy", "elastic_energy", "stretches"], fields: { item: "item", at_least_j: "number?" },
			about: "stores {item, at_least_j?}: at its most it holds at least that much elastic energy (default 0.01 J): a stretched band, a bent board, a squashed spring or ball",
			label: (g, nameOf) => `${nameOf(g.item)} stores at least ${Number.isFinite(g.at_least_j) ? g.at_least_j : 0.01} J`,
			summarize: (ctx, g) => stores(ctx, g),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => SOFT_TYPES.includes(i.type) || BAND_CARS.includes(i.type))
				return xs.length ? { kind: "stores", item: pick(xs).id, ...(pick([true, false]) ? { at_least_j: pick([0.001, 0.1, 1]) } : {}) } : null
			}
		},
		{
			kind: "bounces", aliases: ["bounce", "bounce_height", "rebounds", "rebound", "bounces_up_to", "bounces_high"], fields: { item: "item", at_least_m: "number?", at_most_m: "number?" },
			about: "bounces {item, at_least_m?, at_most_m?}: after its first landing it rises at least (at most) that high, its bottom over what it landed on (default at least 0.02 m): a dropped ball's first bounce",
			label: (g, nameOf) => `${nameOf(g.item)} bounces${Number.isFinite(g.at_least_m) ? ` at least ${g.at_least_m} m` : ""}${Number.isFinite(g.at_most_m) ? ` at most ${g.at_most_m} m` : ""}${Number.isFinite(g.at_least_m) || Number.isFinite(g.at_most_m) ? " high" : ""}`,
			summarize: (ctx, g) => bounces(ctx, g),
			detail: (e) => (e?.bounce_m === null || e?.bounce_m === undefined ? "it never landed and bounced" : `its first bounce rose ${trimNum(e.bounce_m, 2)} m`),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => BALL_TYPES.includes(i.type) || i.type === "soft-clay")
				return xs.length ? { kind: "bounces", item: pick(xs).id, ...(pick([true, false]) ? { at_least_m: pick([0.05, 0.3, 0.6]) } : { at_most_m: pick([0.1, 0.5]) }) } : null
			}
		},
		{
			kind: "bounces_more", aliases: ["bounces_higher", "bounce_higher", "higher_bounce", "rebounds_higher", "bounces_more_than", "outbounces"], fields: { a: "item", b: "item" },
			subject: ["a", "b"],
			about: "bounces_more {a, b}: a's first bounce rises higher than b's (by 5 % and 1 cm or more): a pumped-up ball against a flat one, dropped from the same height",
			label: (g, nameOf) => `${nameOf(g.a)} bounces higher than ${nameOf(g.b)}`,
			summarize: (ctx, g) => bounces_more(ctx, g),
			detail: (e) => (e?.a_m === null || e?.b_m === null || e?.a_m === undefined ? "one of them never landed and bounced" : `first bounces ${trimNum(e.a_m, 2)} m and ${trimNum(e.b_m, 2)} m`),
			sample: (scene, pick) => {
				const xs = scene.items.filter((i) => BALL_TYPES.includes(i.type) || i.type === "soft-clay")
				return xs.length >= 2 ? { kind: "bounces_more", a: pick(xs).id, b: pick(xs).id } : null
			}
		}
	],
	// (tune: false: the build's tuner never turns it to make a guessed outcome come true, a material or pressure being what a lesson compares;
	// when(item, scene): the make-it-work search offers it only then)
	knobs: [
		{ type: "flex-ruler", key: "overhang", how: "rel", cost: 0.4, more: "push {it} out farther over the edge", less: "pull {it} back so less sticks out", why: "its bend grows as the overhang cubed: 26 % farther out bends it twice as much" },
		{ type: "flex-ruler", key: "material", how: "choice", cost: 4, tune: false, when: alone, more: "make {it} of another material", less: "make {it} of another material", why: "a stiffer material bends less: steel (E 200 GPa) and aluminium (69) at their usual thin gauges bend more than wood (12, 3.5 mm thick); acrylic (3.2) bends most of the thick ones (offered only for a ruler that is not compared with another: changing one of two would be a second difference)" },
		{ type: "flex-ruler", key: "width", how: "rel", cost: 0.6, more: "widen {it}", less: "narrow {it}", why: "a wider ruler is stiffer: the bend falls as 1/width" },
		{ type: "springboard", key: "length", how: "rel", cost: 0.5, more: "lengthen {it}", less: "shorten {it}", why: "the bend grows as the free length cubed" },
		{ type: "springboard", key: "thickness_mm", how: "rel", cost: 0.6, more: "make {it} thicker", less: "make {it} thinner", why: "the bend falls as the thickness cubed: a board twice as thick bends 8 times less" },
		{ type: "springboard", key: "material", how: "choice", cost: 4, tune: false, when: alone, more: "make {it} of another material", less: "make {it} of another material", why: "steel and aluminium are far stiffer than pine; acrylic and card far softer" },
		{ type: "flex-plank", key: "length", how: "rel", cost: 0.6, more: "lengthen {it}", less: "shorten {it}", why: "a longer span sags more (∝ span³) — keep its ends on their supports" },
		{ type: "flex-plank", key: "thickness_mm", how: "rel", cost: 0.6, more: "make {it} thicker", less: "make {it} thinner", why: "the sag falls as the thickness cubed" },
		{ type: "flex-plank", key: "width", how: "rel", cost: 0.6, more: "widen {it}", less: "narrow {it}", why: "the sag falls as 1/width" },
		{ type: "flex-plank", key: "material", how: "choice", cost: 4, tune: false, when: alone, more: "make {it} of another material", less: "make {it} of another material", why: "a stiffer material sags less (steel, aluminium, wood, pine, acrylic, card)" },
		{ type: "soft-clay", key: "softness", how: "choice", cost: 0.4, tune: false, more: "use other clay for {it}", less: "use other clay for {it}", why: "soft clay flows at a lower pressure (0.08 MPa against 0.175 firm), so the same hit dents it deeper" },
		{ type: "soft-clay", key: "diameter", how: "rel", more: "make {it} bigger", less: "make {it} smaller", why: "a bigger ball is heavier (it lands harder) but spreads its flat wider" },
		{ type: "playground-ball", key: "pressure", how: "abs", steps: [1, 2, 4, 7, 10], cost: 0.3, tune: false, more: "pump {it} up", less: "let some air out of {it}", why: "pumped harder it squashes less and bounces higher (dropped 1 m: 0.27 m at 2 kPa, 0.41 m at 5, 0.55 m at 14, 0.61 m at 30), levelling off past about 30 kPa (35 at most)" },
		{ type: "exercise-ball", key: "pressure", how: "abs", steps: [0.5, 1, 2, 3, 5], cost: 0.6, tune: false, more: "pump {it} up", less: "let some air out of {it}", why: "pumped harder it squashes less under the same weight and bounces higher (dropped 1 m: 0.20 m at 1 kPa, 0.39 m at 4, 0.46 m at 8; 10 kPa at most)" },
		{ type: "foam-ball", key: "stiffness", how: "rel", cost: 0.6, tune: false, more: "use firmer foam for {it}", less: "use softer foam for {it}", why: "softer foam squashes more" },
		{ type: "band-launcher", key: "draw", how: "m", cost: 0.5, more: "pull {it} back farther", less: "pull {it} back less", why: "more stretch stores more energy (about as the square of the pull-back: 0.6 J at 10 cm, 3 J at 20 cm with one band), so it throws faster and farther; 20 cm at most (the band then 5 times its length: at 6 times it snaps)" },
		{ type: "band-launcher", key: "bands", how: "abs", steps: [1, 2, 3, -1], cost: 1, more: "add bands to {it}", less: "use fewer bands on {it}", why: "each more band pulls as hard again, storing more energy at the same pull-back" },
		{ type: "band-launcher", key: "band", how: "choice", cost: 2, more: "use another band on {it}", less: "use another band on {it}", why: "a wider band pulls harder (thin 1.6, medium 6.35, thick 12.7 mm wide)" },
		{ type: "coil-spring", key: "stiffness", how: "rel", cost: 0.6, tune: false, more: "use a stiffer spring for {it}", less: "use a softer spring for {it}", why: "the squash is the weight divided by the stiffness" },
		...BAND_CARS.flatMap((type) => [
			{ type, key: "band_turns", how: "abs", steps: [1, 2, 5], cost: 0.5, when: wound, more: "wind {it}'s rubber band more", less: "wind {it}'s rubber band less", why: "each turn winds 0.94 cm more band onto its 3 mm axle: more stored energy, a longer drive, until the band pulls harder than the tyres grip (a toy car: a medium band past about 19 turns, a thick one past about 8): then its wheels spin and the extra turns are wasted (offered only for a car that already has a band)" },
			{ type, key: "band_size", how: "choice", cost: 1.5, when: wound, more: "use another rubber band on {it}", less: "use another rubber band on {it}", why: "a wider band stores more at the same turns (thick twice medium, medium 4 times thin) but spins the wheels sooner" }
		])
	],
	digest(item, run, h) {
		const out = []
		const P = run?.resolved?.[item.id] ?? item.props ?? {}
		if (BEAM_TYPES.includes(item.type)) {
			const n = beamNumbers(item.type, P)
			const what = item.type === "flex-ruler" ? `${an(MATERIAL_WORDS[n.mat] ?? n.mat)} ruler ${trimNum(n.t * 1000, 1)} mm thick, ${cm(n.b)} wide, ${cm(n.L)} sticking out past its block` : item.type === "springboard" ? `${an(MATERIAL_WORDS[n.mat] ?? n.mat)} board ${trimNum(n.t * 1000, 1)} mm thick, ${cm(n.b)} wide, ${cm(n.L)} past its stand` : `${an(MATERIAL_WORDS[n.mat] ?? n.mat)} plank ${cm(n.L)} long, ${trimNum(n.t * 1000, 1)} mm thick, ${cm(n.b)} wide (it rests on what is under it)`
			out.push(`${what}: E·I ${trimNum(n.EI, 3)} N·m²; 100 g ${item.type === "flex-plank" ? "in the middle of a span its length" : "on its very end"} bends it about ${trimNum(n.per100g * 1000, 2)} mm (${item.type === "flex-plank" ? "F·L³/48EI" : "F·L³/3EI"}); ${n.ductile ? "bent too far it keeps a permanent bend" : "bent too far it snaps"}`)
			// (the loads where they really rest: a load's bend depends on how far out its centre is)
			if (item.type !== "flex-plank") {
				const loads = loadsOn(item, run, n)
				if (loads.length) {
					let bend = 0
					for (const l of loads) bend += (l.kg * G * l.a * l.a * (3 * n.L - l.a)) / (6 * n.EI)
					const words = loads.map((l) => `${h?.nameOf ? h.nameOf(l.id) : l.id} (${l.kg >= 1 ? `${trimNum(l.kg, 2)} kg` : `${trimNum(l.kg * 1000, 0)} g`}) centred ${cm(l.a)} from the ${item.type === "flex-ruler" ? "block's" : "stand's"} edge, ${cm(n.L - l.a)} in from the end`)
					out.push(`what rests on it at the end of the last run: ${words.join("; ")}: Euler-Bernoulli F·a²(3L − a)/6EI gives its end a bend of about ${trimNum(bend * 1000, 1)} mm for loads there`)
				}
			}
			const b1 = endOf(run, item.id, "bend_mm")
			if (b1 !== null) out.push(`in the last run it ended bent ${trimNum(b1, 1)} mm (most ${trimNum(maxOf(run, item.id, "bend_mm"), 1)} mm)${(endOf(run, item.id, "set_deg") ?? 0) >= 0.5 ? `, permanently bent ${trimNum(endOf(run, item.id, "set_deg"), 1)}°` : ""}${(run?.track?.events ?? []).some((e) => e.kind === "snap" && (e.items ?? []).includes(item.id)) ? "; it SNAPPED" : ""}`)
		} else if (item.type === "soft-clay") {
			const d = endOf(run, item.id, "dent_mm")
			out.push(`modelling clay flowing at ${trimNum(CLAY_FLOW[P.softness ?? "normal"] / 1e6, 3)} MPa: it keeps every dent (dropped from h it flattens δ with ½·m·v² = 3·σ·π·R·δ²)`)
			if (d !== null) out.push(`in the last run its deepest dent ${trimNum(d, 1)} mm (it squashed ${trimNum(maxOf(run, item.id, "squash_mm") ?? 0, 1)} mm at most; pressed with ${trimNum(endOf(run, item.id, "force_n") ?? 0, 1)} N at the end)`)
		} else if (BALL_TYPES.includes(item.type)) {
			const s = maxOf(run, item.id, "squash_mm")
			const e = item.type === "foam-ball" ? FOAMS[P.foam ?? "stress ball"] ?? 0.55 : eOf(item.type, P.pressure ?? BALLS[item.type][4] / 1000)
			out.push(item.type === "foam-ball" ? `${P.foam === "slow foam" ? "slow (memory) foam" : "soft foam"} (E ${trimNum(P.stiffness ?? 100, 0)} kPa): it squashes where pressed and springs back; it leaves the floor at about ${trimNum(e, 2)} of the speed it lands with` : `inflated to ${trimNum(P.pressure ?? 0, 1)} kPa: it flattens where it presses (force = pressure × the flat's area) and springs back; it leaves the floor at ${trimNum(e, 2)} of the speed it lands with (more air: higher)`)
			if (s !== null) out.push(`in the last run it squashed ${trimNum(s, 1)} mm at most (${trimNum(endOf(run, item.id, "squash_mm") ?? 0, 1)} mm at the end), pushing up to ${trimNum(maxOf(run, item.id, "force_n") ?? 0, 1)} N`)
			const b = run?.track?.frames?.length ? bounce_height(runCtx(run), item.id) : null
			if (b) out.push(`its first bounce (landing at ${trimNum(b[1], 2)} s) rose ${trimNum(b[0], 2)} m above what it landed on`)
		} else if (item.type === "band-launcher") {
			const e0 = startOf(run, item.id, "energy_j")
			const snapped = (run?.track?.events ?? []).find((e) => e.kind === "snap" && (e.items ?? []).includes(item.id))
			const spread = Math.max(P.spread ?? 0.1, 0.09)
			const r0 = (P.draw ?? 0.1) + 0.016 * cos((25 * Math.PI) / 180)
			const lam = Math.sqrt(r0 * r0 + (spread / 2) * (spread / 2)) / (spread / 2 / 1.05)
			out.push(`pulled back ${cm(P.draw ?? 0.1)} with ${P.bands ?? 1} ${P.band ?? "medium"} band${(P.bands ?? 1) > 1 ? "s" : ""} each side, the band stretched to ${trimNum(lam, 1)} times its length (it snaps at ${trimNum(BAND_SNAP, 0)}); its band is ${cm(P.height ?? 0.03)} above the board (its pouch's tips at x ${trimNum((item.x ?? 0) - (P.draw ?? 0.1), 3)} m)${e0 !== null && !snapped ? `: it stores ${trimNum(e0, 3)} J and pulls ${trimNum(startOf(run, item.id, "tension_n") ?? 0, 2)} N at the release` : ""}${snapped ? `; its band SNAPPED at ${trimNum(snapped.t, 2)} s` : ""}`)
		} else if (item.type === "coil-spring") {
			const c1 = endOf(run, item.id, "compression_mm")
			const k = P.stiffness ?? 200
			out.push(`${trimNum(k, 0)} N/m, ${cm(P.rest_length ?? 0.12)} long: each 100 g squashes it ${trimNum((98.1 / k) * 10, 2)} mm (its readings are zeroed with its own platform resting on it)${c1 !== null ? `; what is on it ended squashing it ${trimNum(c1, 1)} mm (the weight of ${trimNum((c1 / 1000) * k / G * 1000, 0)} g)` : ""}`)
		} else if (BAND_CARS.includes(item.type) && (P.band_turns ?? item.props?.band_turns ?? 0) > 0) {
			const e0 = startOf(run, item.id, "band_energy_j")
			const unwound = (run?.track?.events ?? []).find((e) => e.kind === "unwound" && (e.items ?? []).includes(item.id))
			const spun = (run?.track?.events ?? []).find((e) => e.kind === "spin" && (e.items ?? []).includes(item.id))
			out.push(`rubber-band motor: ${trimNum(P.band_turns ?? item.props?.band_turns, 1)} turns of a ${P.band_size ?? item.props?.band_size ?? "medium"} band on its 3 mm rear axle${e0 !== null ? ` storing ${trimNum(e0, 3)} J` : ""}${spun ? `; its wheels SPUN at ${trimNum(spun.t, 2)} s (${spun.text.replace(/^.*?, and /, "")}: fewer turns or a thinner band would waste none)` : ""}${unwound ? `; it unwound at ${trimNum(unwound.t, 2)} s` : ""}`)
		}
		return out.length ? out : null
	},
	words: {
		change(type, key, a, b) {
			// (a ruler's length is the whole ruler: what bends is its overhang, the part past the block)
			if (type === "flex-ruler" && key === "length") return `ruler length ${cm(a)} → ${cm(b)} (its overhang, the part past the block, is what bends)`
			if (BEAM_TYPES.includes(type) && (key === "overhang" || key === "length")) {
				const r = typeof a === "number" && a > 0 && typeof b === "number" ? (b / a) * (b / a) * (b / a) : null
				return `${key === "overhang" ? "overhang" : "length"} ${cm(a)} → ${cm(b)}${r !== null ? `: it bends ${trimNum(r, 2)}× as much (L³)` : ""}`
			}
			if (BEAM_TYPES.includes(type) && key === "thickness_mm") {
				if (!(a > 0) || !(b > 0)) return `thickness ${a > 0 ? `${trimNum(a, 1)} mm` : "usual"} → ${b > 0 ? `${trimNum(b, 1)} mm` : "usual"}`
				return `thickness ${trimNum(a, 1)} → ${trimNum(b, 1)} mm: it bends ${trimNum((a / b) * (a / b) * (a / b), 2)}× as much (1/t³)`
			}
			if (BEAM_TYPES.includes(type) && key === "material") return `${MATERIAL_WORDS[a] ?? a} → ${MATERIAL_WORDS[b] ?? b}, E ${trimNum((BEAM[a]?.[0] ?? 0) / 1e9, 1)} → ${trimNum((BEAM[b]?.[0] ?? 0) / 1e9, 1)} GPa`
			if (type === "soft-clay" && key === "softness") return `clay ${a} → ${b}, flowing at ${trimNum((CLAY_FLOW[a] ?? 0) / 1e6, 3)} → ${trimNum((CLAY_FLOW[b] ?? 0) / 1e6, 3)} MPa`
			if (BALL_TYPES.includes(type) && key === "pressure") {
				const ea = eOf(type, a)
				const eb = eOf(type, b)
				return `pumped ${trimNum(a, 1)} → ${trimNum(b, 1)} kPa${ea !== null && eb !== null && typeof a === "number" && typeof b === "number" && a !== b ? `: it bounces ${b > a ? "higher" : "lower"} (leaving the floor at ${trimNum(ea, 2)} → ${trimNum(eb, 2)} of its landing speed)` : ""}`
			}
			if (type === "band-launcher" && key === "draw") return `pulled back ${cm(a)} → ${cm(b)}`
			if (type === "band-launcher" && key === "bands") return `${a} → ${b} band${b === 1 ? "" : "s"} each side`
			// (the band's unstretched length is the posts' half spacing: posts farther apart make a longer band, stretched less by the same pull-back)
			if (type === "band-launcher" && key === "spread") return `posts ${cm(a)} → ${cm(b)} apart${typeof a === "number" && typeof b === "number" && b !== a ? `: a ${b > a ? "longer band, stretched less" : "shorter band, stretched more"} by the same pull-back` : ""}`
			if (type === "band-launcher" && key === "band") return `band ${a} → ${b}, ${BAND_WORDS[a] ?? a} → ${BAND_WORDS[b] ?? b} wide`
			if (BAND_CARS.includes(type) && key === "band_size") return `rubber band ${a} → ${b}, ${BAND_WORDS[a] ?? a} → ${BAND_WORDS[b] ?? b} wide`
			if (type === "coil-spring" && key === "stiffness") return `stiffness ${trimNum(a, 0)} → ${trimNum(b, 0)} N/m: it squashes ${trimNum(a / b, 2)}× as much`
			if (BAND_CARS.includes(type) && key === "band_turns") {
				const t = (v) => `${trimNum(v ?? 0, 1)} turn${Number(v) === 1 ? "" : "s"}`
				return `rubber band wound ${t(a)} → ${t(b)}`
			}
			return null
		},
		/** A bending beam, a squashed spring or ball still does its thing in a run though it barely moves: it counts as moving when it bends or
		 *  squashes 2 mm or more (the heads-up "no longer moves" is never said of a board that dips 8.7 mm). */
		moves(item, run) {
			const key = BEAM_TYPES.includes(item?.type) ? "bend_mm" : item?.type === "coil-spring" ? "compression_mm" : BALL_TYPES.includes(item?.type) || item?.type === "soft-clay" ? "squash_mm" : null
			if (!key) return null
			const v = run?.track?.state?.[item.id]?.[key]
			if (!Array.isArray(v) || !v.length) return null
			return v.some((x) => Math.abs(x) >= 2) ? true : null
		},
		/** Its own parts striking each other is no news: a launcher's pouch on its own board, a ruler's pieces on its block, a spring's platform. */
		ownHits(type) {
			return BEAM_TYPES.includes(type) || type === "band-launcher" || type === "coil-spring" ? false : null
		},
		/** What a ruler or a diving board weighs: the whole of it (the engine moves only the part past its block, so its moving parts weigh less). */
		mass(type, props = {}) {
			if (type !== "flex-ruler" && type !== "springboard") return null
			const P = { ...props }
			const n = beamNumbers(type, P)
			const rho = BEAM_DENSITY[n.mat] ?? MATERIALS[n.mat]?.density
			if (!(rho > 0)) return null
			const whole = type === "flex-ruler" ? (P.length ?? 0.3) : n.L + 0.2
			return rho * whole * n.t * n.b
		},
		keys: {
			"flex-ruler.overhang": "overhang|stick\\w* out|sticks? out|past the edge|longer|shorter|farther out",
			"flex-ruler.material": "steel|metal|alumin\\w*|wood\\w*|plastic|acrylic|material",
			"springboard.length": "longer|shorter|length",
			"flex-plank.length": "longer|shorter|length|span",
			"thickness_mm": "thick\\w*|thin\\w*",
			"soft-clay.softness": "soft\\w*|firm\\w*|warm\\w*|cold",
			pressure: "pump\\w*|pressure|inflat\\w*|deflat\\w*|air|flat",
			"foam-ball.stiffness": "stiff\\w*|soft\\w*|firm\\w*|foam",
			"band-launcher.draw": "pull\\w*|draw\\w*|stretch\\w*|farther back",
			"band-launcher.bands": "bands?|more rubber",
			band_turns: "wind\\w*|turns?|wound",
			band_size: "thin\\w*|thick\\w*|wide\\w*|band size|bigger band|smaller band",
			"coil-spring.stiffness": "stiff\\w*|soft\\w*|spring"
		}
	}
}
