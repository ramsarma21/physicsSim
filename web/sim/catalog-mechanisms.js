// Phase 2 of the catalog: springs, ropes, pulleys, wheels and vehicles, motors and belts.
// A port of machines/catalog_mechanisms.py, line by line (same names, same order, same numbers); plain ES module, no dependencies, for the browser and node.
//
// How machines/items.py calls it: register_all(globals()) once at import time, after catalog_items.py and catalog_everyday.py. Here web/sim/index.js does the same,
//   use_catalog_module("catalog_mechanisms", register_all)   // items.js hands register_all its FRAMEWORK: register, ItemType, Prop, MATERIALS, add_look, ...
// in the order of items.py's CATALOG_MODULES. Python keyword arguments are one trailing options object (see items.js); a Python int that matters (a
// material's density written 1100, not 1100.0: it prints differently in the material instance's hash key) is `I(1100)`; `x ** 3` is the engine's own
// pow (web/sim/engine-math.js: the same libm routine as CPython's) and so is `x ** (1 / 3)`; a Python `round(x)` is pyRoundInt, `int(x)` Math.trunc.
//
// A spring is the engine's Hooke spring between two anchors (built with the stiffness and damping its props say: the engine holds any), a rope a rope
// joint (a chain's collides), a pulley a rope over two wheels that only pulls, its ends jamming at the wheels (minLengthA/B), a hinge a revolute pin (with a
// motor, limits and friction if it has them), a wheel a sprung axle (frequency 0 = rigid). Parts that are held
// square by guide rails (a launcher's plate, a bumper's plate) slide between them with a few mm to spare.
// Every number says where it comes from; a guess says "provisional". A fixed item (the "Fixed" tick) just stands: no joints.
// A car, truck, cart or skateboard body is a few convex polygons welded together (a car: a lower body and a cab, at about 1:19 with real wheels, overhangs and a low roof;
// a flatbed: a 35 mm frame-and-deck slab, the cab on it and two blocks of the cab's lower front either side of the front wheel, open underneath; a wagon: a thin plank bed
// over the wheels; a skateboard: a deck, two kicktails and two trucks), so its side outline, centre of mass and weight (the body_mass prop, split by area x depth) are
// those of the real shape; web/models/vehicles*.js draw them. A pinball flipper is a 24 mm tall bat of 40 g on a 12 mm pivot post.
// Exactness is checked by tools/parity/mechanisms.mjs (this file against machines/catalog_mechanisms.py, every type in it).
// What Python's libm does that JavaScript cannot repeat to the last bit, and why no number shows it: math.sinh, cosh, asinh (the hanging chain's catenary), tan
// (the skateboard's kicktails: tan 17° is bit for bit the same) and atan2 are V8's here, and sin/cos of an angle that is not a multiple of 30° too (items.js's
// pymath.js has the table for those); `x ** 2` (the sag of a car's springs) is x * x here, where Apple's pow differs from that for 1 argument in 800 (never at the
// slider's multiples of 0.5 Hz). Each can be one unit in the last place off, and every number the builders print goes through round(.., 4, 5 or 6), so a
// difference shows only where a value sits exactly on a rounding tie, which these do not by construction (the parity run puts 100000s of random builds through
// them: tools/parity/mechanisms.mjs --groups bulk, 400000 builds, no difference). The ones that are printed unrounded, a weight's cube root and a wheel's cube,
// come from the engine's own pow. ONE PLACE WHERE IT DOES SHOW: a hanging chain with an odd number of links has a middle link centred on the chain's axis, so its x
// is zero but for rounding noise (about 3e-17 m) that Apple's asinh/sinh and V8's make differently; put the chain exactly at an odd multiple of 1/64 m (a tie for
// round(x, 5), and the half length of the chain in the same power of two) and that noise decides the 5th decimal of the link's world x (y, turned a quarter): 1e-5 m,
// in about 1 of 300 such placements (tools/parity/mechanisms.mjs --groups chainties; the other cases move such a place by 2^-30 m). The editor puts things on a 0.001 m grid.
import { PyInt, ValueError, degrees, div, fmtG, hasOwn, hypot, maxOf, minOf, pyLower, pyRound, pyRoundInt, pySum, pymax, pymin, sin, cos, truthy } from "./pymath.js"
import { pow } from "./engine-math.js"

// the names register_all() takes from the framework (NEEDED in the Python), plus define_material, which JavaScript's tables need for what Python's
// `MATERIALS[key] = {...}` says: which of a material's numbers were written as ints
let register, ItemType, Prop, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, D2R, CATEGORIES, define_material

const FLIPPER_MASS = 0.04 // kg: a pinball flipper bat with its shaft (about 40 g; provisional)
const MOTOR_BACK = 0.066 // m: how far behind a motor spinner's paddle its gear motor reaches (a 6 mm coupling, a 22 mm gearbox, a 32 mm can and its 6 mm end cap)
const SCREW_EYE = 0.003 // m: how far below a hanger's underside the ring of its brass screw eye is centred (the rope or spring is made fast there)
const G = 9.81
const TAU = 2 * Math.PI // math.tau

export function register_all(g) {
	;({ register, ItemType, Prop, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, D2R, CATEGORIES, define_material } = g)
	for (const cat of ["Springs & ropes", "Wheels & vehicles", "Motors & belts"]) {
		if (!CATEGORIES.includes(cat)) CATEGORIES.push(cat)
	}
	_looks()
	_materials()
	_springs()
	_ropes()
	_pulleys()
	_vehicles()
	_wheels()
	_motors()
}

/** A Python int (see the top). */
const I = (n) => new PyInt(n)

// ---------------------------------------------------------------- helpers
/** The materials of these names that exist (another builder's materials may be missing). */
function _has(...names) {
	return names.filter((n) => hasOwn(MATERIALS, n))
}

function _wood(c) {
	return c.mat({ base: "varnished hardwood", overrides: {} })
}

function _weight_material() {
	return hasOwn(MATERIALS, "steel weight") ? "steel weight" : "steel"
}

function _steel(c) {
	return c.mat({ base: "steel", overrides: {} })
}

/** A small static bracket whose underside is the item's origin: what a spring or rope hangs from (a wooden block; `steel`: a steel beam). */
function _hanger(c, { width = 0.08, y = 0.006, steel = false } = {}) {
	if (steel) return c.slab("hanger", width, 0.012, 0.04, 0, y, { kind: "static", words: "a steel beam", look: "steel", material: _steel(c) })
	return c.slab("hanger", width, 0.012, 0.04, 0, y, { kind: "static", words: "a small wooden hanger", look: "wood", material: _wood(c) })
}

/** A fixed (static) item has nothing to join. */
function _joint(c, kind, part, fields) {
	if (c.kind === "dynamic") c.joint(kind, part, fields)
}

function _spring(c, part, a, b, anchor_a, anchor_b, rest, k, damping, { compress_only = false, radius = 0.012, coils = null, ...extra } = {}) {
	const fields = {
		a, b, anchorA: anchor_a, anchorB: anchor_b, rest: pyRound(rest, 5), stiffness: pyRound(k, 5), damping: pyRound(damping, 5),
		coils: truthy(coils) ? coils : pymax(5, pymin(24, Math.trunc(rest / 0.01))), coilRadius: radius, ...extra
	}
	if (compress_only) fields.compressOnly = true
	_joint(c, "spring", part, fields)
}

/** A slab welded to another part of this item: dx, dy are in the parent's frame (as build_seesaw's lip). */
function _child(c, part, parent, w, h, d, dx, dy, material, words, look, langle = 0.0) {
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look,
		body: { kind: "slab", width: pyRound(w, 5), height: pyRound(h, 5), depth: d }, material,
		at: { x: pyRound(dx, 5), y: pyRound(dy, 5) }, parent,
		placeholder: { fill: LOOK_FILL[look] ?? "#c8955a" }, render: { kind: "procedural", shade: LOOK_SHADE[look] ?? "#8a6a45" }, depth: 2
	}
	if (truthy(langle)) s.angle = pyRound(langle * D2R, 6)
	c.sb.solids.push(s)
	return s.id
}

/** The area of a polygon [(x, y), ...] (shoelace). */
function _area(pts) {
	const n = pts.length
	const terms = []
	for (let k = 0; k < n; k++) terms.push(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1])
	return Math.abs(pySum(terms)) / 2
}

/** The x of a polygon's centroid (shoelace). */
function _centroid_x(pts) {
	let a = 0.0
	let cx = 0.0
	for (let k = 0; k < pts.length; k++) {
		const [x0, y0] = pts[k]
		const [x1, y1] = pts[(k + 1) % pts.length]
		const w = x0 * y1 - x1 * y0
		a += w
		cx += (x0 + x1) * w
	}
	return truthy(a) ? div(cx, 3 * a) : 0.0
}

/** A convex polygon welded to another part of this item. Its points are given in the PARENT's frame (the polygon's own origin is the parent's),
 *  so a car's greenhouse or a skateboard's kicktail is simply drawn where it sits on the body. */
function _child_poly(c, part, parent, pts, depth, material, words, look = null, extra = {}) {
	const sid = c.poly(part, pts, depth, 0.0, 0.0, { material, look, words, ...extra })
	const s = c.sb.solids[c.sb.solids.length - 1]
	s.parent = !parent.includes("/") ? `${c.item.id}/${parent}` : parent
	s.at = { x: 0.0, y: 0.0 }
	delete s.angle
	return sid
}

/** v / 2 as Python does it for what a scene can hold: a number or a bool is fine, a string is a TypeError. */
function _half(v) {
	if (typeof v === "string") throw new TypeError("unsupported operand type(s) for /: 'str' and 'int'")
	return Number(v) / 2
}

function _cube(mass, material) {
	return pow(mass / MATERIALS[material].density, 1 / 3)
}

/** math.sqrt(x): a negative x is a ValueError, as in Python (JavaScript gives NaN). */
const msqrt = (x) => {
	if (x < 0) throw new ValueError("math domain error")
	return Math.sqrt(x)
}

/** math.acos(x): outside [-1, 1] is a ValueError, as in Python. */
const macos = (x) => {
	if (x < -1 || x > 1) throw new ValueError("math domain error")
	return Math.acos(x)
}

/** math.copysign(x, y): |x| with the sign of y (-0.0 counts as negative). */
const copysign = (x, y) => (y < 0 || Object.is(y, -0) ? -Math.abs(x) : Math.abs(x))

/** How far apart two convex outlines (counter-clockwise [[x, y], ...]) are along the side normal that best separates them, m (negative: they overlap).
 *  Never more than their true distance. */
function _gap(A, B) {
	let best = -Infinity
	for (const [Pp, Q] of [[A, B], [B, A]]) {
		for (let i = 0; i < Pp.length; i++) {
			const [x1, y1] = Pp[i]
			const [x2, y2] = Pp[(i + 1) % Pp.length]
			const m = hypot(x2 - x1, y2 - y1)
			const nx = div(y2 - y1, m)
			const ny = div(x1 - x2, m)
			best = pymax(best, minOf(Q.map(([x, y]) => (x - x1) * nx + (y - y1) * ny)))
		}
	}
	return best
}

/** How far (degrees, up to a > 0) a spring gate (build_gate) opens toward its post before its spring is closed solid or the plank comes within 3 mm of the post:
 *  turned from hanging straight in steps that can't jump past either (each no more than the smaller margin over the farthest point's distance from the hinge). */
function _gate_stop(L, th, arm, reach, solid, a) {
	const post = [[reach, -arm - 0.03], [reach + 0.02, -arm - 0.03], [reach + 0.02, -arm + 0.03], [reach, -arm + 0.03]]
	const ex = th / 2 + 0.0026 // the spring's eye, from the hinge
	const ey = -arm
	const R = hypot(L, th / 2)
	const margin = (t) => {
		const ct = cos(t)
		const st = sin(t)
		const gate = [[-th / 2, -L], [th / 2, -L], [th / 2, 0.0], [-th / 2, 0.0]].map(([u, v]) => [u * ct - v * st, u * st + v * ct])
		return pymin(_gap(gate, post) - 0.003, hypot(ex * ct - ey * st - reach, ex * st + ey * ct + arm) - solid)
	}
	let t = 0.0
	const end = a * D2R
	for (let i = 0; i < 400; i++) {
		const g = margin(t)
		if (g <= 2e-5) return t / D2R
		t += div(g, R)
		if (t >= end) return a
	}
	return t / D2R
}

/** How far (radians, up to a >= 0) a bob of radius r, its centre L from the rope's tie `hook` under the middle of a hanger w wide (12 mm tall, its underside
 *  at the origin), swings from hanging straight before it comes within 3 mm of the hanger (turned in steps that can't jump past it, as _gate_stop). */
function _swing_stop(L, r, hook, w, a) {
	const margin = (t) => {
		const x = L * sin(t)
		const y = -L * cos(t) - hook
		return hypot(pymax(pymax(-w / 2 - x, 0.0), x - w / 2), pymax(pymax(-y, 0.0), y - 0.012)) - r - 0.003
	}
	let t = 0.0
	for (let i = 0; i < 400; i++) {
		const g = margin(t)
		if (g <= 2e-5) return t
		t += div(g, L)
		if (t >= a) return a
	}
	return t
}

/** The x in [lo, hi] where the increasing function f crosses 0. */
function _bisect(f, lo, hi, n = 80) {
	for (let i = 0; i < n; i++) {
		const mid = (lo + hi) / 2
		if (f(mid) < 0) lo = mid
		else hi = mid
	}
	return (lo + hi) / 2
}

const STEP = 1 / 480 // s: the engine's fixed step (tooling/src/sim/physics.ts)

/** The fastest way a part of mass m (kg; moment of inertia I about its centre of mass) moves on springs that all pull along one line, with these signed lever
 *  arms about its centre of mass (r × u, one per spring, m), per N/m of each spring: the larger eigenvalue of [[n/m, Σa/√(mI)], [Σa/√(mI), Σa²/I]] (the springs
 *  move it along their line and turn it; one spring's is its own 1/m + a²/I, the engine's massAlong). */
function _rate(m, I, arms) {
	const A = div(arms.length, m)
	const B = div(pySum(arms), msqrt(m * I))
	const C = div(pySum(arms.map((a) => a * a)), I)
	return (A + C) / 2 + msqrt(pow((A - C) / 2, 2) + B * B)
}

/** The stiffness prop a part's springs can be given and still be followed by the engine's step, their rate λ (_rate) known: they may turn it at most
 *  ω·dt = 1.2 rad a step (k·λ·dt² ≤ 1.44). The engine holds any stiffness steady, but past ω·dt = √2 it solves the excess implicitly, which slows and damps
 *  the part's bounce: the smallest, stiffest launcher threw its ball 32 % short of the same engine at 4800 Hz (research/rw-validate-p3.ts), where at this
 *  cap it throws within 2 %. fk: the share of the stiffness prop each spring gets. A prop past what its part can take is built at that cap, which is written
 *  into P (so `resolved` shows what was built). The damping has no cap: the engine solves it implicitly, true at any value (a 10 N·s/m gate and a 30 N·s/m
 *  bumper swing as at 4800 Hz; capped at a fifth and a quarter of that, as they were, their swings came out 13 % and 27 % off).
 *  -> the stiffness prop to build with. */
function _spring_cap(P, lam, fk) {
	const k_max = Math.floor(div(1.44, STEP * STEP * fk * lam) * 1000) / 1000
	const k = pymin(P.stiffness, k_max)
	if (k < P.stiffness) P.stiffness = k
	return k
}

const JAM_GAP = 0.002 // m: how far under its wheel's rim the end of a pulley's run stops (the rope's end jams in the pulley there; 2 mm, so the body's 1 mm contact
// skin stays clear of the wheel's solid disc and the round wheel never turns it over)
const PIN_FRICTION = 0.3 // a steel pin turning in steel (a hinge's knuckles, a bolt through steel straps), dry: Coulomb friction 0.3 (provisional), its torque μ·r·load

/** How short (m) a pulley's run may get when its body's flat top, from x0 to x1 across the run, is hauled straight up under a wheel centred at (wx, 0) (the
 *  item's frame: the axle's height is 0) with its rim R: its anchor is on that top, under the ground point at the axle's height, and the top stops JAM_GAP
 *  under the rim where it comes nearest it (the doc pulley's minLengthA/minLengthB: the engine's rope end jams there, whatever hauls it). */
function _jam_run(wx, R, x0, x1) {
	const hx = Math.abs(wx - pymin(pymax(wx, x0), x1))
	return Math.sqrt(pymax(0.0, pow(R + JAM_GAP, 2) - hx * hx))
}

// ---------------------------------------------------------------- looks and materials
function _looks() {
	add_look("tyre", { fill: "#2b2d31", shade: "#1a1b1e", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	add_look("urethane", { fill: "#f2a900", shade: "#c28500", roughness: 0.35, metalness: 0.0, clearcoat: 0.4 })
	add_look("trampoline", { fill: "#17181c", shade: "#0e0f12", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	add_look("belt", { fill: "#4a4d52", shade: "#34363a", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
}

/** MATERIALS[key] = kw, rolling and side 0.0 unless given (they come last, as dict.setdefault adds them). */
function _mat(key, kw) {
	const values = {}
	const ints = []
	for (const k of Object.keys(kw)) {
		if (kw[k] instanceof PyInt) {
			values[k] = kw[k].value
			ints.push(k)
		} else values[k] = kw[k]
	}
	if (!hasOwn(values, "rolling")) values.rolling = 0.0
	if (!hasOwn(values, "side")) values.side = 0.0
	define_material(key, values, ints)
}

function _materials() {
	// (density kg/m³, bounce = restitution against a rigid surface, Coulomb friction, rolling resistance, side spring-back)
	_mat("tyre rubber", {
		density: I(1100), bounce: 0.5, friction: 0.8, rolling: 0.012, look: "tyre",
		source: "Rubber about 1100 kg/m³; rubber on dry wood or concrete grips with a friction of 0.6-0.9; car tyres on a hard road roll with a " +
			"resistance of 0.010-0.015 (handbook values). Bounce provisional."
	})
	_mat("bicycle tyre", {
		density: I(1100), bounce: 0.5, friction: 0.8, rolling: 0.005, look: "tyre",
		source: "Bicycle tyres on a smooth hard surface roll with a resistance of about 0.004-0.008 (road-tyre test values); friction and bounce provisional."
	})
	_mat("urethane", {
		density: I(1200), bounce: 0.6, friction: 0.6, rolling: 0.01, look: "urethane",
		source: "Polyurethane skateboard wheels, about 1200 kg/m³ (provisional); hard wheels on smooth wood or concrete roll with about 0.01 (provisional)."
	})
	_mat("trampoline mat", {
		density: I(400), bounce: 0.4, friction: 0.5, rolling: 0.03, look: "trampoline",
		source: "A woven polypropylene mat; it gives under a ball, so the contact itself is dead and the springs do the bouncing. All values provisional."
	})
	_mat("conveyor belt", {
		density: I(1200), bounce: 0.5, friction: 0.6, rolling: 0.015, look: "belt",
		source: "PVC or rubber belting grips light packages with a friction of 0.3-0.6 (belt-maker values); a ball sinks in a little, so the rolling " +
			"resistance is provisional."
	})
}

// ---------------------------------------------------------------- springs
/** A plate on two springs over a base, held square by two guide rails: a launcher's (held compressed) or a pad's (resting). Either plate is bolted to its springs,
 *  which pull as well as push: a plate they throw up is pulled back down (on push-only springs a pad's plate flew up off its rails with the ball that hit it).
 *  The pad's plate is thin and light: a plate heavier than the ball takes the ball's bounce away. */
function _sprung_plate(c, P, pad) {
	const W = P.width
	const rest = P.rest_length
	const d = P.depth
	const damp = P.damping
	const th = pad ? 0.004 : 0.008
	const cr = pymax(0.004, pymin(0.012, d / 2 - 0.0033)) // the coil's radius (picture only): 12 mm, narrower on a plate less than ~31 mm deep so it stays on its seat
	const xs = pymax(W / 2 - 0.025, cr + 0.003) // the springs stand 25 mm in from the plate's ends, but never closer to the middle than a coil and a 3 mm gap (a plate under ~76 mm wide)
	// a small thin plate is light: its springs get no more stiffness than the engine's step can follow on it (_spring_cap; the bounce and the throw are the
	// same, only the plate's own ringing is slower)
	const mp = MATERIALS[P.material].density * W * th * d
	const k = _spring_cap(P, _rate(mp, div(mp * (W * W + th * th), 12), [-xs, xs]), 0.5)
	// held compressed at most until the coils close (the turns _spring draws, 2 mm wire, side by side plus the two seats), and a launcher never below 3 cm;
	// a pad's plate starts settled on its springs, or on its closed coils when they are too soft to hold it up
	const solid = pymax(5, pymin(24, Math.trunc(rest / 0.01))) * 0.002 + 0.004
	const comp = pad ? pymin(div(mp * G, k), rest - solid) : pymin(P.compression, rest - pymax(0.03, solid))
	const wood = _wood(c)
	const steel = _steel(c)
	c.slab("base", W + 0.05, 0.02, d, 0, -0.01, { kind: "static", words: "the base block", look: "wood", material: wood })
	c.slab("plate", W, th, d, 0, rest - comp + th / 2, { words: pad ? "a springy bounce pad plate" : "the launcher's plate" })
	// the guide rails stand 5 cm over the plate's rest height, or more: let go, the plate overshoots its rest height by up to as far as it was pressed down, and its clips
	// (the plate's thickness and 3 mm) stay on the rails with 2 cm to spare
	const gh = rest + pymax(0.05, comp + th + 0.02)
	;[-1, 1].forEach((sx, n) => {
		const x = sx * xs
		_spring(c, `spring${n + 1}`, "base", "plate", [x, 0.01], [x, -th / 2], rest, k / 2, damp / 2, { radius: cr })
		c.slab(`guide${n + 1}`, 0.006, gh, 0.02, sx * (W / 2 + 0.007), gh / 2, { kind: "static", words: "a steel guide rail", look: "steel", material: steel })
	})
}

function _springs() {
	// --- hanging spring
	function build_hanging(c, P) {
		const k = P.stiffness
		const rest = P.rest_length
		const m = P.weight
		const damp = P.damping
		const s = _cube(m, P.material)
		_hanger(c)
		// the spring's top hooks on the ring of the hanger's brass screw eye (SCREW_EYE under the underside), so the rest length, the stretch and the period are measured from there;
		// a lab spring is close wound: a turn every ~4 mm (80 turns at most: the view draws a single coil at 288 triangles a turn, so the spring stays under 23k and the item,
		// hanger and weight with it, under 30k)
		const coils = pymax(24, pymin(80, pyRoundInt(rest / 0.004)))
		// let go, the weight bounces as far above the point m·g/k below the rest length as it starts below it: stretched more than rest + 2·m·g/k less the spring's closed
		// length, it would be thrown up through its own closed coils (the view's wire is 0.08 of the 12 mm coil radius: two wire radii a turn, and 4 mm for the two end hooks),
		// so it is stretched at most that far (a real spring stops at coil bind)
		const solid = coils * 2 * pymin(0.0035, pymax(0.0007, 0.08 * 0.012)) + 0.004
		const stretch = pymax(0.0, pymin(P.start_stretch, rest + div(2 * m * G, k) - solid))
		c.slab("weight", s, s, s, 0, -(rest + stretch) - s / 2 - SCREW_EYE, { words: "a weight on a spring" })
		_spring(c, "spring", "hanger", "weight", [0, -0.006 - SCREW_EYE], [0, s / 2], rest, k, damp, { coils })
	}
	const wm = _weight_material()
	register(new ItemType("hanging-spring", "Hanging spring", "Springs & ropes", build_hanging, {
		material: wm, materials: _has(wm, "steel", "aluminium", "brick", "varnished hardwood"),
		props: [
			new Prop("stiffness", "Stiffness", 20.0, 1.0, 500.0, 0.5, "N/m", "How hard it pulls per metre stretched"),
			new Prop("rest_length", "Rest length", 0.3, 0.05, 1.0, 0.01, "m", "Its length with nothing hanging on it"),
			new Prop("weight", "Weight", 0.2, 0.05, 5.0, 0.01, "kg"),
			new Prop("damping", "Damping", 0.05, 0.0, 10.0, 0.01, "N·s/m", "Friction that slows the bouncing"),
			new Prop("start_stretch", "Start stretch", 0.2, 0.0, 1.0, 0.01, "m", "How far the spring is stretched when it lets go (at most until it would close its coils on the way back up); it then bounces about the point m·g/k below its rest length")
		],
		tags: ["hooke", "oscillate", "bounce", "bouncing weight", "coil", "slinky", "elastic", "mass on a spring", "harmonic", "vibrate"],
		description: "A weight on a coil spring, stretched and let go: it bounces up and down with a period 2π√(m/k).",
		source: "Hooke's law F = −kx; period 2π√(m/k) (textbook). A teaching-lab coil spring is about 10-50 N/m (provisional); the spring itself has no weight.",
		anchor: "the top of the spring", facts: "20 N/m · 0.2 kg · period 0.63 s"
	}))

	// --- spring launcher
	register(new ItemType("spring-launcher", "Spring launcher", "Springs & ropes", (c, P) => _sprung_plate(c, P, false), {
		material: "varnished hardwood", materials: _has("varnished hardwood", "aluminium", "steel", "solid rubber"),
		props: [
			new Prop("stiffness", "Stiffness", 800.0, 50.0, 5000.0, 10.0, "N/m", "Both springs together (at most what the plate's weight allows: a very small plate gets less)"),
			new Prop("rest_length", "Spring length", 0.15, 0.05, 0.5, 0.005, "m", "Uncompressed"),
			new Prop("compression", "Held compressed by", 0.06, 0.0, 0.45, 0.005, "m", "How far the plate is pressed down until the scene's release (at most until the coils close)"),
			new Prop("width", "Plate width", 0.16, 0.06, 0.6, 0.005, "m"), new Prop("depth", "Front to back", 0.10, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"),
			new Prop("damping", "Damping", 0.5, 0.0, 20.0, 0.1, "N·s/m")
		],
		tags: ["catapult", "fling", "throw", "launch", "springboard", "plunger", "pop up", "ejector", "kick"],
		description: "A plate held down on two compressed springs. At the scene's release it springs up and flings what sits on it; tilt the item to aim.",
		source: "Stored energy ½kx². With 800 N/m pressed 6 cm the plate and a 60 g ball leave at about 4 m/s (textbook energy balance; the values are provisional).",
		anchor: "the middle of its base's top", facts: "800 N/m · pressed 6 cm · 0.09 kg plate", edit: [{ kind: "length", prop: "width" }, { kind: "rotate" }]
	}))

	// --- bounce pad
	register(new ItemType("bounce-pad", "Bounce pad", "Springs & ropes", (c, P) => _sprung_plate(c, P, true), {
		material: "solid rubber", materials: _has("solid rubber", "varnished hardwood", "aluminium", "steel"),
		props: [
			new Prop("stiffness", "Stiffness", 1000.0, 50.0, 10000.0, 10.0, "N/m", "Both springs together (at most what the plate's weight allows: a very small plate gets less)"),
			new Prop("rest_length", "Spring length", 0.08, 0.03, 0.4, 0.005, "m"),
			new Prop("width", "Plate width", 0.2, 0.06, 0.8, 0.005, "m"), new Prop("depth", "Front to back", 0.10, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"),
			new Prop("damping", "Damping", 0.5, 0.0, 20.0, 0.1, "N·s/m")
		],
		tags: ["trampoline", "spring board", "kicker", "bouncer", "cushion", "pad", "springy", "pogo", "rebound"],
		description: "A thin rubber plate bolted on two springs over a base: things landing on it sink in a little and are pushed back up.",
		source: "Hooke's law springs bolted under the plate (they hold it down as well as push it up); stiffness, damping and the plate are provisional.",
		anchor: "the middle of its base's top", facts: "1000 N/m · thin rubber plate 20 cm", edit: [{ kind: "length", prop: "width" }, { kind: "rotate" }]
	}))

	// --- trampoline: a mat held by pre-stretched springs in its own plane
	function build_trampoline(c, P) {
		const W = P.width
		const h = P.height
		const m = P.mat_mass
		const d = P.depth
		const damp = P.damping
		const L0 = 0.15
		const t = 0.004
		// a light mat on two strong springs is light along them as well, and turns on them when it is pressed deep (each spring gets twice the stiffness prop):
		// no more than the engine's step can follow on it (_spring_cap). Pressed down so that the springs slope at φ (here: as deep as a heavy ball presses it,
		// until they slope at 45°, or half way to the floor), the two mirror-image springs move the mat sideways and turn it as one motion, at the rate
		// (2cos²φ/m + 2(W/2)²sin²φ/I) per N/m (math.atan2 is V8's here: see the top)
		const sn = sin(Math.atan2(pymin(h / 2, L0), L0))
		const I = div(m * (W * W + t * t), 12)
		const K = _spring_cap(P, div(2 * (1 - sn * sn), m) + div(2 * pow((W / 2) * sn, 2), I), 2.0)
		const ks = 2 * K
		const rest = L0 - (K * L0 / 2) / ks
		// where the mat hangs: its weight is carried by the vertical pull of the two sloped springs
		let sag = _bisect((s) => 2 * ks * (hypot(L0, s) - rest) * s / hypot(L0, s) - m * G, 0.0, 1.0)
		sag = pymin(sag, h - t / 2 - 0.001) // a heavy mat on soft springs would sag to the floor: it starts just over it
		const steel = _steel(c)
		const xl = W / 2 + L0 + 0.02
		const rows = pymax(2, pymin(12, pyRoundInt(d / 0.06))) // a real mat is held by a spring every 5-8 cm along each end (at most 12 are drawn: a 2 m mat has one every 17 cm): the view draws this many coils across the depth
		c.slab("mat", W, t, d, 0, h - sag, { material: c.mat({ density: m / (W * t * d) }), words: "a trampoline mat" })
		// each end is a steel U-frame of the mat's depth (two uprights and a rail at spring height, standing on the floor): open floor between the two
		;[-1, 1].forEach((sx, n) => {
			c.slab(`leg${n + 1}`, 0.04, h + 0.02, d, sx * xl, (h + 0.02) / 2, { kind: "static", words: "an end frame of the trampoline", look: "steel", material: steel })
			// a trampoline spring is a close-wound extension spring: about 3 mm of wire a turn (some 37 turns over its 11 cm), 24 mm across
			_spring(c, `spring${n + 1}`, "mat", `leg${n + 1}`, [sx * W / 2, 0], [-sx * 0.02, h - (h + 0.02) / 2], rest, ks, damp, { coils: pymax(20, pyRoundInt(rest / 0.003)), render: { rows } })
		})
	}
	register(new ItemType("trampoline", "Trampoline", "Springs & ropes", build_trampoline, {
		material: "trampoline mat", materials: ["trampoline mat"],
		props: [
			new Prop("width", "Mat width", 0.8, 0.3, 2.0, 0.01, "m"), new Prop("height", "Height of the mat", 0.35, 0.15, 1.5, 0.01, "m"),
			new Prop("stiffness", "Stiffness", 300.0, 50.0, 3000.0, 10.0, "N/m", "How hard the mat pushes back per metre it is pressed down (at most what the mat's weight allows: a very light mat gets less)"),
			new Prop("mat_mass", "Mat weight", 0.05, 0.03, 5.0, 0.01, "kg", "A mat heavier than the ball takes its bounce away: a light one bounces a ball well"), new Prop("depth", "Front to back", 0.6, 0.05, 2.0, 0.05, "m", "Only for the 3D look and the weight"),
			new Prop("damping", "Spring damping", 5.0, 0.0, 12.0, 0.5, "N·s/m", "Along each spring: the mat's up-and-down motion feels only a small share of it")
		],
		tags: ["bounce", "jump", "springs", "mat", "bouncy castle", "rebound", "gymnastics", "elastic", "stretch"],
		description: "A mat held between two frames by pre-stretched springs, like a real trampoline's: press it down and the sloped springs push it back up.",
		source: "A stretched spring of tension T over a span L gives a restoring force of about 2T/L per metre of dip (the same geometry as a plucked string); the mat and spring values are provisional.",
		anchor: "the floor under the middle", facts: "80 cm mat · 0.35 m up · 300 N/m", edit: [{ kind: "length", prop: "width" }, { kind: "top", prop: "height" }]
	}))

	// --- spring bumper
	function build_bumper(c, P) {
		const H = P.height
		const d = P.depth
		const rest = P.rest_length
		const damp = P.damping
		// the plate is 3 cm thick, thicker on a tall plate, so that turned on its corner it is always taller (by 2.5 mm at least) than it is between the shelf and the keeper
		const t = pymax(0.03, msqrt(pow(H + 0.0025, 2) - H * H))
		// a small plate is light: its springs (a quarter of its height above and below its middle) get no more stiffness than the engine's step can follow on it (_spring_cap)
		const mp = MATERIALS[P.material].density * t * H * d
		const k = _spring_cap(P, _rate(mp, div(mp * (t * t + H * H), 12), [H / 4 + 0.0005, 0.0005 - H / 4]), 0.5)
		// pressed in at most until the coils close (the springs' turns, as _spring draws them, 2 mm wire, side by side plus the two seats), and pulled out no further than that
		// either (let go, it springs back in as far as it was pulled out); the shelf runs on under the plate as far out as it goes, and 4 cm more
		const coils = pymax(5, pymin(24, Math.trunc(rest / 0.01)))
		const solid = coils * 0.002 + 0.004
		const room = rest - solid
		const push = pymax(-room, pymin(P.pushed_in, room))
		const wood = _wood(c)
		// the plate travels out at most until its face is as far out as it starts (pulled out, or swinging back out from pressed in), and a stop at the end of the keeper
		// and of the shelf catches it there (2 mm past that): a hit that drives it in hard cannot throw it out from under the keeper
		const kl = rest + Math.abs(push) + t + 0.008
		const end = kl + 0.04
		// the keeper's clearance over the plate's top: 4 mm, less on a plate whose corner-to-corner span is not that much taller than the plate (it could turn over under it)
		const gap = pymin(0.004, msqrt(H * H + t * t) - H - 0.001)
		// everything stands on the floor at the origin: the 10 mm shelf on it (so the plate never touches what the bumper stands on), the plate on the shelf, the wall
		// up to the keeper rail's top
		const wall_h = H + 0.0205 + gap
		c.slab("wall", 0.03, wall_h, d, -0.015, wall_h / 2, { kind: "static", words: "the wall the bumper is mounted on", look: "wood", material: wood })
		// a greased steel runner on the shelf: the plate slides on it freely, as a real bumper's plate is carried by its springs (any drag at its foot rocks a tall plate over)
		const slick = c.mat({ base: "varnished hardwood", overrides: { friction: 0.0 } })
		c.slab("shelf", end, 0.01, d, end / 2, 0.005, { kind: "static", words: "the shelf the plate slides on", look: "wood", material: slick })
		// the keeper: a rail from the wall over the plate's top, `gap` clear of it, as far out as the plate goes. Two point springs alone cannot hold a plate square, as
		// bolted coil springs do: pressed hard, the plate would buckle up and turn over; between the shelf and the keeper it rocks a few degrees at most and slides
		c.slab("keeper", kl, 0.01, d, kl / 2, H + 0.0155 + gap, { kind: "static", words: "the rail over the plate that keeps it square", look: "wood", material: slick })
		// the end stops: a block under the keeper's end, down to 4 mm below the plate's top, and a steel strip across the shelf's top, both 6 mm wide
		c.slab("catch", 0.006, gap + 0.004, d, kl - 0.003, H + 0.0085 + gap / 2, { kind: "static", words: "the stop at the end of the keeper", look: "wood", material: wood })
		c.slab("lip", 0.006, 0.006, d, kl - 0.003, 0.013, { kind: "static", words: "the stop at the end of the shelf", look: "steel", material: _steel(c) })
		c.slab("plate", t, H, d, rest - push + t / 2, 0.01 + H / 2 + 0.0005, { words: "a spring-mounted bumper plate" })
		// the coil's radius (picture only): 12 mm, narrower on a plate less than ~31 mm deep so it stays on its seat, or less than ~6 cm tall so the two coils (half the
		// plate's height apart) stand 6 mm apart and their seats stay on the plate
		const cr = pymax(0.004, pymin(pymin(0.012, d / 2 - 0.0033), H / 4 - 0.003))
		const steel = _steel(c)
		;[0.25, 0.75].forEach((fy, n) => {
			_spring(c, `spring${n + 1}`, "wall", "plate", [0.015, 0.01 + fy * H - wall_h / 2], [-t / 2, fy * H - (H / 2 + 0.0005)], rest, k / 2, damp / 2, { radius: cr })
			// inside each coil a steel guide pin from the wall, 1 mm shorter than the closed coil: hit hard, the plate lands on the pins before the coils close (a real spring stops at coil bind)
			const rr = pyRound(0.5 * cr, 5)
			c.slab(`pin${n + 1}`, solid - 0.001, 2 * rr, 2 * rr, (solid - 0.001) / 2, 0.01 + fy * H, { kind: "static", words: "a steel guide pin inside the spring", look: "steel", material: steel })
		})
	}
	register(new ItemType("spring-bumper", "Spring bumper", "Springs & ropes", build_bumper, {
		material: "varnished hardwood", materials: _has("varnished hardwood", "aluminium", "steel", "solid rubber"),
		props: [
			new Prop("height", "Plate height", 0.12, 0.04, 0.5, 0.005, "m"), new Prop("rest_length", "Spring length", 0.1, 0.03, 0.5, 0.005, "m"),
			new Prop("stiffness", "Stiffness", 300.0, 20.0, 5000.0, 10.0, "N/m", "Both springs together (at most what the plate's weight allows: a very small plate gets less)"),
			new Prop("pushed_in", "Pushed in at the start", 0.0, -0.1, 0.1, 0.005, "m", "Positive presses the plate toward the wall, negative pulls it out (either way at most as far as the coils can close); it springs back at the scene's release"),
			new Prop("depth", "Front to back", 0.10, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"), new Prop("damping", "Damping", 1.0, 0.0, 30.0, 0.1, "N·s/m")
		],
		tags: ["buffer", "shock absorber", "cushion", "wall", "spring plate", "pinball", "kicker", "stop", "recoil", "dampen"],
		description: "A plate on two springs mounted on a wall (the plate faces right and slides between a shelf and a rail over it; a guide pin inside each spring stops it before the coils close). A ball that hits it pushes it back and gets pushed out again.",
		source: "Hooke's law springs; the plate slides on a greased runner, so the springs alone set how it rings. Stiffness and size are provisional.",
		anchor: "the floor under the wall's face", facts: "300 N/m · 12 cm plate", edit: [{ kind: "top", prop: "height" }, { kind: "rotate" }]
	}))

	// --- spring-hinged gate
	function build_gate(c, P) {
		const L = P.length
		const th = P.thickness
		const d = P.depth
		let a = P.start_angle
		const damp = P.damping
		const reach = P.spring_reach
		const arm = 0.7 * L // the spring pulls at 70 % of the way down the gate
		// a small thin gate is light: its spring gets no more stiffness than the engine's step can follow on it (_spring_cap; the eye is ex across and 0.2 L down
		// from the plank's middle, and its lever arm is never more than that distance, whichever way the spring pulls)
		const ex = th / 2 + 0.0026
		const m = MATERIALS[P.material].density * th * L * d
		const k = _spring_cap(P, _rate(m, div(m * (th * th + L * L), 12), [hypot(ex, L / 2 - arm)]), 1.0)
		// the spring runs from the eye screw in the plank's right face to the post's left face, `reach` from the gate's middle line: it is at its rest length while the gate hangs
		// straight, so it pulls the gate back to hanging straight (not to one side), however thick the gate
		const rest = reach - th / 2 - 0.0026
		const solid = pymax(5, pymin(24, Math.trunc(rest / 0.01))) * 0.002 + 0.004
		// opened toward the post, the gate stops where its spring's coils close or the plank meets the post (a real gate can be swung no further): a start angle past that starts there
		if (a > 0) a = _gate_stop(L, th, arm, reach, solid, a)
		// let go, it swings to and fro as far as its energy (the spring's and the plank's weight's, from hanging straight) carries it. Toward the post the energy rises up to
		// that stop, or to where the pressed spring goes over centre and would fling the gate on up into its hanger; away from the post up to 85 degrees (the hanger beyond).
		// So it starts low enough on that hill on either side to turn back short of both tops
		const energy = (t) => {
			const x = ex * cos(t) + arm * sin(t)
			const y = ex * sin(t) - arm * cos(t)
			return 0.5 * k * pow(hypot(x - reach, y + arm) - rest, 2) + m * G * (L / 2) * (1 - cos(t))
		}
		/** How far (degrees, up to end) the gate turns to side sd from hanging straight while its energy still rises (in 0.5 degree steps), and the energy there. */
		const hill = (sd, end) => {
			let u = 0.0
			let e = 0.0
			while (u < end) {
				const v = pymin(end, u + 0.5)
				const ev = energy(sd * v * D2R)
				if (ev <= e) break
				u = v
				e = ev
			}
			return [u, e]
		}
		const tops = new Map([[1.0, hill(1.0, _gate_stop(L, th, arm, reach, solid, 80.0))], [-1.0, hill(-1.0, 85.0)]])
		const cap = pymin(tops.get(1.0)[1], tops.get(-1.0)[1])
		const side = a > 0 ? 1.0 : -1.0
		if (Math.abs(a) > tops.get(side)[0] || energy(a * D2R) > cap) {
			a = side * _bisect((u) => energy(side * u * D2R) - cap, 0.0, pymin(Math.abs(a), tops.get(side)[0]))
		}
		const ar = a * D2R
		P.start_angle = pyRound(a, 3) // (what was built: the inspector and the swing handle show the gate where it is)
		// the gate turns on a hinge at the middle of its top end (the origin), so its top corners swing up to th/2 above it: the hanger's underside stands 3 mm over that
		// (6 mm at least, for the hinge's knuckle) at any angle and thickness; the hinge's web runs down to the pin
		const drop = pymax(0.006, th / 2 + 0.003)
		_hanger(c, { y: drop + 0.006 })
		c.slab("post", 0.02, 0.06, d, reach + 0.01, -arm, { kind: "static", words: "a post the spring is fixed to", look: "wood", material: _wood(c) })
		c.slab("gate", th, L, d, (L / 2) * sin(ar), -(L / 2) * cos(ar), { langle: a, words: "a gate on a spring hinge", pivot: { x: 0.0, y: pyRound(L / 2, 5) } })
		_spring(c, "spring", "gate", "post", [th / 2 + 0.0026, L / 2 - arm], [-0.01, 0.0], rest, k, damp) // on the eye screw in the plank's right face
		// the hinge's friction: its 3.8 mm steel pin (web/models/mechanisms-springs.js) turns in the knuckles under the gate's weight, μ·r·m·g (the spring is at its
		// rest length while the gate hangs). The gate's pivot (named, as every hinged part's is) is frictionless in the engine, so the friction is a pin joint at the
		// same point, drawn by the gate's own hinge (render.hinge "none")
		_joint(c, "pin", "hinge", { a: null, b: "gate", anchorA: [0.0, 0.0], anchorB: [0.0, pyRound(L / 2, 5)], friction: pyRound(PIN_FRICTION * 0.0019 * m * G, 6), render: { hinge: "none" } })
	}
	register(new ItemType("spring-gate", "Spring gate", "Springs & ropes", build_gate, {
		material: "varnished hardwood", materials: _has("varnished hardwood", "aluminium", "steel"),
		props: [
			new Prop("length", "Length", 0.4, 0.1, 1.5, 0.01, "m"), new Prop("thickness", "Thickness", 0.02, 0.005, 0.1, 0.001, "m"),
			new Prop("depth", "Width (front to back)", 0.12, 0.02, 1.0, 0.01, "m"),
			new Prop("start_angle", "Start angle", 40.0, -80.0, 80.0, 1.0, "°", "From hanging straight down; positive swings it to the right, as far as its spring and post let it, negative to the left, only as far as it then swings back short of the post"),
			new Prop("stiffness", "Spring stiffness", 40.0, 2.0, 1000.0, 1.0, "N/m", "A spring from the gate, 70 % of the way down, to a post on its right (at most what the gate's weight allows: a very small, thin gate gets less)"),
			new Prop("spring_reach", "Spring length", 0.4, 0.2, 1.0, 0.01, "m", "How far the post stands from the gate when it hangs straight: keep it more than the gate swings"),
			new Prop("damping", "Damping", 0.3, 0.0, 10.0, 0.05, "N·s/m")
		],
		tags: ["door", "saloon door", "flap", "self closing", "swing door", "hinge", "spring hinge", "return", "paddle"], anchor: "the hinge, at the top",
		description: "A gate hung from a hinge, with a spring that pulls it back to hanging straight: it swings open when hit and comes back.",
		source: "A spring across a hinge acts like a torsion spring k·a² (a the arm to the spring); the hinge's steel pin turns with Coulomb friction 0.3 under the gate's weight. The spring, the friction and the gate are provisional.",
		facts: "40 cm gate · 40 N/m spring", edit: [{ kind: "swing", prop: "start_angle", length: "length" }]
	}))

	// --- spring catapult
	function build_catapult(c, P) {
		const L = P.arm_length
		const a = P.cocked_angle * D2R
		const k = P.stiffness
		const t = 0.02
		const d = 0.05
		// the post is at least tall enough for the cocked arm: the long end's lowest corner (0.7 L out from the pivot, under the arm) stays 4 mm over the base's top
		// (a long arm cocked steeply gets a taller post rather than starting inside the base or the table)
		const H0 = pymax(P.post_height, 0.7 * L * sin(a) + (t / 2) * cos(a) + 0.004)
		const wood = _wood(c)
		const short = 0.3 * L
		const ca = cos(a)
		const sa = sin(a)
		// the spring: a close-wound tension spring from the eye under the short end (s along the arm from the pivot, e under its middle line) straight down to the base,
		// a turn every 3.2 mm at its rest length (18 turns at least, 68 at most: the view draws a single coil at 288 triangles a turn, so the item stays under 30k)
		const s_eye = short - 0.02
		const e_eye = t / 2 + 0.0006
		const rest0 = pymax(0.02, 0.3 * (H0 + s_eye * sa))
		const coils = pymax(18, pymin(68, pyRoundInt(rest0 / 0.0032)))
		// the arm ends its swing on the stop at most 50 degrees past level (a steeper end would carry its short end, and the spring, into the post), and never where the eye,
		// allowing for the arm's overshoot of its limit (3 degrees at most), comes nearer the base than the spring's closed length (its turns of wire, at most 0.96 mm in
		// radius, side by side, its hooks) and 2 mm: a long arm on a short post stops sooner (a larger sweep stops there)
		const need = coils * 2 * 0.00096 + 0.004
		const eye_y = (u) => H0 + s_eye * sin(u) - e_eye * cos(u)
		const lowest = eye_y(-53 * D2R) >= need ? -50 * D2R : _bisect((u) => eye_y(u) - need, -53 * D2R, a) + 3 * D2R
		const sweep = pymin(P.sweep, P.cocked_angle - lowest / D2R)
		P.sweep = pyRound(sweep, 3) // (what was built: the inspector shows where the arm stops)
		// the base reaches under the spring's foot (under the cocked eye) with 3 cm to spare
		const tip_x = s_eye * ca
		const right = pymax(0.17, tip_x + 0.03)
		// the spring is still stretched (by 5 mm at least) when the arm lies on its stop, so it holds the arm down there: a spring shorter than its rest length
		// there pushed a long arm on a short post back up off its stop, and it bobbed for seconds
		const th = (P.cocked_angle - sweep) * D2R
		const rest = pymin(rest0, hypot(s_eye * cos(th) + e_eye * sin(th) - tip_x, eye_y(th)) - 0.005)
		c.slab("base", 0.17 + right, 0.02, 0.1, (right - 0.17) / 2, -0.01, { kind: "static", words: "the catapult's base", look: "wood", material: wood })
		// the post's two cheeks are rounded over the pivot pin (a 9 mm lug: web/models/mechanisms-springs.js), so the post stands that much over the pivot
		c.slab("post", 0.03, H0 + 0.009, 0.06, 0.0, (H0 + 0.009) / 2, { kind: "static", words: "the post the arm turns on", look: "wood", material: wood })
		// the arm: its +x end is the short end (up when cocked), the long end (left) carries the ball
		const arm = c.slab("arm", L, t, d, -0.2 * L * ca, H0 - 0.2 * L * sa, { langle: P.cocked_angle, words: "the catapult's throwing arm" })
		_child(c, "lip", arm, 0.008, 0.03, d, -L / 2 + 0.004, t / 2 + 0.015, c.mat(), "a small lip that holds the ball", "wood")
		// where the arm comes to rest: it overshoots its limit and settles about 1.7 degrees short of it (the engine's angular slop)
		const th_rest = th + 1.7 * D2R
		// the spring's foot is under the cocked eye, its top leans in to where the eye lands (the end of the swing and the 3 degrees the arm overshoots it). Its coil is 12 mm
		// in radius, narrower (5 mm at least) where the eye, cocked or landing, stands close to the post, and the stop on the post's face (26 mm out from it, 10 mm at least)
		// ends 3.5 mm short of the coil's middle less its radius, wherever the eye is
		const ex = s_eye * cos(th - 3 * D2R) + e_eye * sin(th - 3 * D2R)
		const cr = pymax(0.005, pymin(pymin(0.012, tip_x - 0.0285), ex - 0.0285))
		// the stop: a wooden block on the post's right face; two bodies come to rest a contact skin (about 2.6 mm between these two) apart, so its top is 2.4 mm under the
		// arm's underside at the resting angle, and the picture's rubber cap stands up to the arm (web/models/mechanisms-springs.js); the joint's limit is reached first
		const y_top = (x) => H0 - (t / 2) * cos(th_rest) + div(x - (t / 2) * sin(th_rest), cos(th_rest)) * sin(th_rest) - 0.0024
		const x0 = 0.015
		const x1 = pymin(0.041, pymax(0.025, pymin(tip_x, ex) - cr - 0.0035))
		const bh = 0.024
		// (its rubber cap makes it a dead stop: the arm lands on it and stays, where a bare wooden block let a strong spring's arm chatter on it)
		c.poly("stop", [[x0, y_top(x0) - bh], [x1, y_top(x1) - bh], [x1, y_top(x1)], [x0, y_top(x0)]], 0.044, 0.0, 0.0, {
			kind: "static", look: "wood", material: c.mat({ base: "varnished hardwood", overrides: { bounce: 0.1 } }), words: "the stop the arm comes to rest on"
		})
		// released, nothing holds the arm up but its spring (the engine holds every part still until the release): a spring too weak for the load lets the long end
		// fall onto the base or the table, or past the table's edge. The hinge's other limit (the engine wants one) is where the arm's underside meets the floor of the
		// post's slot (web/models/mechanisms-springs.js cuts the slot as deep as the arm needs, cocked and landed, and 2 mm more): a stop that is always drawn. (It was
		// also 3 degrees past where the long end reached the tabletop under the base, which held the arm in mid-air beside the table when the base stood at its edge;
		// on a table the base or the tabletop stops the arm before the slot does)
		// (math.tan is V8's here, as for the skateboard's kicktails: see the top)
		const slot = pymin(0.6 * H0, pymax(0.024, maxOf([P.cocked_angle, P.cocked_angle - pymin(P.sweep, P.cocked_angle + 50) - 3].map(
			(e) => 0.015 * Math.abs(Math.tan(e * D2R)) + div(t / 2, cos(e * D2R)) + 0.002))))
		const deep = 0.015 * Math.tan(a) + div(t / 2, ca) - slot
		const top = deep >= 0 ? a : _bisect((u) => 0.015 * Math.tan(u) + div(t / 2, cos(u)) - slot, a, 89 * D2R)
		// the pivot's friction: an 8 mm steel bolt turning in the steel straps on the arm (web/models/mechanisms-springs.js), μ·r times the load it carries with the
		// arm cocked (the spring's pull and the arm's weight). It settles an arm that the spring holds up off its stop (a weak spring, a long arm) where it stops
		// (a 0.8 m arm on a 20 N/m spring with a baseball: still within 5 s), and takes about 2 % off the throw's speed (a 300 N/m arm: a golf ball at 4.94 m/s
		// rather than 5.02 without it)
		const m_arm = MATERIALS[P.material].density * L * t * d
		const load = m_arm * G + k * (hypot(e_eye * sa, eye_y(a)) - rest)
		_joint(c, "pin", "hinge", {
			a: "post", b: "arm", anchorA: [0, H0 / 2 - 0.0045], anchorB: [0.2 * L, 0], limits: { lower: pyRound(-sweep * D2R, 5), upper: pyRound(top - a, 5) },
			friction: pyRound(PIN_FRICTION * 0.004 * load, 6)
		})
		// the spring's damping: its own losses (a close-wound steel spring and its hooks), 2 % of critical for the bare arm swinging about its pin on the spring and
		// its own weight (ζ = c·s² / (2√(κ·I)), κ = k·s² + m·g·r the turning stiffness, s the eye's lever, r = 0.2 L how far the arm's middle is from the pin, I the
		// arm's about the pin; provisional). (A fifth of critical stood in for the pin's friction too, before the engine's pins had any: it took a sixth off the
		// throw's speed)
		const I_pin = m_arm * (L * L + t * t) / 12 + m_arm * pow(0.2 * L, 2)
		const damp = div(2 * 0.02 * msqrt((k * s_eye * s_eye + m_arm * G * 0.2 * L) * I_pin), s_eye * s_eye)
		_spring(c, "spring", "arm", "base", [L / 2 - 0.02, -t / 2 - 0.0006], [tip_x - (right - 0.17) / 2, 0.01], rest, k, damp, { coils, radius: pyRound(cr, 5) })
	}
	register(new ItemType("spring-catapult", "Spring catapult", "Springs & ropes", build_catapult, {
		material: "varnished hardwood", materials: _has("varnished hardwood", "aluminium"),
		props: [
			new Prop("arm_length", "Arm length", 0.4, 0.3, 1.2, 0.01, "m", "The ball sits on the long end, on the left; the spring pulls the short end down"),
			new Prop("cocked_angle", "Cocked angle", 25.0, 5.0, 60.0, 1.0, "°", "How far the long end is held below level until the release"),
			new Prop("sweep", "Swing before the stop", 70.0, 20.0, 110.0, 1.0, "°", "Where the arm hits its stop and lets the ball fly: about 70° flings it up and to the right at 45°. The stop is at most 50° past level, and higher where a long arm's short end would come down on the base, so a longer swing ends there"),
			new Prop("stiffness", "Spring stiffness", 300.0, 20.0, 3000.0, 10.0, "N/m"), new Prop("post_height", "Post height", 0.15, 0.08, 0.6, 0.005, "m", "The pivot's height; a long arm cocked steeply gets a taller post, so its end stays clear of the base")
		],
		tags: ["launcher", "trebuchet", "fling", "throw", "lever", "arm", "siege", "sling", "hinge", "spring loaded"],
		description: "A hinged arm pulled down by a spring and held cocked until the scene's release. Put a ball on the long end (left): it is flung to the right.",
		source: "A lever with a stretched spring; the arm stops at a limit and the ball keeps going (textbook energy balance). Its pivot bolt turns with Coulomb friction 0.3 under the load it carries. Spring, friction and sizes are provisional.",
		anchor: "the floor under its post", facts: "40 cm arm · 300 N/m", edit: [{ kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- ropes
/** A bob hung by a rope from a fixed point (the hanger's underside is the item's origin; the rope is tied through the screw eye a few mm below it, a wrecking ball's chain hangs on a clevis pin a little lower).
 *  The rope is made fast at the bob's lifting eye, on the line through the ball's centre, and the bob starts turned to lie along the rope: it swings
 *  rigidly with it, as a real one does, and the eye the 3D view draws follows the rope. The rope is shorter than the length by the ball's radius and the eye's height. */
function _bob(c, P, hanger_width, wrecking = false) {
	let L = P.length
	let a = P.start_angle * D2R
	// (a wrecking ball lists no bob_diameter, but an item may still set one, which clean() keeps as it is: a string there is a TypeError in Python (HTTP 500), as is
	// `bob_diameter / 2` for any non-number but a bool, and a diameter of 0 divides by zero below, which the server answers with HTTP 400)
	const rho = MATERIALS[P.material].density
	const r = hasOwn(P, "bob_diameter") ? _half(P.bob_diameter) : pow((3 * P.bob_mass) / (4 * Math.PI * rho), 1 / 3)
	let k
	let e
	let hook
	let side
	if (wrecking) {
		// a forged eye (web/models/mechanisms-ropes.js): its size follows the ball; the chain's wire is sized to pass through it, and its top link hangs on a pin in a clevis
		k = pymin(2.2, pymax(0.67, r / 0.045))
		e = 0.0099 * k
		const wire = pymin(0.012, pymax(0.004, 0.006 * k))
		hook = wire + 0.0036
		// the view draws the chain's links alternately face-on and edge-on: a face-on link stands 1.775 wire diameters either side of the chain's line (web/view3d.js chainLinkGeometry)
		side = 1.775 * wire
	} else {
		// the bob's screw eye follows the ball up to a 20 cm ball (a 38 mm eye; a heavy ball on a toy-sized eye looked wrong), and is no smaller than a 1.75 cm ball's
		k = pymin(4.0, pymax(0.35, r / 0.025))
		e = 0.0047 * k
		hook = SCREW_EYE // the rope is tied through the hanger's brass screw eye (web/models/mechanisms-parts.js screwEye), whose ring is this far below the underside
		side = 0.0015 // the rope's radius (3 mm rope)
	}
	L = pymax(L, r + e + hook + 0.02)
	if (L > P.length) P.length = pyRound(L, 5) // (what was built: a big bob on a short rope hangs lower)
	// pulled up past the side, a big bob on a short rope would start inside the hanger it hangs from: it starts where it meets it, 3 mm short
	a = copysign(_swing_stop(L, r, hook, hanger_width, Math.abs(a)), a)
	// the taut rope runs straight from its tie, `hook` under the middle of the hanger's underside: pulled up to about level, it would run through the hanger's lower corner,
	// so it starts where it passes that corner with 0.5 mm to spare (a rope's radius from its line, a chain's face-on link's half width): just past level for the rope,
	// just short of it for a chain
	const a_max = Math.PI / 2 + macos(pymin(1.0, div(side + 0.0005, hypot(hook, hanger_width / 2)))) - Math.atan2(hanger_width / 2, hook)
	a = copysign(pymin(Math.abs(a), a_max), a)
	P.start_angle = pyRound(a / D2R, 3) // (what was built: the inspector and the swing handle show the bob where it is)
	_hanger(c, { width: hanger_width, steel: wrecking })
	if (hasOwn(P, "bob_diameter")) {
		// a bob of the chosen material, solid, as a ball of that size and material weighs (a 5 cm steel bob 0.51 kg, a wooden one 46 g). A typed weight is kept
		// exactly, as a ball's is (it does not follow the size): a bob lighter than solid is a hollow shell of the material, its wall as thick as that weight makes it
		// (it swings and rolls as a shell does; the material's density is trimmed by the rounding of the wall to the micrometre, so the weight is exact), and one
		// heavier than solid is weighted inside (denser than its material, as a lead-filled bob is). (A clamped weight showed the typed number in the inspector.)
		const vol = (4 / 3) * Math.PI * pow(r, 3)
		const solid = rho * vol
		const m = hasOwn(truthy(c.item.props) ? c.item.props : {}, "bob_mass") ? P.bob_mass : solid
		let wall = null
		let mat = null
		if (m < solid) {
			wall = pymax(1e-6, pyRound(r - pow(pow(r, 3) - div(3 * m, 4 * Math.PI * rho), 1 / 3), 6))
			const x = div(m, vol - (4 / 3) * Math.PI * pow(r - wall, 3))
			mat = c.mat({ density: x >= 1 ? pyRound(x, 6) : Number(fmtG(x, 6)) })
		} else if (m > solid) {
			mat = c.mat({ density: pyRound(div(m, vol), 6) })
		}
		P.bob_mass = m
		c.ball("bob", r, L * sin(a), -L * cos(a) - hook, { material: mat, wall, words: "a heavy bob on a rope" })
	} else {
		c.ball("bob", r, L * sin(a), -L * cos(a) - hook, { words: "a heavy steel ball on a chain" })
	}
	const bob = c.sb.solids[c.sb.solids.length - 1]
	bob.angle = pyRound((hasOwn(bob, "angle") ? bob.angle : 0.0) + a, 6)
	bob.eye = pyRound(e, 5)
	// (a wrecking ball's chain collides while it is taut: what it swings into stops against its links, not only against the ball)
	const look = wrecking ? { thickness: pyRound(0.004 * k, 5), collide: true, render: { style: "chain" } } : { thickness: 0.003 }
	_joint(c, "rope", "rope", { a: "hanger", b: "bob", anchorA: [0, -0.006 - hook], anchorB: [0, r + e], length: pyRound(L - r - e, 5), ...look })
}

function _ropes() {
	// --- rope pendulum
	function build_rope_pendulum(c, P) {
		_bob(c, P, 0.08)
	}
	const bob0 = MATERIALS.steel.density * ((4 / 3) * Math.PI * pow(0.025, 3)) // kg: the default bob, a solid 5 cm steel ball (0.514 kg)
	register(new ItemType("rope-pendulum", "Rope pendulum", "Springs & ropes", build_rope_pendulum, {
		material: "steel", materials: _has("steel", "solid rubber", "varnished hardwood", "dark wood", "aluminium", "modeling clay"),
		props: [
			new Prop("length", "Rope length", 0.5, 0.1, 2.0, 0.01, "m", "From the fixed point to the middle of the bob"),
			new Prop("bob_diameter", "Bob diameter", 0.05, 0.01, 0.3, 0.001, "m"),
			new Prop("bob_mass", "Bob weight", bob0, 1e-4, 112.0, 1e-4, "kg", "Follows the size and the material (a solid ball) until you type a weight. " +
				"A typed weight is kept: a lighter bob is a hollow shell of the material, a heavier one is weighted inside", { auto: ["bob_diameter", "material"], slider_max: 10.0 }),
			new Prop("start_angle", "Start angle", 30.0, -90.0, 90.0, 1.0, "°", "From straight down; negative pulls the bob to the left. At most level with the fixed point: the rope stays taut and clear of the hanger")
		],
		tags: ["string", "bob", "clock", "swing", "oscillate", "weight on a string", "plumb", "period", "metronome"],
		description: "A bob on a rope from a fixed point. Pull it aside and let go: it swings with a period 2π√(L/g).",
		source: "Period 2π√(L/g) for small swings (textbook); a rope that stays taut can pull but never push.",
		anchor: "the fixed point, at the top", facts: "50 cm · 5 cm steel bob, 0.51 kg · period about 1.4 s", edit: [{ kind: "swing", prop: "start_angle", length: "length" }, { kind: "rotate" }]
	}))

	// --- wrecking ball
	function build_wrecking(c, P) {
		_bob(c, P, 0.2, true)
	}
	register(new ItemType("wrecking-ball", "Wrecking ball", "Springs & ropes", build_wrecking, {
		material: "steel", materials: ["steel"],
		props: [
			new Prop("length", "Chain length", 1.0, 0.2, 3.0, 0.01, "m", "From the crane's hook to the middle of the ball"),
			new Prop("bob_mass", "Ball weight", 3.0, 0.2, 30.0, 0.1, "kg", "A solid steel ball of this weight"),
			new Prop("start_angle", "Pulled back by", -60.0, -90.0, 90.0, 1.0, "°", "From straight down; negative pulls it to the left, so it swings right. At most until the taut chain would touch the beam, just short of level")
		],
		tags: ["demolition", "crane", "chain", "heavy ball", "smash", "knock down", "hammer", "pendulum", "swing", "destroy"],
		description: "A heavy steel ball on a chain, pulled back and let go: it swings through the bottom of its arc at its fastest and knocks into what stands there.",
		source: "Speed at the bottom √(2gL(1 − cos θ)) (energy balance). Real crane balls weigh from half a tonne up (provisional); this is a table-top model in solid steel, 7850 kg/m³.",
		anchor: "the crane's hook, at the top", facts: "3 kg · 1 m chain · 3 m/s at the bottom", edit: [{ kind: "swing", prop: "start_angle", length: "length" }, { kind: "rotate" }]
	}))

	// --- swing: a seat on two parallel ropes (it stays level and moves like a pendulum bob)
	function build_swing(c, P) {
		const L = P.rope_length
		const w = P.seat_width
		const a = P.start_angle * D2R
		const th = 0.02
		const d = P.depth
		const wood = _wood(c)
		c.slab("bar", w + 0.04, 0.012, 0.04, 0, 0.006, { kind: "static", words: "the bar the swing hangs from", look: "wood", material: wood })
		c.slab("seat", w, th, d, L * sin(a), -L * cos(a) - th / 2 - SCREW_EYE, { words: "a swing seat" })
		;[-1, 1].forEach((sx, n) => {
			const x = sx * (w / 2 - 0.02)
			_joint(c, "rope", `rope${n + 1}`, { a: "bar", b: "seat", anchorA: [x, -0.006 - SCREW_EYE], anchorB: [x, th / 2], length: pyRound(L, 5) }) // tied through the bar's screw eye
		})
	}
	register(new ItemType("swing", "Swing", "Springs & ropes", build_swing, {
		material: "varnished hardwood", materials: _has("varnished hardwood", "dark wood", "aluminium"),
		props: [
			new Prop("rope_length", "Rope length", 0.6, 0.2, 2.0, 0.01, "m"), new Prop("seat_width", "Seat width", 0.3, 0.1, 0.8, 0.01, "m"),
			new Prop("depth", "Front to back", 0.12, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"),
			new Prop("start_angle", "Start angle", -30.0, -80.0, 80.0, 1.0, "°", "How far the ropes are pulled from straight down; negative pulls the seat to the left")
		],
		tags: ["playground", "seat", "hammock", "ropes", "pendulum", "child", "rocking", "oscillate", "hang"],
		description: "A seat on two parallel ropes from a bar. The ropes stay parallel, so the seat stays level and swings like a pendulum as long as the ropes are.",
		source: "Two equal parallel ropes make a parallelogram: the seat moves like a point mass on a rope as long as them, period 2π√(L/g) (textbook).",
		anchor: "the middle of the bar, at the top", facts: "60 cm ropes · 30 cm seat · period about 1.6 s", edit: [{ kind: "swing", prop: "start_angle", length: "rope_length" }]
	}))

	// --- hanging chain
	function build_chain(c, P) {
		const S = P.span
		const Lc = pymax(P.chain_length, P.span * 1.02)
		const n = Math.trunc(P.links)
		const th = P.thickness
		// a catenary y = a (cosh(x/a) − cosh(S/2a)) with arc length Lc between two supports S apart; its points one link of arc apart are the pins
		const u = _bisect((x) => Math.sinh(x) / x - div(Lc, S), 1e-6, 60.0)
		const a = div(S, 2 * u)
		const pts = []
		for (let i = 0; i < n + 1; i++) {
			const s = -Lc / 2 + div(i * Lc, n)
			const x = a * Math.asinh(div(s, a))
			pts.push([x, a * (Math.cosh(div(x, a)) - Math.cosh(u))])
		}
		const steel = _steel(c)
		// the clevis blocks: 30 mm, or as big as a link is wide (3.4 wire diameters, the wire 0.29 of the thickness: web/models/mechanisms-ropes.js) and 6 mm more on each side,
		// but no bigger than the end bar is long (so the second bar starts clear of the block)
		const bw = pymax(0.03, pymin(pyRound(3.4 * 0.29 * th + 0.012, 4), pyRound(hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), 4)))
		for (const [nm, x] of [["post-left", -S / 2], ["post-right", S / 2]]) {
			c.slab(nm, bw, bw, pymax(0.04, bw), x, 0.0, { kind: "static", words: "a steel clevis block the chain is hung from", look: "steel", material: steel })
		}
		const links = []
		for (let i = 0; i < n; i++) {
			const [x0, y0] = pts[i]
			const [x1, y1] = pts[i + 1]
			const ln = hypot(x1 - x0, y1 - y0)
			links.push(ln)
			c.slab(`link${i + 1}`, ln, th, pymax(0.02, th), (x0 + x1) / 2, (y0 + y1) / 2, { langle: degrees(Math.atan2(y1 - y0, x1 - x0)), words: "a link of a chain" })
		}
		for (let i = 0; i < n + 1; i++) {
			const [a_part, a_pt] = i === 0 ? ["post-left", [0.0, 0.0]] : [`link${i}`, [links[i - 1] / 2, 0.0]]
			const [b_part, b_pt] = i === n ? ["post-right", [0.0, 0.0]] : [`link${i + 1}`, [-links[i] / 2, 0.0]]
			_joint(c, "pin", `pin${i + 1}`, { a: a_part, b: b_part, anchorA: a_pt, anchorB: b_pt, render: { hinge: "none" } }) // the links are drawn interlocked: no bolts at the joints
		}
	}
	register(new ItemType("hanging-chain", "Hanging chain", "Springs & ropes", build_chain, {
		material: "steel", materials: _has("steel", "aluminium", "varnished hardwood"),
		props: [
			new Prop("span", "Distance between the posts", 0.6, 0.1, 2.0, 0.01, "m"), new Prop("chain_length", "Chain length", 0.8, 0.1, 3.0, 0.01, "m", "Longer than the span, or it is pulled straight"),
			new Prop("links", "Links", 14, 4, 30, 1, "", "How many bars it is made of", { kind: "int" }), new Prop("thickness", "Link thickness", 0.01, 0.003, 0.05, 0.001, "m")
		],
		tags: ["catenary", "rope", "cable", "necklace", "sag", "bridge", "string of links", "suspended", "power line", "curve"],
		description: "Links pinned end to end between two fixed posts. It starts on its natural curve, a catenary, and hangs there.",
		source: "A chain hung from two points takes the catenary y = a cosh(x/a), a curve worked out by Huygens, Leibniz and Johann Bernoulli in 1691 (Galileo had thought it a parabola).",
		anchor: "the middle between the posts, at their height", facts: "14 links · 80 cm of chain between posts 60 cm apart", edit: [{ kind: "length", prop: "span" }]
	}))
}

// ---------------------------------------------------------------- pulleys
/** A bar over the two wheels at (-d/2, 0) and (d/2, 0), whose rope runs over both. */
function _rig(c, d, wr, extra = {}) {
	c.slab("bar", d + 0.06, 0.012, 0.04, 0, wr + 0.012, { kind: "static", words: "the bar the pulley wheels hang from", look: "wood", material: _wood(c), ...extra })
}

function _pulleys() {
	// --- Atwood machine
	function build_atwood(c, P) {
		const m1 = P.left_mass
		const m2 = P.right_mass
		const drop = P.drop
		const s1 = _cube(m1, P.material)
		const s2 = _cube(m2, P.material)
		const d = pymax(0.1, (s1 + s2) / 2 + 0.05)
		// one wheel spans both runs, as on a real Atwood machine: its radius is half the weights' spacing, so both strings hang straight down to the weights (the bar over it,
		// at wr + 0.012, leaves the view room to draw it that big). The bar is then more than 4 cm over the rope's ends, where the view would not look for what holds the
		// pulley up: it is told to stand the bar on a retort stand (a wall bracket above 1.3 m, as the view does by itself)
		const wr = pyRound(d / 2, 4)
		_rig(c, d, wr, { stand: c.world(0, wr + 0.006)[1] > 1.3 ? "wall" : "post" })
		// the wheel itself is solid: what falls or rolls onto it bangs into it. The view draws it from the joint (its rim d/2 - 0.5 mm from the axle), so this disc of
		// the same size is left out of the picture
		const R = d / 2 - 0.0005
		c.ball("wheel", R, 0.0, 0.0, { kind: "static", material: _steel(c), look: "steel", words: "the pulley wheel", hidden_3d: true })
		// the lighter weight hauled right up to the wheel jams square under it, its top JAM_GAP under the rim where it comes nearest it: there its rope's end stops
		// in the pulley (the joint's minLengthA/minLengthB), so the heavier one, which hauls it, stops with it and hangs on the rope (the rope pulls, never pushes,
		// and holds whatever the two weigh). One hung higher than that starts there
		const runs = [[-1, s1], [1, s2]].map(([sx, s]) => pyRound(_jam_run(0.0, R, sx * d / 2 - s / 2, sx * d / 2 + s / 2), 5))
		c.slab("left", s1, s1, s1, -d / 2, -pymax(drop, runs[0]) - s1 / 2, { words: "the left weight" })
		c.slab("right", s2, s2, s2, d / 2, -pymax(drop, runs[1]) - s2 / 2, { words: "the right weight" })
		// (web/view3d.js draws it |groundB - groundA| / 2 in radius, less the rope's radius and 0.5 mm, under the rope's top run)
		_joint(c, "pulley", "rope", {
			a: "left", b: "right", groundA: [-d / 2, 0], groundB: [d / 2, 0], anchorA: [0, s1 / 2], anchorB: [0, s2 / 2], ratio: 1.0, wheelRadius: pyRound(wr, 4),
			minLengthA: runs[0], minLengthB: runs[1], render: { wheel: "single" }
		})
	}
	const wm = _weight_material()
	register(new ItemType("atwood-machine", "Atwood machine", "Springs & ropes", build_atwood, {
		material: wm, materials: _has(wm, "steel", "aluminium", "brick"),
		props: [
			new Prop("left_mass", "Left weight", 0.3, 0.05, 3.0, 0.01, "kg"), new Prop("right_mass", "Right weight", 0.2, 0.05, 3.0, 0.01, "kg"),
			new Prop("drop", "Rope below the pulley", 0.45, 0.1, 2.0, 0.01, "m", "From the pulley to the top of each weight at the start")
		],
		tags: ["pulley", "rope", "two weights", "balance", "acceleration", "atwood", "newton second law", "lab", "hoist", "counterweight"],
		description: "Two weights on a rope over a pulley: the heavier falls and lifts the lighter, with an acceleration g(m₁ − m₂)/(m₁ + m₂).",
		source: "George Atwood, A Treatise on the Rectilinear Motion and Rotation of Bodies (1784): a = g(m₁ − m₂)/(m₁ + m₂) for a weightless rope and pulley. Weights use the conventional density 8000 kg/m³ (OIML R 111).",
		anchor: "the middle of the pulley wheel's axle", facts: "0.3 kg and 0.2 kg · a = 1.96 m/s²", edit: []
	}))

	// --- pulley lift: a falling weight lifts a pail
	const LIFT_T = 0.003 // the pail's 3 mm sheet and wire; the bail's arch is this many straight pieces
	const LIFT_ARCH = 7
	const LIFT_GAP = 0.0025 // m: between two pieces of the pail that are not welded to each other (see build_lift)

	/** The pail's pieces in its floor's frame (origin = the floor's middle): the floor, the two walls (slabs seen from the side: the pail is round, as deep as it is wide), and the
	 *  bail, a semicircle of 3 mm wire through the two ears at the rim, cut into LIFT_ARCH convex pieces (each [outer start, inner start, inner end, outer end], counter-clockwise).
	 *  Each piece stops LIFT_GAP / 2 short of its neighbour (measured on the inner edge) and its end pieces stand LIFT_GAP over the walls' tops: the pieces are each welded to
	 *  the pail's root, not to one another, and the engine then let welded pieces that were not joined directly collide, so pieces that touched pushed each other apart every
	 *  step and the pail flew to bits (a weld group is now one rigid body; web/models/mechanisms-pulleys.js draws the wire whole over the gaps). (math.asin is V8's here.) */
	function lift_parts(Wc, Hc) {
		const t = LIFT_T
		const cy = t / 2 + Hc // the rim's height: the arch's centre
		const ro = Wc / 2
		const ri = Wc / 2 - t
		const trim = LIFT_GAP / 2 / ri
		const end = Math.asin(LIFT_GAP / ri)
		const pieces = []
		for (let k = 0; k < LIFT_ARCH; k++) {
			const a0 = Math.PI * (1 - k / LIFT_ARCH) - (k ? trim : end)
			const a1 = Math.PI * (1 - (k + 1) / LIFT_ARCH) + (k < LIFT_ARCH - 1 ? trim : end)
			const quad = [
				[ro * cos(a0), cy + ro * sin(a0)], [ri * cos(a0), cy + ri * sin(a0)],
				[ri * cos(a1), cy + ri * sin(a1)], [ro * cos(a1), cy + ro * sin(a1)]
			]
			pieces.push(quad.map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)]))
		}
		const vol = Wc * t * Wc + 2 * t * Hc * Wc + pySum(pieces.map((q) => _area(q) * t))
		return [pieces, vol]
	}

	function build_lift(c, P) {
		const m = P.weight
		const drop = P.drop
		const Wc = P.cup_width
		const Hc = P.cup_height
		const t = LIFT_T
		const sw = _cube(m, P.material)
		const gap = Wc / 2 + sw / 2 + 0.04
		const dd = 2 * gap
		const wr = pymin(0.03, gap - 0.004)
		_rig(c, dd, wr)
		// the two wheels are solid: what falls or rolls onto one bangs into it. The view draws each wheel from the joint (wr in radius, inboard of its rope run by its
		// 4 mm smaller rope radius), so these discs of that size are left out of the picture
		const R = wr - 0.0005
		const wx = gap - wr + 0.004
		;[-1, 1].forEach((sx, n) => {
			c.ball(`wheel${n + 1}`, R, sx * wx, 0.0, { kind: "static", material: _steel(c), look: "steel", words: "a pulley wheel", hidden_3d: true })
		})
		const alu = hasOwn(MATERIALS, "aluminium") ? "aluminium" : "steel"
		// the pail weighs what the old square cup did at the default size (0.17 kg of thin aluminium): the aluminium's density is set so that its round shape does, and a bigger
		// pail then weighs more with its area. A thin spun pail lands dead (its floor flexes and rings, as a drink can's does: e 0.27), where solid aluminium (0.85) let a pail
		// that fell onto the table bounce a hand high and topple: bounce 0.3, provisional
		const [pieces] = lift_parts(Wc, Hc)
		const [, vol0] = lift_parts(0.08, 0.07)
		const old0 = 0.04 * (0.08 * t + 2 * t * 0.07 + 2 * t * 0.10 + 0.08 * 0.004)
		const cup = c.mat({ base: alu, density: pyRound(div(MATERIALS[alu].density * old0, vol0), 2), overrides: { bounce: 0.3 } })
		// what is hauled right up to its wheel (the lighter side) jams there, JAM_GAP under the rim where it comes nearest it: the weight by its flat top, the pail by its
		// bail's round wire (its crown, where the rope is tied, is then (ro + R + JAM_GAP) from the wheel's axle across their two centres, less ro). There each run's
		// rope end stops in its pulley (the joint's minLengthA/minLengthB), so the side that hauls it stops with it and hangs on the rope
		const ro = Wc / 2
		const runs = [pyRound(_jam_run(-wx, R, -gap - sw / 2, -gap + sw / 2), 5), pyRound(msqrt(pow(ro + R + JAM_GAP, 2) - pow(gap - wx, 2)) - ro, 5)]
		c.slab("weight", sw, sw, sw, -gap, -drop - sw / 2, { words: "the falling weight" })
		// the pail hangs by its bail from the rope, which is made fast at the top of the arch, `drop` below the pulley. Its pieces are welded to its heaviest part, which
		// carries the rope: the floor, or a wall of a pail taller than 4/3 of its width (the engine's welds once gave under a load hung from a light part far from its
		// middle; a weld group is now one rigid body, so this only says which part the rope is tied to)
		const fy = -drop - t / 2 - Hc - Wc / 2
		const xw = Wc / 2 - t / 2 // the walls' middles in the floor's frame
		const yw = t / 2 + Hc / 2
		const crown_y = t / 2 + Hc + Wc / 2 // the rope's tie, in the floor's frame
		let root
		let ox
		let oy
		if (Wc >= 0.75 * Hc) {
			;[root, ox, oy] = ["floor", 0.0, 0.0] // (where the floor's middle is in the root's frame)
			c.slab("floor", Wc, t, Wc, gap, fy, { material: cup, look: alu, words: "the floor of a pail" })
		} else {
			;[root, ox, oy] = ["wall1", xw, -yw]
			c.slab("wall1", t, Hc, Wc, gap - xw, fy + yw, { material: cup, look: alu, words: "a wall of the pail" })
		}
		const rid = `${c.item.id}/${root}`
		if (root !== "floor") _child(c, "floor", rid, Wc, t, Wc, ox, oy, cup, "the floor of a pail", alu)
		;[-1, 1].forEach((sx, n) => {
			if (`wall${n + 1}` !== root) _child(c, `wall${n + 1}`, rid, t, Hc, Wc, ox + sx * xw, oy + yw, cup, "a wall of the pail", alu)
		})
		pieces.forEach((q, n) => {
			// (each piece's own origin is the floor's middle, as its points are, wherever the root is: web/models/mechanisms-pulleys.js draws it about that origin)
			_child_poly(c, `bail${n + 1}`, root, q, t, cup, "a piece of the pail's wire bail", alu)
			c.sb.solids[c.sb.solids.length - 1].at = { x: pyRound(ox, 5), y: pyRound(oy, 5) }
		})
		_joint(c, "pulley", "rope", {
			a: "weight", b: root, groundA: [-gap, 0], groundB: [gap, 0], anchorA: [0, sw / 2], anchorB: [ox, oy + crown_y], ratio: 1.0, wheelRadius: pyRound(wr, 4),
			minLengthA: runs[0], minLengthB: runs[1]
		})
	}
	register(new ItemType("pulley-lift", "Pulley lift", "Springs & ropes", build_lift, {
		material: wm, materials: _has(wm, "steel", "aluminium", "brick"),
		props: [
			new Prop("weight", "Falling weight", 0.3, 0.05, 3.0, 0.01, "kg"), new Prop("cup_width", "Pail width", 0.08, 0.04, 0.3, 0.005, "m", "Across the pail; it is round, so it is as deep as it is wide"),
			new Prop("cup_height", "Pail height", 0.07, 0.03, 0.3, 0.005, "m"),
			new Prop("drop", "Rope below the pulley", 0.5, 0.2, 2.0, 0.01, "m", "From the pulley to the top of the weight at the start")
		],
		tags: ["hoist", "crane", "elevator", "lift", "winch", "counterweight", "bucket", "well", "pulley", "raise"],
		description: "A heavy weight on one side of a pulley, a light aluminium pail on the other: the weight falls and the pail rises, carrying what is in it.",
		source: "A weightless rope over an ideal pulley (as for an Atwood machine); the pail is round, of 3 mm aluminium, 2700 kg/m³ (weighed like the thin cup it replaces), with a wire bail.",
		anchor: "the middle of the pulley, between its two wheels", facts: "0.3 kg weight lifts a 0.17 kg pail", edit: []
	}))
}

// ---------------------------------------------------------------- vehicles
// A vehicle's body is built from convex polygons (true side outlines), welded: `hull` returns them as a list of part specs
//   {part, pts: [(x, y), ...] in the chassis frame (origin = the body's middle) or null for the plain slab Lc x hh, depth, share, base, words}
// the first is the chassis; "share" (a fraction of the body weight) and "base" (a material) give a part its own material (a skateboard's aluminium trucks),
// every other part shares one density, chosen so the whole body weighs exactly `body_mass` (the volume is split by area x depth).
/** A body on two sprung (or rigid, hz = 0) wheels. Its anchor is the ground under the middle, where the wheels touch.
 *  The wheels' 3D track is the body's depth less `tuck` each side plus `wheel_w` (x the wheel radius) each side (web/models/vehicles.js reads the same numbers). */
function _vehicle(key, name, o) {
	const { L, h, d, mass, r, wheel_mass, axle, clear, hz, wheel_mat, wheel_mats, body_mat, body_look, hull, wheel_w, tuck, drive = null, tags, description, source, facts } = o
	function build(c, P) {
		const Lc = P.length
		const r_ = P.wheel_diameter / 2
		const m = P.body_mass
		let hz_ = P.suspension
		hz_ = hz_ <= 0 ? 0.0 : pymax(hz_, 2.0)
		const s = Lc / L
		const sag = truthy(hz_) ? G / pow(2 * Math.PI * hz_, 2) : 0.0 // how far the body settles on its springs
		const lift = pymax(clear * r_, sag + 0.008) // the body's underside clears the ground, and its top the wheels, by more than that
		const hh = pymax(pymax(h * s, 2 * r_ + sag + 0.004 - lift), 0.01)
		const dd = d * s
		const ax = axle * s
		let yc = lift + hh / 2
		const parts = hull({ Lc, hh, dd, r: r_, ax, yc, s, lift, sag })
		yc = hasOwn(parts[0], "yc") ? parts[0].yc : yc // a hull may stand its chassis somewhere else (a cart's thin deck above the wheels)
		const vol = (p) => (p.pts === null ? Lc * hh : _area(p.pts)) * p.depth
		const fixed = pySum(parts.filter((p) => truthy(p.share)).map((p) => p.share * m))
		const dens = div(m - fixed, pySum(parts.filter((p) => !truthy(p.share)).map(vol)))
		const body = c.mat({ base: body_mat, density: pyRound(dens, 3), overrides: {} })
		let chassis = null
		for (const p of parts) {
			let material = body
			let look = truthy(p.look) ? p.look : body_look
			if (truthy(p.share)) {
				material = c.mat({ base: p.base, density: pyRound(div(p.share * m, vol(p)), 3), overrides: {} })
				look = hasOwn(p, "look") ? p.look : null
			}
			const words = truthy(p.words) ? p.words : `a ${pyLower(name)}'s body`
			if (chassis === null) {
				chassis = p.pts === null
					? c.slab("chassis", Lc, hh, p.depth, 0, yc, { material, look, words })
					: c.poly("chassis", p.pts, p.depth, 0, yc, { material, look, words })
			} else _child_poly(c, p.part, chassis, p.pts, p.depth, material, words, look)
		}
		// where the body's weight rests: the engine gives each wheel an equal share of it, so a body whose centre of mass is off the axles' middle (a cab-over truck's cab)
		// would sit nose-down. Each wheel's frequency is that of the load it really carries (k = share x m x (2 pi hz)^2 on both axles, so both sag by the same g/(2 pi hz)^2:
		// the body sits level) and its damping ratio is scaled with it, so the real ratio stays the same.
		let moment = 0.0
		let mass_sum = 0.0
		for (const p of parts) {
			const v = vol(p)
			const mp = truthy(p.share) ? p.share * m : dens * v
			moment += mp * (p.pts === null ? 0.0 : _centroid_x(p.pts))
			mass_sum += mp
		}
		const xcom = truthy(mass_sum) ? div(moment, mass_sum) : 0.0
		const wmass = wheel_mass * pow(r_ / r, 3)
		const wheel_density = pyRound(wmass / ((4 / 3) * Math.PI * pow(r_, 3)), 3)
		const wmat = c.mat({ density: wheel_density })
		let motor = null
		if (truthy(drive)) motor = { speed: pyRound(-P.speed / r_, 4), torque: pyRound(P.push * r_ / 2, 5) }
		const track = pyRound(tuck === null ? dd - 0.002 : dd - 2 * tuck + 2 * wheel_w * r_, 5) // front to back across both wheels and the axle: only the 3D look (tuck None: the tyres' outer faces 1 mm inside the body's sides)
		for (const [part, sx] of [["front", 1], ["rear", -1]]) {
			c.ball(part, r_, sx * ax, r_, { material: wmat, inertia: 0.5, shape: "cylinder", length: pyRound(dd + 0.02, 4), depth3d: track, words: `a ${pyLower(name)}'s wheel` })
			const share = pymin(0.85, pymax(0.15, div(ax + sx * xcom, 2 * ax))) // the fraction of the body's weight on this axle
			const k_ = truthy(hz_) ? Math.sqrt(2 * share) : 1.0
			const f = { chassis: "chassis", wheel: part, anchor: [sx * ax, r_ - yc], axis: { x: 0.0, y: 1.0 }, frequency: pyRound(hz_ * k_, 4), damping: pyRound(0.7 * k_, 4) }
			if (motor) f.motor = { ...motor } // (a copy for each wheel: Python's two joints share one dict, which only the JSON of it can tell from two)
			_joint(c, "wheel", `axle-${part}`, f)
		}
	}
	const props = [
		new Prop("length", "Body length", L, pyRound(L / 2, 3), pyRound(L * 2.5, 3), 0.005, "m"), new Prop("wheel_diameter", "Wheel diameter", 2 * r, pyRound(r, 3), pyRound(4 * r, 3), 0.002, "m"),
		new Prop("body_mass", "Body weight", mass, pyRound(mass / 5, 4), pyRound(mass * 6, 3), 0.005, "kg", "The body with its cabin, without the wheels"),
		new Prop("suspension", "Suspension", hz, 0.0, 20.0, 0.5, "Hz", "How fast the body bounces on its springs (2 or more); 0 is rigid axles")
	]
	if (truthy(drive)) {
		props.push(
			new Prop("speed", "Top speed", drive[0], 0.1, 10.0, 0.1, "m/s", "The speed the wheels drive up to"),
			new Prop("push", "Push", drive[1], 0.1, 50.0, 0.1, "N", "The most force the wheels give; it spins its wheels if the ground can't hold it")
		)
	}
	register(new ItemType(key, name, "Wheels & vehicles", build, {
		material: wheel_mat, materials: wheel_mats, props, tags, description, source,
		anchor: "the ground under its middle, where the wheels touch", facts, edit: [{ kind: "length", prop: "length" }, { kind: "rotate" }]
	}))
}

function _hull_slab({ dd }) {
	return [{ part: "chassis", pts: null, depth: dd }]
}

/** A body of two convex pieces: a lower body (points as fractions u = x / length, v = y / height of the body's box, -0.5 .. 0.5) and a cab
 *  standing on its flat top (v = 0.5), with `cab` = (points as fractions of the length, height as a fraction of the body's height, depth as a fraction of its depth). */
function _hull_cab(low, cab) {
	const [cab_pts, ch, cd] = cab
	return function hull({ Lc, hh, dd }) {
		const lower = low.map(([u, v]) => [pyRound(u * Lc, 5), pyRound(v * hh, 5)])
		const upper = cab_pts.map(([u, w]) => [pyRound(u * Lc, 5), pyRound((0.5 + w * ch) * hh, 5)])
		return [{ part: "chassis", pts: lower, depth: dd }, { part: "cabin", pts: upper, depth: pyRound(cd * dd, 5), words: "a cabin" }]
	}
}

/** A wagon's bed: one plank deck `thick` metres thick whose underside rides `gap` over the wheels' tops (rigid axles need no more): nothing is under it
 *  but the axle-trees, which are drawn inside the wheels' side-view discs (as a skateboard's hangers are). The chassis stands where the deck is (`yc`). */
function _hull_deck(thick, gap = 0.002) {
	return function hull({ Lc, dd, r }) {
		const y0 = 2 * r + gap
		const t = thick
		return [{ part: "chassis", pts: [[-Lc / 2, -t / 2], [Lc / 2, -t / 2], [Lc / 2, t / 2], [-Lc / 2, t / 2]], depth: dd, yc: y0 + t / 2, words: "the wagon's bed" }]
	}
}

/** A cab-over flatbed: a frame-and-deck slab `slab` metres thick (its top where a solid body's top would be), the cab on it, and two welded blocks for the cab's
 *  lower front, one ahead of the front wheel and one behind it, each stopping `gap` short of the wheel (a welded part collides with the wheels) and reaching down to
 *  the old body's underside: the front wheel stands in an arch between them. Everything else under the deck is open, so a ball can roll under it. */
function _hull_flatbed(slab, cab, gap = 0.0035) {
	const [cab_pts, ch, cd] = cab
	return function hull({ Lc, hh, dd, r, ax, lift, s, sag }) {
		const t = slab * s
		const top = pymax(lift + hh, 2 * r + sag + 0.016) // the cab (a welded part: it collides with the wheels) rides 12 mm over the loaded wheels' tops, for the nose to dive on a slope
		const yc = top - t / 2
		const out = [
			{ part: "chassis", pts: [[-Lc / 2, -t / 2], [Lc / 2, -t / 2], [Lc / 2, t / 2], [-Lc / 2, t / 2]], depth: dd, yc, words: "the frame and deck" },
			{ part: "cabin", pts: cab_pts.map(([u, w]) => [pyRound(u * Lc, 5), pyRound(t / 2 + w * ch * hh, 5)]), depth: pyRound(cd * dd, 5), words: "a cabin" }
		]
		const back = minOf(cab_pts.map(([u]) => u)) * Lc
		// the skirt ends about at hub height once the body has settled: the apron and the step reach down to 0.8 r over the table at rest (0.8 r + sag at the start), never lower than the old
		// body's underside (lift) and never closer than 12 mm to the deck's underside; their bottoms in the chassis frame
		const bottom = pymax(lift, pymin(0.8 * r + sag, top - t - 0.012)) - yc
		for (const [part, x0, x1, words] of [["apron", ax + r + gap, Lc / 2, "the lower front of the cab"], ["step", back, ax - r - gap, "the lower back of the cab"]]) {
			if (x1 - x0 > 0.006 && (-t / 2 - bottom) > 0.006) {
				const pts = part === "apron" ? [[x0, bottom], [x1 - 0.006, bottom], [x1, bottom + 0.006], [x1, -t / 2], [x0, -t / 2]] : [[x0, bottom], [x1, bottom], [x1, -t / 2], [x0, -t / 2]]
				out.push({ part, pts: pts.map(([a, b]) => [pyRound(a, 5), pyRound(b, 5)]), depth: dd, words })
			}
		}
		return out
	}
}

/** A skateboard: a flat middle (a polygon), a kicktail at each end (a parallelogram rising at kick_deg over kick_len x the board's length), and an
 *  aluminium truck over each axle: a trapezoid from the deck down to just over the wheels (baseplate and bushings; the hanger and axle below it are drawn inside the wheels' outlines), a fifth of the body weight each. */
function _hull_board(kick_deg, kick_len, flat) {
	const tan = Math.tan(kick_deg * D2R) // math.tan(math.radians(kick_deg))
	return function hull({ Lc, hh, dd, r, ax, yc, s }) {
		const a = flat * Lc
		const Lk = kick_len * Lc
		const t = hh
		const mid = [[-a, -t / 2], [a, -t / 2], [a, t / 2], [-a, t / 2]]
		const xe = a + Lk
		const out = [{ part: "chassis", pts: mid.map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)]), depth: dd, words: "the deck" }]
		for (const [sx, name] of [[1, "nose"], [-1, "tail"]]) {
			let k = [[a, -t / 2], [xe, -t / 2 + Lk * tan], [xe, t / 2 + Lk * tan], [a, t / 2]]
			k = k.map(([x, y]) => [pyRound(sx * x, 5), pyRound(y, 5)])
			out.push({ part: name, pts: sx > 0 ? k : [...k].reverse(), depth: dd, words: `the deck's ${name}` })
		}
		const hw = 0.0475 * pymin(1.0, s)
		const bottom = 2 * r + 0.0035 - yc // the solid truck stops 3.5 mm over the wheels' tops (a welded part collides with them); the hanger below is only drawn
		for (const [sx, name] of [[1, "truck1"], [-1, "truck2"]]) {
			const x = sx * ax
			const tr = [[x - 0.02 * pymin(1.0, s), bottom], [x + 0.02 * pymin(1.0, s), bottom], [x + hw, -t / 2], [x - hw, -t / 2]]
			out.push({
				part: name, pts: tr.map(([px, py]) => [pyRound(px, 5), pyRound(py, 5)]), depth: 0.136 * pymin(1.0, 0.5 + s / 2), share: 0.18,
				base: hasOwn(MATERIALS, "aluminium") ? "aluminium" : "steel", words: "a skateboard truck"
			})
		}
		return out
	}
}

function _vehicles() {
	const tyre = "tyre rubber"
	const urethane = "urethane"
	const dark = hasOwn(MATERIALS, "dark wood") ? "dark wood" : "varnished hardwood"
	const plastic_wheels = _has("tyre rubber", "bicycle tyre", "solid rubber", "hollow plastic", "varnished hardwood")
	// a die-cast hatchback at about 1:19 (a 3.8 m car is 20 cm): 34 mm wheels, a wheelbase of 126 mm with a short overhang at each end, 12 mm of ground clearance, a belt line
	// 48 mm up and a roof 74 mm up; the hood and the tail slope away from a bubble cabin. The body's side outline is two convex polygons (a lower body and a cabin).
	const hatch = _hull_cab([[-0.45, -0.5], [0.45, -0.5], [0.5, -0.34], [0.5, 0.10], [0.22, 0.5], [-0.30, 0.5], [-0.5, 0.30], [-0.5, -0.34]],
		[[[-0.29, 0.0], [0.20, 0.0], [0.075, 1.0], [-0.19, 1.0]], 0.72, 0.9])
	// a low sports coupe: a longer, lower hood, a fastback cab; 32 mm wheels, a roof 60 mm up (length / height 3.3)
	const coupe = _hull_cab([[-0.47, -0.5], [0.47, -0.5], [0.5, -0.25], [0.5, 0.05], [0.15, 0.5], [-0.36, 0.5], [-0.5, 0.25], [-0.5, -0.30]],
		[[[-0.36, 0.0], [0.12, 0.0], [-0.03, 1.0], [-0.18, 1.0]], 0.62, 0.9]) // the fastback starts where the body's flat top ends (-0.36)
	_vehicle("toy-car", "Toy car", {
		L: 0.2, h: 0.036, d: 0.08, mass: 0.3, r: 0.017, wheel_mass: 0.011, axle: 0.063, clear: 0.5, hz: 8.0, wheel_mat: tyre, wheel_mats: plastic_wheels,
		body_mat: "hollow plastic", body_look: "plastic", hull: hatch, wheel_w: 0.53, tuck: null,
		tags: ["car", "vehicle", "roller", "model car", "toy", "drive", "ramp", "wheels", "suspension", "matchbox", "hot wheels"],
		description: "A toy car: a body on two sprung wheels. Put it on a ramp and it rolls down; the wheels turn and the body bobs on its springs.",
		source: "Sprung wheels: a body of mass m on springs of frequency f sags g/(2πf)². A 20 cm die-cast toy at about 1:19 (34 mm wheels, 126 mm wheelbase); sizes, weights and the 0.012 rolling resistance of rubber tyres are provisional.",
		facts: "20 cm · 0.3 kg body · 3.4 cm wheels"
	})
	_vehicle("motor-car", "Motor car", {
		L: 0.2, h: 0.03, d: 0.08, mass: 0.3, r: 0.016, wheel_mass: 0.0091, axle: 0.064, clear: 0.5, hz: 8.0, wheel_mat: tyre, wheel_mats: plastic_wheels,
		body_mat: "hollow plastic", body_look: "plastic", hull: coupe, wheel_w: 0.53, tuck: null, drive: [1.5, 2.0],
		tags: ["car", "motor", "electric", "drive", "powered", "rc", "engine", "robot", "vehicle", "self propelled", "wheel motor"],
		description: "A toy sports car with motors on both axles. It speeds up to its top speed (to the right when level) and pushes with up to its set force.",
		source: "Motors drive each wheel toward a set turning speed within a torque limit (wheel torque = push × radius / 2); the car's size and weight are provisional (a 20 cm, 6 cm tall coupe on 32 mm wheels). It can't push harder than the ground's grip, friction × its weight.",
		facts: "1.5 m/s top speed · pushes 2 N · 3.2 cm wheels"
	})
	// a wooden wagon: a thin plank bed (12 mm) 2 mm over the wheels' tops, on axle-trees; the wheels stand outside the bed (8 mm clear of its sides, a hub's length)
	_vehicle("cart", "Cart", {
		L: 0.22, h: 0.012, d: 0.08, mass: 0.2, r: 0.025, wheel_mass: 0.03, axle: 0.075, clear: 0.5, hz: 0.0, wheel_mat: dark, wheel_mats: _has("dark wood", "varnished hardwood", "steel", "tyre rubber"),
		body_mat: "varnished hardwood", body_look: "wood", hull: _hull_deck(0.012, 0.002), wheel_w: 0.3, tuck: -0.008,
		tags: ["trolley", "wagon", "dynamics cart", "lab cart", "wheeled", "track", "carry", "flatbed", "load", "wheelbarrow"],
		description: "A flat wooden cart on two rigid axles: it rolls freely and carries what is put on it.",
		source: "A teaching-lab dynamics cart is a few hundred grams and about 20 cm long (provisional); wooden wheels on wood roll with about 0.004 (provisional).",
		facts: "22 cm · 0.2 kg bed · 5 cm wheels"
	})
	_vehicle("skateboard", "Skateboard", {
		L: 0.8, h: 0.015, d: 0.2, mass: 2.5, r: 0.027, wheel_mass: 0.34, axle: 0.19, clear: 2.9, hz: 0.0, wheel_mat: urethane, wheel_mats: _has("urethane", "tyre rubber"),
		body_mat: "varnished hardwood", body_look: "wood", hull: _hull_board(17.0, 0.2, 0.3), wheel_w: 1.18, tuck: 0.032,
		tags: ["board", "skate", "deck", "trucks", "ride", "street", "park", "wheels", "longboard", "roll"],
		description: "A skateboard deck on two trucks with hard urethane wheels. It rolls a long way on a smooth floor.",
		source: "A deck is about 20 cm wide and 80 cm long, 7-ply maple about 12 mm thick plus its grip tape and raised concave rails (15 mm in all), with kicktails of about 17° at each end; the wheels are 52-54 mm and a complete board weighs about 3 kg (typical sizes). Weights split between deck, trucks and wheels (a fifth of the 2.5 kg body in each aluminium truck), and the rolling resistance, are provisional.",
		facts: "80 cm deck · 5.4 cm wheels · about 3 kg"
	})
	const cabover = _hull_flatbed(0.035, [[[0.18, 0.0], [0.5, 0.0], [0.485, 0.86], [0.45, 1.0], [0.24, 1.0], [0.185, 0.9]], 1.2, 1.0]) // the cab's face is flush with the nose (x = L/2): one flat front from the bumper to the roof
	_vehicle("truck", "Truck", {
		L: 0.5, h: 0.08, d: 0.2, mass: 2.0, r: 0.05, wheel_mass: 0.35, axle: 0.17, clear: 0.6, hz: 4.0, wheel_mat: tyre, wheel_mats: plastic_wheels,
		body_mat: "hollow plastic", body_look: "plastic", hull: cabover, wheel_w: 0.56, tuck: null,
		tags: ["lorry", "pickup", "van", "heavy", "vehicle", "toy truck", "big", "wheels", "suspension", "dump"],
		description: "A big heavy toy truck with a cab and soft springs. It takes a lot more to stop than a toy car.",
		source: "A 50 cm, 2 kg toy truck (provisional): a 35 mm frame-and-deck slab with the cab on it, open underneath between the axles; rubber tyres with a rolling resistance of 0.012 (handbook range 0.010-0.015).",
		facts: "50 cm · 2 kg body · 10 cm wheels"
	})
}

// ---------------------------------------------------------------- wheels
function _wheels() {
	// --- a rolling disc
	function build_wheel(c, P) {
		const r = P.diameter / 2
		const t = P.thickness
		const rho = MATERIALS[P.material].density
		c.ball("wheel", r, 0.0, 0.0, { material: c.mat({ density: pyRound((rho * 3 * t) / (4 * r), 4) }), inertia: 0.5, shape: "cylinder", length: t, depth3d: t, words: "a solid wheel" })
	}
	register(new ItemType("wheel", "Wheel", "Wheels & vehicles", build_wheel, {
		material: "varnished hardwood", materials: _has("varnished hardwood", "steel", "solid rubber", "aluminium", "dark wood", "concrete"),
		props: [new Prop("diameter", "Diameter", 0.2, 0.03, 1.0, 0.005, "m"), new Prop("thickness", "Thickness", 0.03, 0.005, 0.3, 0.005, "m", "Front to back: only the 3D look and the weight")],
		tags: ["disc", "roller", "tyre", "cylinder", "rolling", "spin", "round", "gear", "flywheel", "hoop"],
		description: "A solid disc that rolls: its inertia is ½mr², so down a slope it gains speed at ⅔ of g sin θ (a ball does 5⁄7).",
		source: "A solid disc: moment of inertia ½mr²; rolling down a slope a = g sin θ / (1 + ½) (textbook). Wood about 700 kg/m³.",
		anchor: "its centre", facts: "20 cm · 3 cm thick · ½mr² inertia", edit: [{ kind: "radius", prop: "diameter" }]
	}))

	// --- a bicycle wheel: most of the mass in the rim
	function build_bike(c, P) {
		const r = P.diameter / 2
		const t = 0.03
		c.ball("wheel", r, 0.0, 0.0, {
			material: c.mat({ density: pyRound(P.mass / ((4 / 3) * Math.PI * pow(r, 3)), 4) }), inertia: P.inertia, shape: "cylinder", length: t, depth3d: 0.1, words: "a bicycle wheel"
		}) // 3D: a 3 cm tyre on a 10 cm hub
	}
	register(new ItemType("bicycle-wheel", "Bicycle wheel", "Wheels & vehicles", build_bike, {
		material: "bicycle tyre", materials: _has("bicycle tyre", "tyre rubber"),
		props: [
			new Prop("diameter", "Diameter", 0.68, 0.3, 0.9, 0.01, "m"), new Prop("mass", "Weight", 1.3, 0.3, 4.0, 0.05, "kg", "Rim, spokes, tyre and tube"),
			new Prop("inertia", "Inertia", 0.85, 0.5, 1.0, 0.01, "of m·r²", "1 is a hoop with all the mass at the rim, ½ a solid disc")
		],
		tags: ["bike", "cycle", "hoop", "rim", "spokes", "tyre", "rolling", "flywheel", "gyroscope", "road bike"],
		description: "A bicycle wheel: nearly all its mass is in the rim and tyre, so its inertia is close to a hoop's (mr²) and it rolls down a slope slower than a disc.",
		source: "A road wheel is 622 mm rim plus a 25-28 mm tyre, about 0.68 m across (ISO 5775); wheel, tyre and tube weigh about 1.3 kg and the inertia is about 0.85 mr² (both provisional).",
		anchor: "its centre", facts: "68 cm · 1.3 kg · 0.85 mr² inertia", edit: [{ kind: "radius", prop: "diameter" }]
	}))
}

// ---------------------------------------------------------------- motors and belts
function _motors() {
	// --- motor spinner
	function build_spinner(c, P) {
		const L = P.length
		const d = P.depth
		// the paddle is keyed on the shaft of a gear motor that stands behind it: the shaft is a static hub (6 mm, always inside the 2 cm paddle, so nothing else
		// can reach it) that carries the driven hinge, and the view stands the hub on a retort stand behind the paddle (a bracket from the wall when it is over
		// 1.3 m up). web/models/mechanisms.js draws the shaft's nut on the paddle's front, the motor behind it and the stand's arm into the motor's back: the
		// hub is drawn as deep as that (MOTOR_BACK behind the paddle's back face, as much again in front, where only the nut is)
		if (c.kind === "dynamic") {
			const high = c.world(0, -0.006)[1] > 1.3
			c.ball("hub", 0.006, 0, 0, { kind: "static", material: _steel(c), look: "steel", words: "the motor's shaft", depth3d: pyRound(d + 2 * MOTOR_BACK, 5), stand: high ? "wall" : "post" })
			// (the paddle also names its pivot on the hub, as every hinged part does, so a run's summary says how far it turned; the driven hinge is the pin joint,
			// and neither is drawn as a generic hinge: the model draws the motor)
			const hub = c.sb.solids[c.sb.solids.length - 1].id
			c.slab("paddle", L, 0.02, d, 0, 0, { words: "a motor-driven paddle", pivot: { x: 0.0, y: 0.0 }, parent: hub })
			const paddle = c.sb.solids[c.sb.solids.length - 1]
			paddle.at = { x: 0.0, y: 0.0 } // (a part with a parent stands in its parent's frame)
			delete paddle.angle
			_joint(c, "pin", "hinge", { a: "hub", b: "paddle", anchorA: [0, 0], anchorB: [0, 0], motor: { speed: pyRound((P.rpm * TAU) / 60, 5), torque: P.torque }, render: { hinge: "none" } })
		} else {
			// fixed, it is a plank held up on a stand of its own
			c.slab("paddle", L, 0.02, d, 0, 0, { words: "a paddle", stand: c.world(0, -0.01)[1] > 1.3 ? "wall" : "post" })
		}
	}
	register(new ItemType("motor-spinner", "Motor spinner", "Motors & belts", build_spinner, {
		material: "varnished hardwood", materials: _has("varnished hardwood", "aluminium", "steel"),
		props: [
			new Prop("length", "Paddle length", 0.4, 0.1, 1.5, 0.01, "m"), new Prop("depth", "Front to back", 0.1, 0.02, 0.6, 0.01, "m", "Only for the 3D look and the weight"),
			new Prop("rpm", "Speed", 60.0, -300.0, 300.0, 1.0, "turns/min", "Positive turns it counter-clockwise"),
			new Prop("torque", "Motor strength", 2.0, 0.05, 50.0, 0.05, "N·m", "The most turning force; a stuck paddle stalls")
		],
		tags: ["propeller", "rotor", "arm", "sweeper", "paddle wheel", "windmill", "turntable", "fan blade", "rotate", "motor"],
		description: "A paddle on the shaft of a gear motor (on a stand behind it): it turns at a steady speed and sweeps anything in its way, unless it is too strong to turn.",
		source: "A motor holds its turning speed up to its torque limit, then slows (stalls). Sizes and strengths are provisional.",
		anchor: "the motor's shaft, at the paddle's middle", facts: "40 cm paddle · 60 turns/min", edit: [{ kind: "length", prop: "length" }, { kind: "rotate" }]
	}))

	// --- conveyor belt
	function build_belt(c, P) {
		const L = P.length
		const t = 0.04
		const d = P.depth
		c.slab("belt", L - t, t, d, 0, -t / 2, { kind: "static", words: "a conveyor belt", look: "belt", material: c.mat(), surfaceSpeed: P.speed, legs: truthy(P.legs) })
		const steel = c.mat({ base: "steel", overrides: {} })
		;[-1, 1].forEach((sx, n) => {
			c.ball(`roller${n + 1}`, t / 2, sx * (L - t) / 2, -t / 2, { kind: "static", material: steel, shape: "cylinder", length: d, look: "steel", words: "a belt roller" })
		})
	}
	register(new ItemType("conveyor-belt", "Conveyor belt", "Motors & belts", build_belt, {
		dynamic: false, material: "conveyor belt", materials: _has("conveyor belt", "rubber mat", "carpet"),
		props: [
			new Prop("length", "Length", 1.0, 0.2, 3.0, 0.01, "m"), new Prop("depth", "Width (front to back)", 0.3, 0.05, 1.0, 0.01, "m", "Only for the 3D look and the weight"),
			new Prop("speed", "Belt speed", 1.0, -5.0, 5.0, 0.05, "m/s", "How fast the top runs to the right; negative runs it to the left (turn the item to tilt it)"),
			new Prop("legs", "Legs under it (3D)", true, { kind: "bool" })
		],
		tags: ["belt", "treadmill", "luggage", "assembly line", "transport", "carry", "factory", "moving floor", "airport", "rollers"],
		description: "A belt whose top runs along it at a set speed: things on it are carried along, a block at the belt's speed and a ball a good deal slower to begin with.",
		source: "Package conveyors run at 0.2-2 m/s (typical); a block rides at the belt's speed, a rolling ball only reaches 2/7 of it before rolling resistance speeds it on (a solid ball dropped on a moving surface; textbook).",
		anchor: "the middle of its top surface", facts: "1 m · runs 1 m/s to the right", edit: [{ kind: "length", prop: "length" }, { kind: "rotate" }]
	}))

	// --- pinball flipper
	function build_flipper(c, P) {
		const L = P.length
		const t = 0.022
		const a0 = P.rest_angle
		const sw = P.sweep
		const a = a0 * D2R
		const piv = 0.014
		const steel = c.mat({ base: "steel", overrides: {} })
		// the pivot is a 12 mm shoulder bolt through the bat's round hub: it must stay inside the hub's round end (11 mm), so a 6 mm radius post
		c.ball("post", 0.006, 0.0, 0.0, { kind: "static", material: steel, shape: "cylinder", look: "steel", depth3d: 0.044, words: "the post the flipper turns on" })
		const mid = L / 2 - piv
		// a tapered bat: a round hub at the pivot narrowing to a small rounded tip (an octagon). A real bat stands about 24 mm tall on the playfield (the ball is 27 mm):
		// a plastic bat and its shaft weigh about 40 g, so the plastic is given the density that makes it so
		const h = t / 2
		const tip = 0.136 * t
		const bat = [[-L / 2 + 0.0085, -h], [L / 2 - 0.008, -0.255 * t], [L / 2, -tip], [L / 2, tip], [L / 2 - 0.008, 0.255 * t], [-L / 2 + 0.0085, h], [-L / 2, 0.27 * t], [-L / 2, -0.27 * t]]
		const depth = 0.024
		const rho = pyRound(FLIPPER_MASS / (_area(bat) * depth), 1)
		c.poly("flipper", bat, depth, mid * cos(a), mid * sin(a), { langle: a0, words: "a pinball flipper", material: c.mat({ density: rho }) })
		const sgn = sw >= 0 ? 1 : -1
		_joint(c, "pin", "hinge", { // the flipper's own pivot is drawn, and its coil is under the playfield
			a: "post", b: "flipper", anchorA: [0, 0], anchorB: [-L / 2 + piv, 0], render: { hinge: "none" },
			motor: { speed: pyRound(sgn * P.speed * D2R, 4), torque: P.torque }, limits: { lower: pyRound(pymin(0.0, sw * D2R), 5), upper: pyRound(pymax(0.0, sw * D2R), 5) }
		})
	}
	register(new ItemType("pinball-flipper", "Pinball flipper", "Motors & belts", build_flipper, {
		material: "solid rubber", materials: _has("solid rubber", "varnished hardwood", "aluminium", "steel"),
		props: [
			new Prop("length", "Length", 0.078, 0.04, 0.6, 0.002, "m"), new Prop("rest_angle", "Rest angle", -30.0, -180.0, 180.0, 1.0, "°", "Which way it points when down: 0 is to the right, −30 a little below"),
			new Prop("sweep", "Flip", 60.0, -150.0, 150.0, 1.0, "°", "How far it turns at the release before its stop; negative turns it clockwise (for a flipper on the left)"),
			new Prop("speed", "Flip speed", 1200.0, 100.0, 3000.0, 50.0, "°/s"), new Prop("torque", "Motor strength", 0.5, 0.05, 20.0, 0.05, "N·m")
		],
		tags: ["arcade", "paddle", "kicker", "bat", "flip", "hit", "pinball machine", "strike", "hinge", "motor"],
		description: "A flipper on a motorized hinge with a stop: at the scene's release it flips up through its set angle at its set speed and hits whatever rests on it.",
		source: "A hinge driven by a motor to a set speed within a torque limit, stopped at a limit (revolute joint with motor and limits). A standard pinball flipper bat is 3 in (76-80 mm) long (flippers.be; makers' standard bats are 80 mm). Speed and strength are provisional.",
		anchor: "the hinge, at the flipper's base", facts: "7.8 cm · flips 60° at 1200°/s", edit: [{ kind: "rotate" }]
	}))
}
