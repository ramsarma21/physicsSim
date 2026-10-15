// Everyday objects: cans, bottles, books, fruit, coins, a pencil, a sneaker ... at their real sizes and weights. A port of
// machines/catalog_everyday.py, function for function, that runs in the browser and in node with the same numbers as the Python.
//
// web/sim/index.js registers it with use_catalog_module("catalog_everyday", register_all) after catalog_items, as machines/items.py
// imports its catalog modules at its end (CATALOG_MODULES order). register_all(g) gets items.js's FRAMEWORK (what items.py passes as
// globals()) and takes the names it NEEDS from it, as the Python does.
//
// Everything is built from the same few primitives as the rest of the catalog:
//   boxy things             one slab (Ctx.slab); things that stand are drawn standing, things that lie are drawn lying,
//   things that roll on     a round body with shape "cylinder" seen end-on (like the wooden log), inertia k m r²:
//   their side              k = 1/2 for a solid one, 1/2 (1 + (hole/D)²) for a hollow one (a roll, a tube), 1 for a thin shell,
//   round things            a ball (ball_type),
//   open containers         the cup's floor and two walls (static),
//   cones and pins          convex polygons welded together (Ctx.poly): the outline of the real thing seen from the side: a bowling pin's
//                           belly and neck and head, a cone's slope on its square base, a mug's C-shaped handle, a sneaker's heel and toe, a standing soda can's
//                           necked top, a taper candle's narrowing.
// An outline is drawn in millimetres on the real object's side view and cut into convex pieces (a polygon takes 3 to 8 points); each piece
// is one solid, welded to the first. The pieces share the item's weight by their volume (area x depth) unless the object is hollow and a
// heavy part is known (a traffic cone's rubber base), where the split is stated.
// An item's density is whatever makes it weigh its stated weight (as ball_type does for balls); a round body that is really a cylinder is
// given the density of the sphere with the same weight, because the engine weighs round bodies as spheres.
//
// Exactness (see pymath.js): Python's round() is pyRound, sum() of floats is pySum (Neumaier), math.hypot/dist are hypot, `a ** 3` is the
// engine's cube(), f"{x:.2f}" is fmtF, min/max of two numbers keep the first of equals (pymin/pymax), and division by a variable goes
// through div() so a zero raises ZeroDivisionError as Python does. Two things JavaScript cannot be made to do bit for bit, and why that
// shows nothing: `x ** 2` is x * x here (Python's libm pow(x, 2.0) differs from x * x in the last bit for about 1 in 800 arguments; it
// is used for a rolling thing's inertia, which is then round(k, 4), and for a threshold in _apart), and math.atan2 is V8's (the last bit
// differs from the platform libm's for about a fifth of arguments; a vessel's wall angle goes through round(angle, 6)). The harness
// (tools/parity/core.mjs --mode everyday) compares every type, built alone and in scenes, number against number.
//
// Depends on these materials of other modules, by exact name: varnished hardwood (items.js), cardboard, foam, glass (catalog_items).
import { D2R, ValueError, cos, cube, degrees, div, fmtF, hypot, maxOf, minOf, pyRound, pySum, pymax, pymin, sin, truthy } from "./pymath.js"

const NEEDED = ["register", "ItemType", "Prop", "ball_type", "MATERIALS", "add_look", "LOOK_FILL", "LOOK_SHADE", "CATEGORIES", "TYPES", "polygon_problem", "define_material"]
export const CAT = "Everyday objects"
export const KEYS = [] // the types this module registered
export const CLASHES = [] // of those, keys another module had already taken (this module would have replaced that type)
export const STATED = {} // type key -> [[props, kg]]: the weight the type says it has (the test checks the built weight against it)

// what items.py hands over as globals(): set by register_all (define_material is the JavaScript way to MATERIALS.setdefault: items.js keeps the
// materials' int/float marks beside the dict)
let register, ItemType, Prop, ball_type, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, CATEGORIES, TYPES, polygon_problem, define_material

export function register_all(g) {
	for (const k of NEEDED) if (!(k in g)) throw new Error(`'${k}'`) // (a KeyError in Python)
	;({ register, ItemType, Prop, ball_type, MATERIALS, add_look, LOOK_FILL, LOOK_SHADE, CATEGORIES, TYPES, polygon_problem, define_material } = g)
	KEYS.length = 0
	CLASHES.length = 0
	for (const k of Object.keys(STATED)) delete STATED[k]
	if (!CATEGORIES.includes(CAT)) CATEGORIES.push(CAT)
	_looks()
	_materials()
	_drinks()
	_boxes()
	_rollers()
	_fruit()
	_shapes()
	_containers()
}

// ---------------------------------------------------------------- helpers
const KeyError = (key) => new Error(`'${key}'`) // (the message of Python's KeyError, which the harness names by its quotes)
const lookFill = (look) => {
	if (!(look in LOOK_FILL)) throw KeyError(look)
	return LOOK_FILL[look]
}
const lookShade = (look) => {
	if (!(look in LOOK_SHADE)) throw KeyError(look)
	return LOOK_SHADE[look]
}
const rstrip = (s, chars) => {
	let e = s.length
	while (e > 0 && chars.includes(s[e - 1])) e--
	return s.slice(0, e)
}
const dist = (p, q) => hypot(p[0] - q[0], p[1] - q[1]) // math.dist of two points

/** The bounce value that gives restitution e_on_wood against the varnished hardwood table. */
function _b(e_on_wood) {
	return pyRound(div(e_on_wood, MATERIALS["varnished hardwood"].bounce), 3)
}

/** MATERIALS.setdefault(name, {"rolling": 0.0, "side": 0.0, **kw}): the density is a whole number in the Python (an int). */
function _mat(name, kw) {
	if (!Object.prototype.hasOwnProperty.call(MATERIALS, name)) define_material(name, { rolling: 0.0, side: 0.0, ...kw }, ["density"])
}

function _look(key, kw) {
	if (!(key in LOOK_FILL)) add_look(key, kw)
}

function _mm(x) {
	const v = x * 1000
	return rstrip(rstrip(v < 10 ? fmtF(v, 2) : fmtF(v, 1), "0"), ".")
}

function _kg(m) {
	const g = m * 1000
	return g >= 1000 ? `${rstrip(rstrip(fmtF(m, 2), "0"), ".")} kg` : g >= 10 ? `${fmtF(g, 0)} g` : `${rstrip(rstrip(fmtF(g, 2), "0"), ".")} g`
}

/** The density that makes a slab weigh `mass`. */
function _dens(mass, w, h, d, taper = null) {
	return pyRound(div(mass, (taper === null ? 1 : (1 + taper) / 2) * w * h * d), 4)
}

function _paint(color) {
	return truthy(color) ? { color, fill: color } : {}
}

function _claim(key, mass_by_props) {
	if (key in TYPES) CLASHES.push(key)
	KEYS.push(key)
	STATED[key] = mass_by_props
}

function _len(key, label, v, help = "", lo = null, hi = null) {
	return new Prop(key, label, v, lo !== null ? lo : pymax(0.001, pyRound(v / 5, 5)), hi !== null ? hi : pymin(2.0, pyRound(v * 5, 4)), v < 0.05 ? 0.0005 : 0.001, "m", help)
}

function _mass(m) {
	return new Prop("mass", "Weight", m, 0.0005, pymin(50.0, pyRound(m * 10, 3)), m < 0.02 ? 0.0001 : m < 1 ? 0.001 : 0.01, "kg")
}

const SIZE = [{ kind: "size", w: "width", h: "height" }, { kind: "rotate" }]

/** A round body seen end-on that is really a cylinder `length` long (the engine weighs round bodies as spheres). */
function _cylinder(c, part, diameter, length, mass, k, words, look = null, color = null) {
	const r = diameter / 2
	c.ball(part, r, 0.0, 0.0, {
		material: c.mat({ density: pyRound(div(mass, (4 / 3) * Math.PI * cube(r)), 4) }), inertia: pyRound(k, 4), shape: "cylinder", length,
		words, look, ..._paint(color)
	})
}

/** A slab welded to another solid of this item (as the seesaw's lip): lx, ly and angle are in the parent's frame. */
function _weld(c, part, parent, w, h, d, lx, ly, material, look, words, taper = null, angle = 0.0, color = null) {
	const body = { kind: "slab", width: pyRound(w, 5), height: pyRound(h, 5), depth: d }
	if (taper !== null) body.taper = taper
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look, body, material, at: { x: pyRound(lx, 5), y: pyRound(ly, 5) }, parent,
		placeholder: { fill: truthy(color) ? color : lookFill(look) }, render: { kind: "procedural", shade: lookShade(look) }, depth: 2
	}
	if (truthy(angle)) s.angle = pyRound(angle, 6)
	if (truthy(color)) s.color = color
	c.sb.solids.push(s)
}

/** Area of a polygon [(x, y)] (shoelace). */
function _area(pts) {
	const n = pts.length
	const terms = []
	for (let k = 0; k < n; k++) terms.push(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1])
	return Math.abs(pySum(terms)) / 2
}

/** An outline designed in mm (x right, y up, origin where you like) as metres about the point (ox, oy) mm, scaled by sx, sy. */
function _mmpts(pts, ox, oy, sx = 1.0, sy = 1.0) {
	return pts.map(([x, y]) => [pyRound(((x - ox) * sx) / 1000, 5), pyRound(((y - oy) * sy) / 1000, 5)])
}

/** The convex outline `pts` (counter-clockwise) with its edge i (pts[i] to pts[i + 1]) moved g inward, parallel to itself: the outline is cut by that line, so the two
 *  neighbouring sides keep their lines and the corners slide along them. (Two welded pieces that touch along an edge but are not welded to each other fight through
 *  the contact skin and creep: a gap of a millimetre or so between them, inside the 2 mm of skin the engine gives a polygon, ends that without opening the outline.) */
function _inset_edge(pts, i, g) {
	const n = pts.length
	const [ax, ay] = pts[i]
	const [bx, by] = pts[(i + 1) % n]
	const L = hypot(bx - ax, by - ay)
	const nx = div(-(by - ay), L)
	const ny = div(bx - ax, L)
	const cx = ax + nx * g
	const cy = ay + ny * g
	const side = (p) => (bx - ax) * (p[1] - cy) - (by - ay) * (p[0] - cx) // >= 0: inside (left of the moved edge)
	const out = []
	for (let k = 0; k < n; k++) {
		const p = pts[k]
		const q = pts[(k + 1) % n]
		const sp = side(p)
		const sq = side(q)
		if (sp >= 0) out.push(p)
		if ((sp > 0 && 0 > sq) || (sp < 0 && 0 < sq)) {
			const t = div(sp, sp - sq)
			out.push([pyRound(p[0] + (q[0] - p[0]) * t, 5), pyRound(p[1] + (q[1] - p[1]) * t, 5)])
		}
	}
	// a cut that lands near a corner leaves a sliver of a side: drop the corner (the engine refuses a side under 0.5 mm)
	let k = 0
	while (out.length > 3 && k < out.length) {
		if (dist(out[k], out[(k + 1) % out.length]) < 0.7e-3) out.splice((k + 1) % out.length, 1)
		else k++
	}
	return out
}

/** The side outline [(x, y)] counter-clockwise of a body of revolution about the y axis from rows [(y, radius)] bottom to top. */
function _revolve(rows) {
	return [...rows.map(([y, r]) => [r, y]), ...[...rows].reverse().map(([y, r]) => [-r, y])]
}

/** A convex polygon welded to another solid of this item (as the seesaw's lip). The first solid of a compound sits at the item's
 *  origin, unturned, so the points are in the item's frame (metres, around its centre) and the weld's own origin is the same.
 *  `at` places the polygon's origin in the parent's frame instead (the egg's pieces hang on a ball that is not at the item's origin). */
function _weld_poly(c, part, parent, pts, depth, material, look, words, color = null, at = [0.0, 0.0]) {
	const problem = polygon_problem(pts)
	if (problem) throw new ValueError(`${c.item.id}/${part}: polygon ${problem}`)
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look, body: { kind: "polygon", points: pts.map(([x, y]) => ({ x, y })), depth: pyRound(depth, 5) }, material,
		at: { x: pyRound(at[0], 5), y: pyRound(at[1], 5) }, parent, placeholder: { fill: truthy(color) ? color : lookFill(look) }, render: { kind: "procedural", shade: lookShade(look) }, depth: 2
	}
	if (truthy(color)) s.color = color
	c.sb.solids.push(s)
}

/** Pieces of a compound that touch along an edge but neither is the main solid (the first piece): every other piece is welded to the main one, so two of them that touch
 *  are not welded to each other, and the engine's contact skin between them pushes them against their welds for ever. The bigger piece of such a pair is cut back `gap` (m)
 *  from the shared edge (the gap, inside the 2 mm of skin the engine gives a polygon, is sealed to anything else). Returns the parts with their outlines trimmed. */
function _apart(parts, gap) {
	const pts = parts.map((p) => [...p[2]])
	const n = pts.length
	for (let j = 2; j < n; j++) {
		for (let i = 1; i < j; i++) {
			let found = null
			for (let ej = 0; ej < pts[j].length; ej++) {
				const aj = pts[j][ej]
				const bj = pts[j][(ej + 1) % pts[j].length]
				const lj = hypot(bj[0] - aj[0], bj[1] - aj[1])
				if (lj < 1e-6) continue
				for (let ei = 0; ei < pts[i].length; ei++) {
					const ai = pts[i][ei]
					const bi = pts[i][(ei + 1) % pts[i].length]
					// the same line run the other way (the two pieces lie either side of it), overlapping by at least 0.2 mm
					const d1 = div(Math.abs((bj[0] - aj[0]) * (ai[1] - aj[1]) - (bj[1] - aj[1]) * (ai[0] - aj[0])), lj)
					const d2 = div(Math.abs((bj[0] - aj[0]) * (bi[1] - aj[1]) - (bj[1] - aj[1]) * (bi[0] - aj[0])), lj)
					const dot = (bj[0] - aj[0]) * (bi[0] - ai[0]) + (bj[1] - aj[1]) * (bi[1] - ai[1])
					if (d1 < 2e-5 && d2 < 2e-5 && dot < 0) {
						const t1 = div((ai[0] - aj[0]) * (bj[0] - aj[0]) + (ai[1] - aj[1]) * (bj[1] - aj[1]), lj * lj)
						const t2 = div((bi[0] - aj[0]) * (bj[0] - aj[0]) + (bi[1] - aj[1]) * (bj[1] - aj[1]), lj * lj)
						if (pymin(pymax(t1, t2), 1.0) - pymax(pymin(t1, t2), 0.0) > div(0.2e-3, lj)) {
							found = [ei, ej]
							break
						}
					}
				}
				if (found) break
			}
			if (found) {
				const [ei, ej] = found
				const [k, e] = _area(pts[i]) >= _area(pts[j]) ? [i, ei] : [j, ej]
				// never cut back more than a fifth of the piece's own width (2 x area / perimeter: the thickness of a bar), so a small item's thin pieces stay
				const perimeter = pySum(pts[k].map((p, m) => dist(p, pts[k][(m + 1) % pts[k].length])))
				const g = pymin(gap, div(0.2 * 2 * _area(pts[k]), perimeter))
				if (g >= 0.15e-3) pts[k] = _inset_edge(pts[k], e, g)
			}
		}
	}
	return parts.map(([name, words, , d], k) => [name, words, pts[k], d])
}

/** One rigid object from convex pieces: parts = [(name, words, points (m, about the item's centre), depth)]. The first is the main
 *  solid, at the item's origin; the rest are welded to it. The weight is shared by volume (area x depth), or by `shares` (fractions).
 *  `colors` (one per piece) paints the pieces differently in the 2D view (a red arm on a black base); `color` paints them all.
 *  `parents` {name: parent name} welds a piece to another piece than the main one (it must be listed before it); `gap` (m) holds two pieces that touch along an edge apart
 *  by that much (see _apart): the pieces then do not creep against their welds. */
function _compound(c, parts, mass, look, color = null, { shares = null, colors = null, parents = null, gap = null } = {}) {
	if (truthy(gap)) parts = _apart(parts, gap)
	const vols = parts.map(([, , pts, d]) => _area(pts) * d)
	if (!(shares && shares.length)) shares = vols.map((v) => div(v, pySum(vols)))
	let main = null
	const count = Math.min(parts.length, shares.length, vols.length) // (zip stops at the shortest)
	for (let k = 0; k < count; k++) {
		const [name, words, pts, d] = parts[k]
		const sh = shares[k]
		const v = vols[k]
		const material = c.mat({ density: pyRound(div(mass * sh, v), 4) })
		const col = colors && colors.length ? colors[k] : color
		if (main === null) main = c.poly(name, pts, d, 0.0, 0.0, { material, look, words, ..._paint(col) })
		else _weld_poly(c, name, parents && name in parents ? `${c.item.id}/${parents[name]}` : main, pts, d, material, look, words, col)
	}
}

// ---------------------------------------------------------------- looks and materials
function _looks() {
	// the first four are catalog_items.py's: they are only made here if that module has not
	_look("glass", { fill: "#bfe3ee", shade: "#7fb6c8", roughness: 0.04, metalness: 0.0, clearcoat: 1.0, transmission: 0.9, ior: 1.5, thickness: 0.01 })
	_look("aluminium", { fill: "#c9ced3", shade: "#8f979e", roughness: 0.35, metalness: 1.0, clearcoat: 0.0 })
	_look("foam", { fill: "#e6cf5e", shade: "#bfa534", roughness: 0.95, metalness: 0.0, clearcoat: 0.0 })
	_look("cardboard", { fill: "#c9a26b", shade: "#a07c48", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	_look("pvc", { fill: "#ef4136", shade: "#bf2a22", roughness: 0.35, metalness: 0.0, clearcoat: 0.5 })
	_look("ceramic", { fill: "#f3f0e8", shade: "#cbc5b6", roughness: 0.15, metalness: 0.0, clearcoat: 1.0 })
	_look("fruit", { fill: "#c0392b", shade: "#8e2a20", roughness: 0.45, metalness: 0.0, clearcoat: 0.35 })
	_look("eggshell", { fill: "#f2e4cc", shade: "#cdb792", roughness: 0.7, metalness: 0.0, clearcoat: 0.1 })
	_look("paper", { fill: "#f3efe4", shade: "#cbc4b0", roughness: 0.9, metalness: 0.0, clearcoat: 0.0 })
	_look("wax", { fill: "#f1e7c9", shade: "#c9bb93", roughness: 0.35, metalness: 0.0, clearcoat: 0.2 })
	_look("fabric", { fill: "#e6eaf2", shade: "#b4bccb", roughness: 1.0, metalness: 0.0, clearcoat: 0.0 })
}

function _materials() {
	// (density kg/m³ of the material; bounce = restitution against a rigid surface / 0.93; Coulomb friction; rolling resistance)
	// Each item takes its weight from its own spec, so a material's density only matters when it is swapped in.
	_mat("ABS plastic", {
		density: 1050, bounce: _b(0.5), friction: 0.3, rolling: 0.004, look: "plastic",
		source: "ABS 1040-1060 kg/m³ (what LEGO bricks are made of); plastic on wood friction about 0.3. A hard molded part lands with e about 0.5: provisional."
	})
	_mat("polypropylene", {
		density: 905, bounce: _b(0.4), friction: 0.25, rolling: 0.004, look: "plastic",
		source: "Polypropylene 900-910 kg/m³ (Engineering ToolBox); slippery, friction about 0.25. A thin cup wall flexes, so e about 0.4: provisional."
	})
	_mat("PET", {
		density: 1380, bounce: _b(0.25), friction: 0.3, rolling: 0.004, look: "glass",
		source: "PET 1380 kg/m³ (Engineering ToolBox). A bottle of water lands dead because the water soaks up the impact: e about 0.25, friction 0.3 provisional."
	})
	_mat("ceramic", {
		density: 2400, bounce: _b(0.45), friction: 0.35, rolling: 0.002, look: "ceramic",
		source: "Porcelain and stoneware 2300-2500 kg/m³. Glazed ceramic on wood: friction 0.35 and e 0.45 are provisional."
	})
	_mat("glass & aluminium", {
		density: 2700, bounce: _b(0.3), friction: 0.35, rolling: 0.001, look: "aluminium",
		source: "Aluminium 2700 kg/m³, glass 2500; a phone or laptop is mostly air and electronics, so each takes its weight from its spec sheet. Lands with a dull knock: e 0.3, friction 0.35 provisional."
	})
	_mat("aluminium can", {
		density: 2700, bounce: _b(0.25), friction: 0.3, rolling: 0.003, look: "aluminium",
		source: "Aluminium 2700 kg/m³. The wall is only about 0.1 mm and a full can's drink soaks up the impact, so it lands with a thud: e 0.25, friction 0.3 provisional."
	})
	_mat("fruit", {
		density: 820, bounce: _b(0.3), friction: 0.45, rolling: 0.015, look: "fruit",
		source: "Apples and oranges weigh 800-850 kg/m³ (they float). A soft, wet body takes the impact: e 0.3, friction 0.45 and rolling resistance 0.015 are provisional."
	})
	_mat("eggshell", {
		density: 1030, bounce: _b(0.1), friction: 0.4, rolling: 0.0, look: "eggshell",
		source: "A whole egg is about 1.03 kg/L. The shell cracks rather than bouncing, so e is about 0.1: provisional, as is friction 0.4. No rolling resistance: an egg loses its energy " +
			"rocking, not rolling, and a resistance would hold one balanced on its blunt end, which a real egg cannot do."
	})
	_mat("tissue paper", {
		density: 120, bounce: _b(0.1), friction: 0.5, rolling: 0.015, look: "paper",
		source: "A rolled paper roll is about 100-150 kg/m³ (provisional, from a roll's weight and size). Soft: almost no bounce, a larger rolling resistance 0.015 (provisional)."
	})
	_mat("wax", {
		density: 900, bounce: _b(0.15), friction: 0.3, rolling: 0.004, look: "wax",
		source: "Paraffin wax about 900 kg/m³; slippery on wood, brittle: friction 0.3 and e 0.15 are provisional."
	})
	_mat("vinyl rubber", {
		density: 1150, bounce: _b(0.35), friction: 0.7, rolling: 0.02, look: "rubber",
		source: "Plasticised PVC / vinyl 1100-1400 kg/m³ (a hollow toy weighs far less, so its weight is set per item). Soft and grippy: e 0.35, friction 0.7 provisional."
	})
	_mat("cupronickel", {
		density: 8900, bounce: _b(0.5), friction: 0.3, rolling: 0.002, look: "steel",
		source: "US quarter: a copper core clad in 75 % copper, 25 % nickel (US Mint), about 8900 kg/m³. Metal on wood: e 0.5, friction 0.3, rolling 0.002 provisional."
	})
	_mat("rubber & fabric", {
		density: 300, bounce: _b(0.15), friction: 0.8, rolling: 0.0, look: "fabric",
		source: "Rubber sole on wood friction 0.7-1.0; the foam midsole and the fabric soak up the impact: e 0.15 provisional."
	})
}

// ---------------------------------------------------------------- drinks: standing (a slab) and on their side (a rolling cylinder)
function _drink(key, name, noun, D, H, full, empty, material, look, color, tags, source, words_up, up = null) {
	const facts = `${_mm(D)} × ${_mm(H)} mm · ${_kg(full)} full, ${_kg(empty)} empty`
	const full_prop = new Prop("full", "Full", true, { kind: "bool", help: `Untick for an empty ${noun} (${_kg(empty)})` })

	function build_up(c, P) {
		const d = P.diameter
		const h = P.height
		const m = truthy(P.full) ? full : empty
		c.slab("body", d, h, d, 0.0, 0.0, { material: c.mat({ density: _dens(m, d, h, d) }), look, words: words_up, ..._paint(color) })
	}

	function build_side(c, P) {
		// only the container turns with the can: a full one's liquid barely spins over a ramp's length (spin-up takes 8-16 s), so its inertia is the
		// container's share, 0.8 empty/full (a thin side wall at k 1 plus two ends at k 1/2); an empty one is that container alone (0.8)
		const [m, k] = truthy(P.full) ? [full, div(0.8 * empty, full)] : [empty, 0.8]
		_cylinder(c, "body", P.diameter, P.length, m, k, `a ${noun} lying on its side`, look, color)
	}

	_claim(key, [[{}, full], [{ full: false }, empty]])
	register(new ItemType(key, `${name}, standing`, CAT, up || build_up, {
		material, materials: [material], anchor: "its centre",
		props: [_len("diameter", "Diameter", D), _len("height", "Height", H), full_prop],
		tags: [...tags, "upright", "standing"], facts, source,
		description: `A ${noun} standing up: heavy and hard to knock over when full, light and tippy when empty.`,
		edit: [{ kind: "size", w: "diameter", h: "height" }, { kind: "rotate" }]
	}))
	_claim(`${key}-side`, [[{}, full], [{ full: false }, empty]])
	register(new ItemType(`${key}-side`, `${name}, on its side`, CAT, build_side, {
		material, materials: [material], anchor: "its centre",
		props: [_len("diameter", "Diameter", D), _len("length", "Length (front to back)", H, "Only for the 3D look"), full_prop],
		tags: [...tags, "rolling", "roller", "lying", "cylinder", "on its side"], facts,
		source: source + " Rolling: only the container turns with it. A full one's liquid barely spins over a ramp's length " +
			"(spin-up takes 8-16 s), so its inertia is the container's share, 0.8 × empty/full weight; an empty one is a thin wall with two ends, 0.8 m r².",
		description: `The same ${noun} lying down, seen end-on: it rolls like a cylinder, not like a ball.`,
		edit: [{ kind: "radius", prop: "diameter" }]
	}))
}

function _drinks() {
	function can_up(c, P) {
		// side view (mm, x about the axis, y up from the middle of the 122.4 mm): the 66.2 mm body straight up to 104 mm, then the neck, two chords of the real curve, in to the 55.6 mm lid (one convex solid)
		const D = P.diameter
		const H = P.height
		const pts = [[-33.1, -61.2], [33.1, -61.2], [33.1, 43.0], [29.0, 58.5], [27.8, 61.2], [-27.8, 61.2], [-29.0, 58.5], [-33.1, 43.0]]
		_compound(c, [["body", "a soda can standing up", _mmpts(pts, 0, 0, D / 0.0662, H / 0.1224), D]], truthy(P.full) ? 0.370 : 0.015, "aluminium", "#c0392b")
	}
	_drink("soda-can", "Soda can", "soda can", 0.0662, 0.1224, 0.370, 0.015, "aluminium can", "aluminium", "#c0392b",
		["can", "tin can", "pop", "soda", "cola", "drink", "beverage", "aluminium can", "12 oz", "fizzy"],
		"Standard 12 US fl oz (355 mL) beverage can, about 66 × 122 mm. Full 370 g: 355 mL of drink plus a 13-15 g can (a sugary soda at 1.04 kg/L would be nearer 380 g). " +
		"Bounce and friction provisional. Standing, its outline has the real neck: a 66.2 mm body, straight for 104 mm, narrowing over the top 18 mm to a 58 mm seam and a 55.6 mm lid (one solid; provisional).",
		"a soda can standing up", can_up)
	function bottle_up(c, P) {
		// side view (mm, x about the axis, y up from the base): the body, a two-step shoulder (its chords straddle the drawn curve to within 1 mm), then the neck and cap as a second solid
		const D = P.diameter
		const H = P.height
		const sx = D / 0.065
		const sy = H / 0.205
		const body = [[-32.5, 0], [32.5, 0], [32.5, 124], [26.0, 153.3], [15.25, 165], [-15.25, 165], [-26.0, 153.3], [-32.5, 124]]
		const neck = [[-15.25, 165], [15.25, 165], [15.25, 205], [-15.25, 205]]
		_compound(c, [["body", "the body and shoulder of a water bottle", _mmpts(body, 0, 102.5, sx, sy), D],
			["neck", "the neck and cap of a water bottle", _mmpts(neck, 0, 102.5, sx, sy), 0.0305 * sx]],
		truthy(P.full) ? 0.512 : 0.012, "glass")
	}
	_drink("water-bottle", "Water bottle", "water bottle", 0.065, 0.205, 0.512, 0.012, "PET", "glass", null,
		["bottle", "water", "drink", "plastic bottle", "pet", "500 ml", "half litre", "hydration"],
		"A typical 500 mL (16.9 US fl oz) PET bottle, about 65 × 205 mm (brands differ); 500 mL of water weighs 0.50 kg, plus about 12 g of bottle and cap (provisional). " +
		"Its outline is the real one: a straight body 124 mm tall, a shoulder that narrows to a 30.5 mm neck and cap (two welded solids).",
		"a water bottle standing up", bottle_up)
	function mug_up(c, P) {
		// side view (mm, origin at the middle of the 95 mm body): an open cup, so a floor (7.9 mm) and two walls (4.3 mm, a 73 mm bore) welded together, and the handle
		// a C of three convex pieces whose outer corners are rounded (centre line: 10 mm strap, corner radius 16 mm on the outside; finger hole 26 x 47 mm)
		const D = P.diameter
		const H = P.height
		const sx = D / 0.082
		const sy = H / 0.095
		const u = pymin(sx, sy) // the handle keeps its shape and a hand-sized grip as the mug is stretched: it scales evenly by the smaller stretch, its root staying on the wall
		const pts = (p) => _mmpts(p, 0, 0, sx, sy)
		const hpts = (p) => p.map(([x, y]) => [pyRound((41 * sx + (x - 41) * u) / 1000, 5), pyRound((y * u) / 1000, 5)])
		const wall_t = 4.3
		const floor_t = 7.9
		const yf = -47.5 + floor_t
		const wall = (sgn) => (sgn > 0 ? [[41 - wall_t, yf], [41, yf], [41, 47.5], [41 - wall_t, 47.5]] : [[-41, yf], [-(41 - wall_t), yf], [-(41 - wall_t), 47.5], [-41, 47.5]])
		const arc = (cx, cy, r, a0, a1, n = 3) => {
			const out = []
			for (let k = 0; k <= n; k++) {
				const rad = (a0 + ((a1 - a0) * k) / n) * D2R // math.radians
				out.push([pyRound(cx + r * cos(rad), 2), pyRound(cy + r * sin(rad), 2)])
			}
			return out
		}
		const lower = arc(61, -14, 16, -90, 0) // the outer bar's lower corner: (61, -30) ... (77, -14)
		const upper = arc(61, 21, 16, 0, 90) // its upper corner: (77, 21) ... (61, 37)
		let bar = [lower[1], lower[2], lower[3], upper[0], upper[1], upper[2], [67, pyRound(21 + Math.sqrt(16 ** 2 - 6 ** 2), 2)], [67, pyRound(-14 - Math.sqrt(16 ** 2 - 6 ** 2), 2)]]
		bar = [bar[bar.length - 1], ...bar.slice(0, -1)]
		const pieces = [
			["body", "the floor of a ceramic mug", pts([[-41, -47.5], [41, -47.5], [41, yf], [-41, yf]]), D],
			["wall-left", "the left wall of a ceramic mug", pts(wall(-1)), D], ["wall-right", "the right wall of a ceramic mug", pts(wall(1)), D],
			["handle-top", "the top arm of a mug's handle", hpts([[41, 27], [67, 27], [67, bar[7][1]], [61, 37], [41, 37]]), 0.016 * u],
			["handle", "the outer bar of a mug's handle", hpts(bar), 0.016 * u],
			["handle-bottom", "the bottom arm of a mug's handle", hpts([[41, -30], [61, -30], [67, bar[0][1]], [67, -20], [41, -20]]), 0.016 * u]
		]
		const vols = pieces.map(([, , pp, dd]) => _area(pp) * dd)
		const hv = pySum(vols.slice(3))
		const shares = [0.30, 0.275, 0.275, ...vols.slice(3).map((v) => div(0.15 * v, hv))]
		_compound(c, pieces, P.mass, "ceramic", null, { shares, gap: 0.0012 })
	}
	// the mug has no empty state: a cup of tea is a different thing
	_upright("coffee-mug", "Coffee mug", "a ceramic mug", 0.082, 0.095, 0.330, "ceramic", "ceramic", null,
		["mug", "cup", "coffee", "tea", "china", "drink", "ceramic", "teacup"],
		"A mug of about 11 oz: stoneware, about 82 mm across and 95 mm tall, 330 g (product specs vary; provisional). It is an open cup, so a marble dropped in stays in: " +
		"a 7.9 mm floor and two 4.3 mm walls (a 73 mm bore) share 30 % and 55 % of the weight, the C-shaped handle (77 mm out from the axis, 67 mm tall, a 26 × 47 mm hole, rounded " +
		"outer corners) the other 15 % (provisional: the weight split sets a centre of gravity about 37 mm above the base); so a finger, a pencil or a hook fits through it.",
		"An empty ceramic mug standing up: an open cup, heavy for its size, and it knocks rather than bounces. Its handle really is a C.",
		{ builder: mug_up, mins: { diameter: 0.021, height: 0.025 } }) // smaller and the handle's shortest sides would be under the engine's 0.5 mm
	function candle_up(c, P) {
		// side view (mm, x about the axis, y up from the middle of the 254 mm): 22 mm across the foot, tapering to 20.8 mm 2.5 mm under the top, then in to the 19.4 mm top (one convex solid)
		const D = P.diameter
		const H = P.height
		const pts = [[-11.0, -127.0], [11.0, -127.0], [10.4, 124.5], [9.7, 127.0], [-9.7, 127.0], [-10.4, 124.5]]
		_compound(c, [["body", "a taper candle", _mmpts(pts, 0, 0, D / 0.022, H / 0.254), D]], P.mass, "wax")
	}
	_upright("candle", "Candle", "a taper candle", 0.022, 0.254, 0.087, "wax", "wax", null,
		["taper", "wax", "dinner candle", "birthday", "light", "stick", "tall", "tippy"],
		"A standard 7/8 in × 10 in (22 × 254 mm) taper candle; paraffin about 900 kg/m³ gives 87 g. Its outline is the real taper: 22 mm across the foot, 20.8 mm just under the top " +
		"and 19.4 mm across the top (one solid).",
		"A tall thin candle: its base is only 22 mm wide, so it tips at 5 degrees.",
		{ builder: candle_up, mins: { diameter: 0.007, height: 0.065 } }) // smaller and the shoulder at the top (2.5 mm tall at full size) would be under the engine's 0.5 mm
}

function _upright(key, name, words, D, H, mass, material, look, color, tags, source, description, { builder = null, mins = null } = {}) {
	mins = mins || {}

	function build(c, P) {
		const d = P.diameter
		const h = P.height
		c.slab("body", d, h, d, 0.0, 0.0, { material: c.mat({ density: _dens(P.mass, d, h, d) }), look, words, ..._paint(color) })
	}
	_claim(key, [[{}, mass]])
	register(new ItemType(key, name, CAT, builder || build, {
		material, materials: [material], anchor: "its centre",
		props: [_len("diameter", "Diameter", D, "", mins.diameter ?? null), _len("height", "Height", H, "", mins.height ?? null), _mass(mass)], tags: [...tags, "upright", "standing"],
		facts: `${_mm(D)} × ${_mm(H)} mm · ${_kg(mass)}`, source, description,
		edit: [{ kind: "size", w: "diameter", h: "height" }, { kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- boxy things: one slab, drawn the way they usually lie or stand
function _box(key, name, w, h, d, mass, material, words, tags, description, source, { look = null, color = null, facts = null, labels = ["Width", "Height", "Front to back"], builder = null, mins = null, maxes = null } = {}) {
	mins = mins || {}
	maxes = maxes || {}

	function build(c, P) {
		const W = P.width
		const H = P.height
		const D = P.depth
		c.slab("body", W, H, D, 0.0, 0.0, { material: c.mat({ density: _dens(P.mass, W, H, D) }), look, words, ..._paint(color) })
	}
	_claim(key, [[{}, mass]])
	register(new ItemType(key, name, CAT, builder || build, {
		material, materials: [material], anchor: "its centre",
		props: [_len("width", labels[0], w, "Left to right", mins.width ?? null, maxes.width ?? null), _len("height", labels[1], h, "Bottom to top", mins.height ?? null, maxes.height ?? null),
			_len("depth", labels[2], d, "Only for the 3D look; the weight is set by Weight", mins.depth ?? null, maxes.depth ?? null), _mass(mass)],
		tags, description, source, edit: SIZE,
		facts: truthy(facts) ? facts : [w, h, d].sort((a, b) => b - a).map(_mm).join(" × ") + ` mm · ${_kg(mass)}`
	}))
}

function _boxes() {
	_box("hardcover-book", "Hardcover book", 0.229, 0.035, 0.152, 0.65, "cardboard", "a hardcover book lying flat",
		["book", "novel", "textbook", "hardback", "volume", "paper", "reading"],
		"A trade hardcover lying flat: it slides, and tips on its edge if you turn it.",
		"Trade hardcover, 6 × 9 in (152 × 229 mm) page, about 35 mm thick; 650 g is provisional (400-800 g is usual).", { color: "#7a2e2e" })
	_box("paperback-book", "Paperback book", 0.175, 0.025, 0.108, 0.20, "cardboard", "a paperback book lying flat",
		["book", "novel", "pocket book", "soft cover", "paper", "reading"],
		"A pocket paperback lying flat.", "Mass-market paperback format, 4.25 × 6.87 in (108 × 175 mm) page, about 25 mm thick; 200 g provisional.", { color: "#d9c7a0" })
	_box("cereal-box", "Cereal box", 0.190, 0.300, 0.063, 0.55, "cardboard", "a cereal box standing up",
		["box", "carton", "cardboard box", "breakfast", "cornflakes", "packet", "food box", "package"],
		"A full cereal box standing up: tall and light, so it topples easily.",
		"About 190 × 300 × 63 mm (7.5 × 11.75 × 2.5 in); 18 oz (510 g) of cereal plus about 40 g of box and bag: 0.55 kg. Provisional: boxes differ.", { color: "#e0a030" })
	_box("tissue-box", "Tissue box", 0.240, 0.070, 0.120, 0.15, "cardboard", "a box of tissues",
		["tissues", "kleenex", "box", "facial tissue", "cardboard box", "carton", "napkin"],
		"A box of tissues, opening up: light and low, it slides.", "A typical rectangular box, about 240 × 70 × 120 mm; 150 g provisional.", { color: "#7fb3d5" })
	_box("cutting-board", "Cutting board", 0.406, 0.019, 0.305, 1.65, "varnished hardwood", "a wooden cutting board",
		["chopping board", "board", "kitchen", "wood", "plank", "butcher block", "tray"],
		"A wooden chopping board lying flat: heavy for its thinness.", "16 × 12 × 3/4 in (406 × 305 × 19 mm); maple about 700 kg/m³ gives 1.65 kg.")
	_box("sponge", "Sponge", 0.114, 0.015, 0.069, 0.015, "foam", "a kitchen sponge",
		["scrubber", "kitchen", "soft", "squishy", "foam", "cleaning", "scourer"],
		"A dry kitchen sponge: almost weightless, and it takes the bounce out of whatever lands on it.",
		"Scrub sponge, about 4.5 × 0.6 × 2.7 in (114 × 15 × 69 mm); 15 g dry is provisional.")
	_box("smartphone", "Smartphone", 0.1476, 0.0078, 0.0716, 0.171, "glass & aluminium", "a smartphone lying flat",
		["phone", "mobile", "iphone", "cell phone", "android", "device", "screen", "gadget"],
		"A phone lying flat on its back.", "A 6.1 inch phone: 147.6 × 71.6 × 7.8 mm, 171 g (iPhone 15 tech specs). Bounce and friction provisional.",
		{ look: "plastic", color: "#5b6577" })
	_box("laptop-closed", "Laptop, closed", 0.3041, 0.0113, 0.215, 1.24, "glass & aluminium", "a closed laptop",
		["laptop", "notebook computer", "macbook", "computer", "pc", "ultrabook", "device"],
		"A thin 13 inch laptop with its lid shut.", "A 13 inch thin laptop: 304.1 × 215 × 11.3 mm, 1.24 kg (MacBook Air 13 inch tech specs). Bounce and friction provisional.")
	_box("tv-remote", "TV remote", 0.190, 0.025, 0.048, 0.09, "ABS plastic", "a TV remote lying flat",
		["remote control", "clicker", "controller", "tv", "remote", "plastic", "buttons"],
		"A remote control lying flat.", "A typical remote with two AAA cells: about 190 × 25 × 48 mm, 90 g (provisional; remotes differ).", { look: "plastic", color: "#6b7280" })
	function stapler_build(c, P) {
		// side view (mm, nose to the right, 155 × 50): a black base plate 10 mm tall, and the red arm hinged at the rear, whose underside rests on the base at the hinge and lifts off it from x 30 to leave the paper
		// throat (up to 7.5 mm), in two convex pieces (the hump and the nose); the throat is open, so a sheet, a pencil or a coin fits under the nose
		const W = P.width
		const H = P.height
		const D = P.depth
		const pts = (p) => _mmpts(p, 77.5, 25, W / 0.155, H / 0.050)
		const k = D / 0.045
		const base = [[4.6, 0], [149.4, 0], [153, 2.6], [153, 7.4], [149.4, 10], [4.6, 10], [2, 7.4], [2, 2.6]]
		const rear = [[3, 10], [30, 10], [75, 14.8], [75, 47.3], [45, 50], [14, 47], [3, 40], [1, 26]]
		const nose = [[75, 14.8], [153.2, 17.5], [153.8, 22], [153.8, 28.5], [150, 34], [100, 44], [75, 47.3]]
		_compound(c, [["body", "the base of a desk stapler", pts(base), 0.036 * k], ["arm", "the arm of a desk stapler, over the hinge", pts(rear), 0.034 * k],
			["nose", "the nose of a desk stapler's arm", pts(nose), 0.026 * k]], P.mass, "plastic", null, { colors: ["#26272b", "#b0332a", "#b0332a"], gap: 0.0012 })
	}
	_box("stapler", "Stapler", 0.155, 0.050, 0.045, 0.25, "ABS plastic", "a desk stapler",
		["desk", "office", "stationery", "staples", "paper", "binder"],
		"A desk stapler, closed: its arm slopes down to the nose and leaves a paper gap under it.", "A standard desktop stapler, about 155 × 50 × 45 mm; 250 g (provisional: the plastic-and-steel body is shared out by volume). " +
		"Its side outline is the real one: a 10 mm base, the hinged arm with its hump and sloping nose, and a throat of 6-8 mm under the nose (three welded solids).",
		{ look: "plastic", color: "#b0332a", builder: stapler_build })
	function pencil_build(c, P) {
		// side view: the stick, with the sharpened cone (17 mm of 190) ending in a 1 mm point; it lies on a flat of its hexagon
		const W = P.width
		const H = P.height
		const D = P.depth
		const tip = 0.09
		const pts = [[-0.5, -0.5], [0.5 - tip, -0.5], [0.5, -0.07], [0.5, 0.07], [0.5 - tip, 0.5], [-0.5, 0.5]]
		_compound(c, [["body", "a pencil lying flat", pts.map(([u, v]) => [pyRound(u * W, 5), pyRound(v * H, 5)]), D]], P.mass, "plastic", "#f2c230")
	}
	_box("pencil", "Pencil", 0.190, 0.007, 0.0081, 0.005, "varnished hardwood", "a pencil lying flat",
		["pen", "stick", "stationery", "graphite", "wood", "writing", "school", "thin"],
		"A new pencil lying flat on a face of its hexagon: a thin stick that slides, with a sharpened point.",
		"A new #2 pencil: 7.5 in (190 mm) long, hexagonal, 7.0 mm across the flats (8.1 mm across the corners, which is its depth); about 5 g with graphite, paint, ferrule " +
		"and eraser (provisional). Seen from the side, so it slides rather than rolls. Its outline has the sharpened cone: 17 mm long, ending in a 1 mm point.",
		{ look: "plastic", color: "#f2c230", builder: pencil_build, mins: { height: 0.004 } }) // a thinner stick would make the point's flat side (0.14 of the height) shorter than the engine's 0.5 mm
	_box("ruler", "Ruler", 0.305, 0.003, 0.030, 0.029, "ABS plastic", "a plastic ruler lying flat",
		["rule", "straightedge", "stick", "stationery", "school", "30 cm", "measure", "plastic"],
		"A 30 cm plastic ruler lying flat.", "30 cm ruler, 305 × 30 × 3 mm; polystyrene about 1050 kg/m³ gives 29 g.", { look: "plastic", color: "#7fd0e8" })
	function chopstick_build(c, P) {
		// side view (x along the stick, y up from its centre; 240 × 6 mm): flat underneath, 6 mm thick from the grip end to x = -10 mm, then the top slopes down in one
		// straight taper to a 2.5 mm tip (x = +120 mm). Points in units of the box (u = x / 240 mm, v = y / 6 mm), so the size handles stretch it.
		const W = P.width
		const H = P.height
		const D = P.depth
		const pts = [[-0.5, -0.5], [0.5, -0.5], [0.5, -0.08333], [-0.04167, 0.5], [-0.5, 0.5]]
		_compound(c, [["body", "a chopstick lying flat", pts.map(([u, v]) => [pyRound(u * W, 5), pyRound(v * H, 5)]), D]], P.mass, "wood")
	}
	_box("chopstick", "Chopstick", 0.240, 0.006, 0.006, 0.0055, "varnished hardwood", "a chopstick lying flat",
		["chopsticks", "stick", "bamboo", "wooden stick", "utensil", "skewer", "dowel"],
		"One chopstick lying flat: a thin stick that slides, thick at the grip and tapering to a fine tip.",
		"A typical 240 mm chopstick, 6 mm thick at the grip; about 5.5 g (wood or bamboo; provisional). Seen from the side its outline tapers: 6 mm thick up to 10 mm " +
		"before the middle, then the top slopes to a 2.5 mm tip (flat underneath, so it lies without rolling).", { builder: chopstick_build, mins: { height: 0.002 } }) // a thinner stick would make the tip's flat side (0.42 of the height) shorter than 0.6 mm (the engine's limit is 0.5 mm)
	_box("eraser", "Eraser", 0.062, 0.013, 0.022, 0.020, "vinyl rubber", "a block eraser",
		["rubber", "pencil eraser", "stationery", "school", "block", "vinyl"],
		"A plastic block eraser: grippy, and it hardly bounces.", "A plastic block eraser about 62 × 13 × 22 mm; vinyl about 1150 kg/m³ gives 20 g (provisional).", { look: "rubber", color: "#f0b8c0" })
	_box("coin-flat", "Coin, flat", 0.02426, 0.00175, 0.02426, 0.00567, "cupronickel", "a quarter lying flat",
		["quarter", "money", "cash", "change", "flat", "sliding", "disc", "25 cents", "currency", "us coin"],
		"A US quarter lying flat on its face: it slides. (Stand it on its edge and it rolls.)",
		"US Mint specification for the quarter dollar: 24.26 mm across, 1.75 mm thick, 5.670 g. Bounce and friction provisional.",
		{ facts: "24.26 mm · 1.75 mm thick · 5.67 g", labels: ["Diameter", "Thickness", "Front to back"] })
	_box("die", "Die", 0.016, 0.016, 0.016, 0.0043, "ABS plastic", "a six-sided die",
		["dice", "game", "cube", "board game", "six sided", "d6", "gambling"],
		"A standard six-sided die.", "The standard 16 mm (5/8 in) die; ABS-type plastic at about 1050 kg/m³ gives 4.3 g (provisional).", { look: "plastic", color: "#f6f3ea" })
	_box("lego-brick", "LEGO brick, 2 × 4", 0.0318, 0.0096, 0.0158, 0.0023, "ABS plastic", "a 2 by 4 toy brick",
		["lego", "toy brick", "building brick", "2x4", "toy", "block", "plastic brick"],
		"The classic 2 × 4 brick (1.7 mm studs drawn, not colliding).",
		"LEGO 2 × 4 brick: 31.8 × 15.8 mm, 9.6 mm tall (plus 1.7 mm studs drawn, not colliding); about 2.3 g (hobby catalogues; provisional).", { look: "plastic", color: "#d6322c" })
	_box("rubiks-cube", "Rubik's cube", 0.057, 0.057, 0.057, 0.09, "ABS plastic", "a Rubik's cube",
		["rubik", "puzzle", "cube", "3x3", "twisty puzzle", "speedcube", "toy"],
		"A 3 × 3 puzzle cube, solid.", "The standard 3 × 3 cube is about 57 mm (2.25 in); about 90 g is provisional (makers differ).", { look: "plastic", color: "#2f6fd0" })
	// the pillow's side outline (mm about the centre of its 660 × 120 mm box, right half; the left half mirrors it): a lens traced from two curves, welded from convex pieces.
	//   crown  y = -22 + 82 (1 - (x/330)^3)^0.75        (the top: a domed crown, steep for the last 30 mm into the seam)
	//   belly  y = -22 - min(38, 60 (1 - (x/330)^2.8)^0.7)   (flat underneath to x = 254, so it lies without rocking, then up to the seam)
	// the seam is the point (330, -22). The pieces' corners sit on the curves, so a chord leaves the curve by at most 0.8 mm (web/models/everyday-a-small.js draws the curves).
	const PILLOW_PIECES = [
		["body", "the middle of a bed pillow", [[-123.75, -60.0], [123.75, -60.0], [123.75, 56.73], [82.5, 59.04], [0, 60.0], [-82.5, 59.04], [-123.75, 56.73]]],
		["arch", "the crown of a bed pillow, right of the middle", [[123.75, -60.0], [247.5, -60.0], [247.5, 32.37], [206.25, 44.47], [165.0, 52.19], [123.75, 56.73]]],
		["slope", "the shoulder of a bed pillow, to the right", [[247.5, -60.0], [257.81, -58.88], [268.13, -55.82], [288.75, -48.55], [288.75, 13.71], [268.13, 24.07], [247.5, 32.37]]],
		["rim", "the edge of a bed pillow, to the right", [[288.75, -48.55], [309.38, -39.02], [319.69, -32.69], [324.84, -28.65], [324.84, -13.84], [319.69, -8.43], [309.38, 0.28], [288.75, 13.71]]],
		["nose", "the seam of a bed pillow, to the right", [[324.84, -28.65], [330.0, -22.0], [324.84, -13.84]]]
	]

	function pillow_build(c, P) {
		// the outline above, stretched to the box (u = x / 660 mm, v = y / 120 mm): the middle piece is the body, and each of the other four is there twice (right and left, welded to it)
		const W = P.width
		const H = P.height
		const D = P.depth
		const sx = W / 0.66
		const sy = H / 0.12
		const parts = []
		for (const [name, words, pts] of PILLOW_PIECES) {
			if (name === "body") {
				parts.push([name, words, _mmpts(pts, 0, 0, sx, sy), D])
				continue
			}
			parts.push([`${name}-r`, words, _mmpts(pts, 0, 0, sx, sy), D])
			parts.push([`${name}-l`, words.replaceAll("right of", "left of").replaceAll("to the right", "to the left"), _mmpts([...pts].reverse().map(([x, y]) => [-x, y]), 0, 0, sx, sy), D])
		}
		_compound(c, parts, P.mass, "fabric", "#eef2f7")
	}
	_box("pillow", "Pillow", 0.66, 0.12, 0.51, 0.60, "foam", "a bed pillow",
		["cushion", "bed", "soft", "padding", "bedding", "squishy", "foam"],
		"A bed pillow: big, light and dead soft, flat underneath and domed on top.",
		"A standard bed pillow, 20 × 26 in (508 × 660 mm), about 120 mm thick; 600 g with polyester fill (provisional). Seen from the side its outline is a lens: flat " +
		"underneath for 500 mm so it lies without rocking, widest at the seam round the edge (38 mm up from the bottom), a domed crown above it, and a crease where the two sides meet " +
		"(nine convex pieces welded together; the bedding is soft, so the real one flattens more when pressed).",
		{ look: "fabric", color: "#eef2f7", builder: pillow_build, mins: { width: 0.2, height: 0.04 } })
	function duck_build(c, P) {
		// side view (mm, facing right; 76 × 65): the outline of the 3D model (an implicit surface, see web/models/everyday-b-small.js) as five convex pieces that never overlap (pieces that overlapped
		// pushed on each other for ever), each within about 0.8 mm of it: the lower body with its broad flat belly (31 mm), the upper body and back, the upturned
		// tail, the round head (it takes the chin) and the flaring bill
		const W = P.width
		const H = P.height
		const D = P.depth
		const sx = W / 0.076
		const sy = H / 0.065
		const pts = (p) => _mmpts(p, 38, 32.5, sx, sy)
		const k = D / 0.058
		const low = [[14.7, 0], [45.75, 0], [52, 4.25], [56.7, 10.5], [59.12, 18], [2.16, 18], [4.25, 10.93], [8.36, 5]]
		const up = [[2.16, 18], [59.12, 18], [58.29, 30], [57.33, 38], [33, 45.92], [10, 41.54], [2.23, 34.25]]
		const tail = [[2.23, 34.25], [10, 41.54], [3.92, 44.75], [1.73, 44.25], [0.61, 42.25]]
		const head = [[33, 45.92], [57.33, 38], [62.2, 44.4], [63, 51.4], [61.33, 58], [55.17, 63.75], [46.5, 64.66], [39.01, 60]]
		const bill = [[62.2, 44.4], [66.5, 43.35], [72.5, 44], [75.5, 45.4], [76.3, 47.1], [74.5, 49.4], [70, 50.6], [63, 51.4]]
		// The lower body is the main solid (it is what lands on the table) and every other piece is welded to it directly: a longer chain of welds takes a landing badly. Two pieces that
		// touch along an edge and are not welded to each other (the upper body and the tail, the upper body and the head, the head and the bill) are held 1.2 mm apart along it (gap=:
		// the cracks, inside the 2 mm of skin a polygon has, are sealed to anything else), so the contact skin of the two does not push them against their welds for ever
		_compound(c, [["body", "the lower body of a rubber duck", pts(low), 0.052 * k],
			["body-up", "the back and chest of a rubber duck", pts(up), 0.052 * k],
			["tail", "the upturned tail of a rubber duck", pts(tail), 0.018 * k],
			["head", "the head of a rubber duck", pts(head), 0.027 * k],
			["bill", "the bill of a rubber duck", pts(bill), 0.020 * k]], P.mass, "rubber", "#f5d21f", { gap: 0.0012 })
	}
	_box("rubber-duck", "Rubber duck", 0.076, 0.065, 0.058, 0.040, "vinyl rubber", "a rubber duck",
		["duck", "bath toy", "yellow", "toy", "squeaky", "bathtub", "ducky"],
		"A bath duck: a hollow vinyl toy, soft and light, with a round head, a flared bill and an upturned tail.",
		"A classic 3 in (76 mm) vinyl duck: 76 × 65 × 58 mm, about 40 g (provisional; ducks differ). Five welded solids that follow the duck's side outline to under 1 mm, never overlap and are held 1.2 mm apart where two of them would touch (so they do not creep against their welds): " +
		"lower body with a broad flat belly (31 mm of its 59 mm length, 52 mm wide), upper body, upturned tail (18 mm wide), head with the chin (27 mm) and bill (20 mm); the weight is shared by their volume.",
		{ look: "rubber", color: "#f5d21f", builder: duck_build, mins: { width: 0.02, height: 0.018 } }) // smaller and the tail's shortest sides would be under the engine's 0.5 mm
	function sneaker_build(c, P) {
		// side view (mm, toe to the right): the forefoot with its toe spring and the lace area up to the tongue, and the heel with its collar dip between them
		const W = P.width
		const H = P.height
		const D = P.depth
		const pts = (p) => _mmpts(p, 150, 55, W / 0.30, H / 0.11)
		const fore = [[80, 0], [245, 0], [300, 18], [297, 34], [255, 58], [190, 88], [130, 110], [80, 86]]
		const heel = [[30, 0], [80, 0], [80, 86], [34, 100], [10, 92], [0, 52], [2, 14]]
		_compound(c, [["fore", "the forefoot and laces of a sneaker", pts(fore), D],
			["heel", "the heel and collar of a sneaker", pts(heel), div(0.078 * D, 0.105)]], P.mass, "fabric", "#3d5a80")
	}
	_box("sneaker", "Sneaker", 0.30, 0.11, 0.105, 0.30, "rubber & fabric", "a sneaker",
		["shoe", "trainer", "boot", "footwear", "running shoe", "kicks", "foot"],
		"One running shoe: a toe spring, the dip of the collar between tongue and heel, grippy sole; it lands with a flop.",
		"An adult running shoe, US men's 9: about 300 × 110 × 105 mm, 300 g (makers list 250-320 g; provisional). Two welded solids: the forefoot up to the tongue and the heel " +
		"(78 mm wide), with the collar dip between; the weight is shared by their volume. Up to 4 times its size (1.2 m long): the engine buoys up every solid by the air its " +
		"whole outline would hold, and a bigger shoe of the stated 300 g would weigh less than that air and float off (a real shoe is open; enlarged, it would weigh more).",
		{ color: "#3d5a80", builder: sneaker_build, maxes: { width: 1.2, height: 0.44, depth: 0.42 } })
}

// ---------------------------------------------------------------- rolling things: a cylinder seen end-on, inertia ½ m r² (1 for a thin shell)
function _roller(key, name, D, L, hole, mass, material, words, tags, description, source, { look = null, color = null, facts = null } = {}) {
	function build(c, P) {
		const d = P.diameter
		let k
		if (hole === null) k = 0.5
		else {
			const q = div(pymin(P.hole, 0.98 * d), d)
			k = 0.5 * (1 + q * q) // (** 2: see the note at the top)
		}
		_cylinder(c, "body", d, P.length, P.mass, k, words, look, color)
	}
	const props = [_len("diameter", "Diameter", D), _len("length", "Length (front to back)", L, "Only for the 3D look; the weight is set by Weight")]
	if (hole !== null) props.push(new Prop("hole", "Hole diameter", hole, 0.0, 0.5, 0.001, "m", "The empty core: more hole means more of the weight is out at the rim"))
	props.push(_mass(mass))
	_claim(key, [[{}, mass]])
	register(new ItemType(key, name, CAT, build, {
		material, materials: [material], anchor: "its centre", props, tags: [...tags, "rolling", "roller", "cylinder"],
		description, source, edit: [{ kind: "radius", prop: "diameter" }],
		facts: truthy(facts) ? facts : `${_mm(D)} mm across, ${_mm(L)} mm long · ${_kg(mass)}`
	}))
}

function _rollers() {
	_roller("toilet-paper-roll", "Toilet paper roll", 0.110, 0.100, 0.040, 0.100, "tissue paper", "a toilet paper roll",
		["loo roll", "bathroom tissue", "toilet roll", "tp", "paper roll", "tissue", "bog roll"],
		"A roll of toilet paper on its side: it rolls like a hollow cylinder, so a bit slower than a solid one.",
		"A standard bath-tissue roll: about 110 mm across and 100 mm wide (4.5 × 4 in sheets), 40 mm cardboard core; about 100 g (product specs; provisional). " +
		"Inertia ½ m (R² + r²) of a hollow cylinder, 0.57 m R².", { look: "paper" })
	_roller("paper-towel-roll", "Paper towel roll", 0.120, 0.280, 0.045, 0.230, "tissue paper", "a roll of paper towels",
		["kitchen roll", "paper towels", "paper roll", "kitchen", "towel", "tissue"],
		"A full roll of kitchen paper on its side: it rolls like a hollow cylinder.",
		"A full-size household roll: 11 in (279 mm) wide, about 120 mm across, 45 mm core; about 230 g (provisional). Inertia ½ m (R² + r²).", { look: "paper" })
	_roller("cardboard-tube", "Cardboard tube", 0.054, 0.300, 0.051, 0.052, "cardboard", "a cardboard tube",
		["tube", "mailing tube", "wrapping paper tube", "poster tube", "pipe", "hollow", "paper", "pole"],
		"A thin cardboard tube: nearly all its weight is at the rim, so it rolls slowly (inertia 0.95 m r²).",
		"A mailing tube: 54 mm outside, 1.5 mm wall, 300 mm long; paperboard about 700 kg/m³ gives 52 g. Inertia ½ m (R² + r²).")
	_roller("coin-edge", "Coin, on its edge", 0.02426, 0.00175, null, 0.00567, "cupronickel", "a quarter standing on its edge",
		["quarter", "money", "cash", "change", "wheel", "disc", "25 cents", "currency", "us coin", "hoop"],
		"A US quarter on its edge, seen face-on: it rolls like a solid disc. (Lay it flat and it slides.)",
		"US Mint specification for the quarter dollar: 24.26 mm across, 1.75 mm thick, 5.670 g. Inertia ½ m r² (solid disc). Bounce, friction and rolling resistance provisional.",
		{ facts: "24.26 mm · 1.75 mm thick · 5.67 g" })
}

// ---------------------------------------------------------------- the egg's side outline
// The true egg curve (Hugelschaffer's: 57 x 44 mm, widest 4.5 mm blunt-side of the middle), mm, blunt end left: (x, half-width) every 5 degrees of x = -28.5 cos t.
const EGG_CURVE = [[-28.5, 0.0], [-28.3915, 2.275], [-28.067, 4.5213], [-27.5289, 6.7109], [-26.7812, 8.8177], [-25.8298, 10.8175], [-24.6817, 12.6895], [-23.3458, 14.4155],
	[-21.8323, 15.981], [-20.1525, 17.3748], [-18.3194, 18.589], [-16.3469, 19.6186], [-14.25, 20.4614], [-12.0446, 21.1176], [-9.7476, 21.5895], [-7.3763, 21.8809],
	[-4.949, 21.9972], [-2.4839, 21.9447], [0.0, 21.7308], [2.4839, 21.3632], [4.949, 20.8501], [7.3763, 20.2003], [9.7476, 19.4225], [12.0446, 18.5256],
	[14.25, 17.5183], [16.3469, 16.4098], [18.3194, 15.2087], [20.1525, 13.9239], [21.8323, 12.564], [23.3458, 11.1377], [24.6817, 9.6535], [25.8298, 8.1198],
	[26.7812, 6.545], [27.5289, 4.9374], [28.067, 3.3052], [28.3915, 1.6567], [28.5, 0.0]]
// the middle piece (mm on the 57 x 44 mm egg): each side's resting flat runs from x -3.34 to 10.27 parallel to the curve where a real egg rests (8.85 degrees off level, the curve's normal
// through the centre of gravity), 0.52 mm inside it at that point, then two chords towards the tip; its left side is inside the ball
const EGG_MID = [[-3.338, -21.755], [10.274, -19.636], [13.597, -18.325], [17.404, -16.134], [17.404, 16.134], [13.597, 18.325], [10.274, 19.636], [-3.338, 21.755]]
// the tip piece: its point 0.4 mm past the curve's and its neighbours 3.24 mm either side 0.95 mm back from it, so that stood on its point the egg does not rest on a point and a
// neighbour together (the engine counts a corner up to 0.5 mm clear of the table as touching it): the point is placed for that on any size of egg (see _egg_outline)
const EGG_TIP = [[17.404, -16.134], [24.832, -9.862], [27.95, -3.24], [28.9, 0.0], [27.95, 3.24], [24.832, 9.862], [17.404, 16.134]]
// the cap piece's corners round the blunt end, with their places on the curve (degrees of t): pulled inside the ball wherever the ball follows the curve past them
const EGG_CAP = [[-15.895, 20.165], [-25.639, 12.093], [-28.569, 0.0], [-25.639, -12.093], [-15.895, -20.165]]
const EGG_CAP_T = [56.4, 27.7, 0.0, 27.7, 56.4]
const EGG_CG = -1.7961 // mm: the centroid of the egg's volume (the curve turned about its axis), towards the blunt end
const EGG_I = [96.591, 162.914] // mm^2 per kg: its moment of inertia about a crosswise axis through that centroid, the part across (r^2 / 4) and the part along it ((x - xc)^2)
const EGG_TIP_SHARE = 0.0789 // of the weight: the egg's volume past x 17.4 mm (the tip piece)
const EGG_CAP_SHARE = 0.03
const EGG_SLIT = 1.2 // mm between two pieces that are not welded to each other: closer, they would push on each other through the 2 mm of contact skin
const EGG_SKIN = 1.0 // mm: a polygon touches 1 mm further out than its outline (the engine's skin) and a ball does not, so the ball is made that much bigger than the curve
const EGG_MIN_WIDTH = 0.55 // of the length: the narrowest egg built (past the most elongated birds' eggs; see build_egg)
// 1/s: a raw egg's liquid insides lag its shell as it rocks and slow its turning, dω/dt = -2ω (the engine's angularDamping on its root; a crude estimate: a 2 mm
// boundary layer of white in a 22 mm shell at the ~16 rad/s of its rocking, provisional). Round eggs then settle in 2 to 7 s instead of 3 to 12 s; a hen's egg,
// whose rests are corners, still settles in 0.35 to 0.6 s from 8 degrees off its rest
const EGG_RAW = 2.0

/** math.sqrt(x): a negative x is a ValueError, as in Python (JavaScript gives NaN). */
function msqrt(x) {
	if (x < 0) throw new ValueError("math domain error")
	return Math.sqrt(x)
}

/** a[i] with Python's negative indices (a[-1] is the last). */
const at_ = (a, i) => a[i < 0 ? a.length + i : i]

/** max(range(n), key=f) / min(range(n), key=f): the first index of the largest / smallest key. */
function argmax(n, f) {
	let best = 0
	let bv = f(0)
	for (let i = 1; i < n; i++) {
		const v = f(i)
		if (v > bv) {
			best = i
			bv = v
		}
	}
	return best
}
function argmin(n, f) {
	let best = 0
	let bv = f(0)
	for (let i = 1; i < n; i++) {
		const v = f(i)
		if (v < bv) {
			best = i
			bv = v
		}
	}
	return best
}

/** The half-width (mm) of the true 57 x 44 mm egg curve at x (mm from the middle, the blunt end negative). */
function _egg_prof(x) {
	return 22.0 * msqrt(pymax(0.0, div(3249.0 - 4 * x * x, 3249.0 + 36.0 * x + 81.0)))
}

/** The convex hull of points [(x, y)], counter-clockwise, with no point on a side. */
function _hull(pts) {
	// sorted(set(pts)): equal points once (the first of them), in order of x, then y
	const uniq = []
	for (const p of pts) if (!uniq.some((q) => q[0] === p[0] && q[1] === p[1])) uniq.push(p)
	uniq.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
	const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
	const lo = []
	const up = []
	for (const q of uniq) {
		while (lo.length >= 2 && turn(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop()
		lo.push(q)
	}
	for (let i = uniq.length - 1; i >= 0; i--) {
		const q = uniq[i]
		while (up.length >= 2 && turn(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop()
		up.push(q)
	}
	return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

/** A convex outline with no side shorter than `side`: of the shortest side's two corners, the one whose leaving out cuts off less is left out, until no side is shorter. */
function _tidy(pts, side) {
	pts = [...pts]
	const dst = (a, b) => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]))
	while (pts.length > 3) {
		const n = pts.length
		const k = argmin(n, (i) => dst(pts[i], pts[(i + 1) % n]))
		if (dst(pts[k], pts[(k + 1) % n]) >= side) break
		const cut = (i) => {
			const p0 = at_(pts, i - 1)
			const p2 = pts[(i + 1) % n]
			return Math.abs((pts[i][0] - p0[0]) * (p2[1] - p0[1]) - (pts[i][1] - p0[1]) * (p2[0] - p0[0]))
		}
		pts.splice(cut(k) <= cut((k + 1) % n) ? k : (k + 1) % n, 1)
	}
	return pts
}

/** A polygon's area (m^2), centroid x (m) and moment of inertia about its centroid per kg (m^2), as the engine has them. */
function _plane(pts) {
	const n = pts.length
	let a = 0.0
	let cx = 0.0
	let cy = 0.0
	let ixx = 0.0
	let iyy = 0.0
	for (let k = 0; k < n; k++) {
		const [x0, y0] = pts[k]
		const [x1, y1] = pts[(k + 1) % n]
		const w = x0 * y1 - x1 * y0
		a += w
		cx += (x0 + x1) * w
		cy += (y0 + y1) * w
		ixx += (y0 * y0 + y0 * y1 + y1 * y1) * w
		iyy += (x0 * x0 + x0 * x1 + x1 * x1) * w
	}
	a /= 2
	cx = div(cx, 6 * a)
	cy = div(cy, 6 * a)
	return [a, cx, div(ixx + iyy, 12 * a) - cx * cx - cy * cy]
}

const EGG_GROW = 0.5 // mm: a ball of an egg made of balls is that much bigger than the curve it follows (the engine rests a ball 0.5 mm into the table's 1 mm skin, and
// draws the tabletop at that skin: the shell then sits on it)

/** The scaled curve's upper point at X (mm along the 57 x 44 mm egg's axis, the blunt end at -28.5): (x, y) mm. */
function _egg_pt(X, sx, sy) {
	return [X * sx, _egg_prof(X) * sy]
}

/** The scaled curve's upper half, blunt end first: 2m + 1 points evenly in the half-angle t (x = -28.5 cos t, through tan(t/2), so only + - x / and sqrt), each with its
 *  outward unit normal and its support (the distance from the centre of gravity to the tangent line there): [(x, y, nx, ny, h)] mm. */
function _egg_samples(sx, sy, m) {
	const g = EGG_CG * sx
	const out = []
	for (let j = 0; j < 2 * m + 1; j++) {
		const u = (j <= m ? j : 2 * m - j) / m
		let c = (1.0 - u * u) / (1.0 + u * u)
		const s = (2.0 * u) / (1.0 + u * u)
		if (j > m) c = -c
		const D = 3330.0 - 1026.0 * c
		const rD = msqrt(D)
		const x = -28.5 * sx * c
		const y = div(1254.0 * sy * s, rD)
		const dx = 28.5 * sx * s
		const dy = div(1254.0 * sy * (c * D - 513.0 * s * s), D * rD)
		const L = Math.sqrt(dx * dx + dy * dy)
		const nx = div(-dy, L)
		const ny = div(dx, L)
		out.push([x, y, nx, ny, (x - g) * nx + y * ny])
	}
	return out
}

/** A root of f between lo and hi, where f has different signs (60 halvings). */
function _bisect(f, lo, hi) {
	let flo = f(lo)
	for (let i = 0; i < 60; i++) {
		const mid = 0.5 * (lo + hi)
		const fm = f(mid)
		if ((fm < 0) === (flo < 0)) {
			lo = mid
			flo = fm
		} else hi = mid
	}
	return 0.5 * (lo + hi)
}

/** Where the scaled curve's normal passes through its centre of gravity off the axis: [(X, "rest" | "top")], blunt end first (X as in _egg_pt). There the egg can balance:
 *  a rest (the distance to the centre of gravity is least) or a top (most). With X along the axis, that is a root of the cubic (X - CG)(3330 + 36X)^2 - 242 k (144X^2 + 26640X
 *  + 116964), k = (sy / sx)^2: the side rest of a long egg; also the shoulder's top of a round one (width over 0.815 of the length: its blunt end can stand); only the top of a
 *  wide one (over 1.19: it lies on either end; never built, as no egg is wider than it is long). */
function _egg_crit(sx, sy) {
	const k = div(sy * sy, sx * sx)
	const f = (X) => {
		const D = 3330.0 + 36.0 * X
		return (X - EGG_CG) * D * D - 242.0 * k * (144.0 * X * X + 26640.0 * X + 116964.0)
	}
	const out = []
	let a = -28.5
	let fa = f(-28.5)
	for (let i = 1; i < 97; i++) {
		const b = -28.5 + (57.0 * i) / 96
		const fb = f(b)
		if ((fa < 0) !== (fb < 0)) out.push([_bisect(f, a, b), fa < 0 ? "rest" : "top"])
		a = b
		fa = fb
	}
	return out
}

/** (the blunt end is a rest, the pointed end is a rest) for the scaled curve: the curve there is flatter than the centre of gravity is high. */
function _egg_ends_rest(sx, sy) {
	const k = div(sy * sy, sx * sx)
	const fb = (-28.5 - EGG_CG) * 2304.0 * 2304.0 - 242.0 * k * (116964.0 - 759240.0 + 116964.0)
	const ft = (28.5 - EGG_CG) * 4356.0 * 4356.0 - 242.0 * k * (116964.0 + 759240.0 + 116964.0)
	return [fb > 0, ft < 0]
}

/** The side rest of the scaled curve, or null: (point, unit normal, distance from the centre of gravity), mm. */
function _egg_side_rest(sx, sy) {
	for (const [X, kind] of _egg_crit(sx, sy)) {
		if (kind === "rest") {
			const g = EGG_CG * sx
			const [px, py] = _egg_pt(X, sx, sy)
			const r = Math.sqrt((px - g) * (px - g) + py * py)
			return [[px, py], [div(px - g, r), div(py, r)], r]
		}
	}
	return null
}

/** A ball whose centre is on the line from the centre of gravity along u and whose support in direction us is t (it touches the line the side rest lies on), fitted to the
 *  support of the curve at the samples `own`: h(n) = t + lam (u.n - u.us). Weighted least squares whose weights grow on the worst misses (so it tends to the smallest worst
 *  miss), then lam held where the ball stands out of the curve nowhere (over `every`) by more than tol. -> (lam, worst miss over own), mm. */
function _egg_fit_line(own, every, u, us, t, tol) {
	const uus = u[0] * us[0] + u[1] * us[1]
	const a = own.map((q) => u[0] * q[2] + u[1] * q[3] - uus)
	const b = own.map((q) => q[4] - t)
	let w = own.map(() => 1.0)
	let lam = 0.0
	for (let it = 0; it < 4; it++) {
		let num = 0.0
		let den = 0.0
		for (let i = 0; i < w.length; i++) {
			num += w[i] * a[i] * b[i]
			den += w[i] * a[i] * a[i]
		}
		lam = div(num, den)
		const res = a.map((ai, i) => Math.abs(lam * ai - b[i]))
		const mx = maxOf(res)
		if (mx <= 0.0) break
		w = w.map((wi, i) => wi * (1.0 + 3.0 * (res[i] / mx) * (res[i] / mx)))
	}
	let lo = -1e9
	let hi = 1e9
	for (const q of every) {
		const ai = u[0] * q[2] + u[1] * q[3] - uus
		const lim = q[4] + tol - t
		if (ai > 1e-12) hi = pymin(hi, lim / ai)
		else if (ai < -1e-12) lo = pymax(lo, lim / ai)
	}
	lam = pymin(pymax(lam, lo), hi)
	return [lam, maxOf(a.map((ai, i) => Math.abs(lam * ai - b[i])))]
}

/** A ball centred on the axis, its centre lam from the centre of gravity, radius R: h(n) = R + lam nx, fitted as _egg_fit_line, then R lowered so it stands out of the
 *  curve nowhere by more than tol. -> (lam, R, worst miss over own), mm. */
function _egg_fit_axis(own, every, tol) {
	let w = own.map(() => 1.0)
	let R = 0.0
	let lam = 0.0
	for (let it = 0; it < 4; it++) {
		let s0 = 0.0
		let s1 = 0.0
		let s2 = 0.0
		let b0 = 0.0
		let b1 = 0.0
		for (let i = 0; i < w.length; i++) {
			const wi = w[i]
			const q = own[i]
			s0 += wi
			s1 += wi * q[2]
			s2 += wi * q[2] * q[2]
			b0 += wi * q[4]
			b1 += wi * q[2] * q[4]
		}
		const det = s0 * s2 - s1 * s1
		R = div(b0 * s2 - b1 * s1, det)
		lam = div(s0 * b1 - s1 * b0, det)
		const res = own.map((q) => Math.abs(R + lam * q[2] - q[4]))
		const mx = maxOf(res)
		if (mx <= 0.0) break
		w = w.map((wi, i) => wi * (1.0 + 3.0 * (res[i] / mx) * (res[i] / mx)))
	}
	R = minOf([R, ...every.map((q) => q[4] + tol - lam * q[2])])
	return [lam, R, maxOf(own.map((q) => Math.abs(R + lam * q[2] - q[4])))]
}

/** A ball anywhere whose support in direction us is t (it touches the line the side rest lies on): h(n) = t + ax (nx - usx) + ay (ny - usy), its centre ax, ay from the
 *  centre of gravity. Weighted least squares as _egg_fit_line. -> (ax, ay, worst miss over own, most it stands out of the curve over every), mm. */
function _egg_fit_through(own, every, us, t) {
	let w = own.map(() => 1.0)
	let ax = 0.0
	let ay = 0.0
	for (let it = 0; it < 4; it++) {
		let a11 = 0.0
		let a12 = 0.0
		let a22 = 0.0
		let b1 = 0.0
		let b2 = 0.0
		for (let i = 0; i < w.length; i++) {
			const wi = w[i]
			const q = own[i]
			const p1 = q[2] - us[0]
			const p2 = q[3] - us[1]
			const r = q[4] - t
			a11 += wi * p1 * p1
			a12 += wi * p1 * p2
			a22 += wi * p2 * p2
			b1 += wi * p1 * r
			b2 += wi * p2 * r
		}
		const det = a11 * a22 - a12 * a12
		ax = div(b1 * a22 - b2 * a12, det)
		ay = div(a11 * b2 - a12 * b1, det)
		const res = own.map((q) => Math.abs(ax * (q[2] - us[0]) + ay * (q[3] - us[1]) - (q[4] - t)))
		const mx = maxOf(res)
		if (mx <= 0.0) break
		w = w.map((wi, i) => wi * (1.0 + 3.0 * (res[i] / mx) * (res[i] / mx)))
	}
	const worst = maxOf(own.map((q) => Math.abs(ax * (q[2] - us[0]) + ay * (q[3] - us[1]) - (q[4] - t))))
	const out = maxOf(every.map((q) => t + ax * (q[2] - us[0]) + ay * (q[3] - us[1]) - q[4]))
	return [ax, ay, worst, out]
}

/** A round egg (its blunt end can stand: width over 0.815 of its length, up to as wide as it is long) as four balls: [(cx, cy, R, mirrored)] mm about its middle (a
 *  mirrored ball has its mirror image below the axis too), the worst miss and the carrier's half size; or null when they cannot follow the curve within 0.6 mm (x the size past 1).
 *  The curve is so nearly a circle about the centre of gravity that a polygon's corners would hold the egg wherever it was set down (the engine counts a corner 0.5 mm clear of the
 *  table as touching it), so it is made of balls, which touch at one point and roll smoothly: two on the axis make the pointed end (the smaller one's top at the tip) and a pair the
 *  shoulders. The pair crosses on the axis at the blunt end, where the egg can stand; the larger tip ball and each shoulder ball touch one line, the side rest's, so the egg lies on
 *  both, tilted exactly as the real one, and nowhere else. Each ball is fitted to its stretch of the curve's support function (near minimax) and kept from standing out of the curve
 *  anywhere; the rest line's inset and where the tip's two balls part are the best of a few. */
function _egg_balls(sx, sy) {
	const s = pymin(sx, sy)
	const tol = 0.5 * pymax(1.0, s)
	const g = EGG_CG * sx
	const a = 28.5 * sx
	const crit = _egg_crit(sx, sy)
	if (!(crit.length === 2 && crit[0][1] === "top" && crit[1][1] === "rest")) return null
	const pm = _egg_pt(crit[0][0], sx, sy)
	const rm = Math.sqrt((pm[0] - g) * (pm[0] - g) + pm[1] * pm[1])
	const um = [div(pm[0] - g, rm), div(pm[1], rm)]
	const [[psx], us, rs] = _egg_side_rest(sx, sy)
	const S = _egg_samples(sx, sy, 40)
	const every = [...S, ...S.map(([x, y, nx, ny, h]) => [x, -y, nx, -ny, h])]
	const tip = S.filter((q) => q[0] >= psx)
	const blunt = S.filter((q) => q[0] <= psx)
	let best = null
	for (const [e, free] of [[0.2, false], [0.35, false], [0.5, false], [0.2, true], [0.35, true], [0.5, true]]) {
		if (free && best !== null && best[0] <= 0.6 * pymax(1.0, s)) break // (the shoulder ball's top where the curve's is, if it fits: it crosses its mirror image further from the axis, a longer blunt end to stand on)
		const t = rs - e * pymax(1.0, s)
		let ax
		let ay
		let eS
		let outS
		if (free) [ax, ay, eS, outS] = _egg_fit_through(blunt, every, us, t)
		else {
			let lS
			;[lS, eS] = _egg_fit_line(blunt, every, um, us, t, tol)
			ax = lS * um[0]
			ay = lS * um[1]
			outS = 0.0
		}
		// the shoulder ball's top between the side rest and the blunt end (it rises from the one and falls to the other), and it stands out of the curve nowhere by more than tol
		if (outS > tol || ay <= 0.0 || ax * us[1] - ay * us[0] >= 0.0) continue
		for (const f of [0.25, 0.4, 0.55]) {
			const xs = psx + f * (a - psx)
			const own2 = tip.filter((q) => q[0] <= xs)
			const own1 = tip.filter((q) => q[0] >= xs)
			if (own1.length < 3 || own2.length < 3) continue
			const [l2, e2] = _egg_fit_line(own2, every, [1.0, 0.0], us, t, tol)
			const [l1, R1, e1] = _egg_fit_axis(own1, every, tol)
			// the tip balls' tops at the tip, and the tip ball under the side rest's line
			if (l2 <= 0.0 || l1 <= 0.0 || R1 + l1 * us[0] > t - 0.05) continue
			const worst = pymax(pymax(pymax(eS, e2), e1), e * pymax(1.0, s))
			if (best === null || worst < best[0]) {
				best = [worst, [[g + l1, 0.0, R1, false], [g + l2, 0.0, t - l2 * us[0], false], [g + ax, ay, t - ax * us[0] - ay * us[1], true]]]
			}
		}
	}
	if (best === null || best[0] > 0.6 * pymax(1.0, s)) return null
	// the carrier: a square about the centre of gravity whose corners stay a margin inside the curve, so that with its 1 mm of skin it never reaches the table before a ball
	// (the balls rest 1 mm further out than the curve's support, and two polygons touch 2 mm apart: 2.5 mm clears that); 5.5 mm on an egg whose support is 11 mm or more, and
	// down to half the support on a smaller one, so that the carrier, the root every ball is welded to, keeps some 5 % of the weight (with the 5.5 mm margin a 14 mm egg's
	// was a 1 mm square of 0.4 %, and its welds flew apart)
	const hmin = minOf(S.map((q) => q[4]))
	return [best[1], best[0], pymax(0.5, (hmin - pymin(5.5, pymax(2.5, 0.5 * hmin))) * 0.7071)]
}

// the outline is worked out again only for a new size (a drag rebuilds the scene many times a second): fn(sx, sy), remembered as Python's _EGG_CACHE does
const _EGG_CACHE = new Map()

function _egg_cached(fn, name, sx, sy) {
	const key = `${name} ${sx} ${sy}`
	if (!_EGG_CACHE.has(key)) {
		if (_EGG_CACHE.size > 512) _EGG_CACHE.clear()
		_EGG_CACHE.set(key, fn(sx, sy))
	}
	return _EGG_CACHE.get(key)
}

function _egg_balls_cached(sx, sy) {
	return _egg_cached(_egg_balls, "_egg_balls", sx, sy)
}

/** A ball welded to another solid of this item, its centre at `at` in the parent's frame (m). */
function _weld_ball(c, part, parent, r, at, material, look, words, inertia) {
	const s = {
		kind: c.kind, id: `${c.item.id}/${part}`, words, item: c.item.id, look,
		body: { kind: "ball", radius: pyRound(r, 5), inertia }, material,
		at: { x: pyRound(at[0], 5), y: pyRound(at[1], 5) }, parent, placeholder: { fill: lookFill(look) },
		render: { kind: "procedural", shade: lookShade(look) }, depth: 4
	}
	c.sb.solids.push(s)
}

/** The weight shares closest to `base` (each change weighted by its base) that meet the linear conditions rows . shares = rhs (the total, the centre of gravity, ...). */
function _shares(base, rows, rhs) {
	const n = base.length
	const k = rows.length
	const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i)
	const M = range(0, k).map((i) => range(0, k).map((j) => pySum(range(0, n).map((q) => rows[i][q] * base[q] * rows[j][q]))))
	const v = range(0, k).map((i) => rhs[i] - pySum(range(0, n).map((q) => rows[i][q] * base[q])))
	// Gaussian elimination with partial pivoting
	for (let col = 0; col < k; col++) {
		let piv = col
		for (let r_ = col + 1; r_ < k; r_++) if (Math.abs(M[r_][col]) > Math.abs(M[piv][col])) piv = r_
		;[M[col], M[piv]] = [M[piv], M[col]]
		;[v[col], v[piv]] = [v[piv], v[col]]
		for (let r_ = col + 1; r_ < k; r_++) {
			const f = div(M[r_][col], M[col][col])
			for (let q = col; q < k; q++) M[r_][q] -= f * M[col][q]
			v[r_] -= f * v[col]
		}
	}
	const lam = range(0, k).map(() => 0.0)
	for (let col = k - 1; col > -1; col--) lam[col] = div(v[col] - pySum(range(col + 1, k).map((q) => M[col][q] * lam[q])), M[col][col])
	return range(0, n).map((q) => base[q] * (1.0 + pySum(range(0, k).map((i) => lam[i] * rows[i][q]))))
}

/** The egg made of balls (_egg_balls): the carrier at the item's centre (the root: the 3D shell is drawn on it), the balls welded to it, and between every two balls that overlap
 *  a hidden pin, which adds nothing to the welds but keeps the two from colliding with each other (the engine collides two solids of one item unless a joint joins them).
 *  The balls are where the fit puts them, mirror images about the axis; the centre of gravity is 0.08 mm (x the size) off the axis, towards the first shoulder ball, so that stood
 *  exactly on its point (on either of the pointed end's balls, or on both) the egg does not balance there, it topples, soon enough that the engine never lets it fall asleep there.
 *  (Its rests are where two balls cross, so this does not move them.) */
/** The egg's root solid's angular damping (EGG_RAW, a raw egg's liquid insides), when it moves. */
function _raw(c) {
	return c.kind === "dynamic" ? { angularDamping: EGG_RAW } : {}
}

function _egg_build_balls(c, P, sx, sy, fit) {
	const [balls, , half] = fit
	const m = P.mass
	const d = P.width
	const g = EGG_CG * sx
	const dy = 0.08 * pymin(sx, sy)
	const B = []
	for (const [x, y, r, mirrored] of balls) {
		B.push([x, y, r])
		if (mirrored) B.push([x, -y, r])
	}
	const names = B.map((_, i) => `egg-b${i + 1}`)
	const Rr = B.map((b) => b[2] + EGG_GROW)
	const sq = [[g - half, -half], [g + half, -half], [g + half, half], [g - half, half]]
	const area = 4 * half * half
	// weights: the balls by their volume, the carrier by its (a prism); then the total and the centre of gravity are the real egg's, and the balls' own inertia makes up its moment
	let base = [...Rr.map((r) => r * r * r), (area * d * 1000 * 0.75) / Math.PI]
	const tot = pySum(base)
	base = base.map((b) => div(b, tot))
	const sh_ = _shares(base, [base.map(() => 1.0), [...B.map((b) => b[0]), g], [...B.map((b) => b[1]), 0.0]], [1.0, g, dy])
	const Ie = sy * sy * EGG_I[0] + sx * sx * EGG_I[1]
	const Ip = pySum(B.map((b, i) => sh_[i] * ((b[0] - g) * (b[0] - g) + b[1] * b[1]))) + (sh_[sh_.length - 1] * 2 * half * half) / 3 - dy * dy
	const k = pymin(pymax(div(Ie - Ip, pySum(Rr.map((r, i) => sh_[i] * r * r))), 0.05), 2 / 3)
	const carrier = c.poly("egg", sq.map(([x, y]) => [x / 1000, y / 1000]), d, 0.0, 0.0, {
		material: c.mat({ density: pyRound(div(m * sh_[sh_.length - 1], area * 1e-6 * d), 4) }), look: "eggshell", words: "an egg", ..._raw(c)
	})
	names.forEach((name, i) => {
		const b = B[i]
		const r = Rr[i]
		_weld_ball(c, name, carrier, r / 1000, [b[0] / 1000, b[1] / 1000], c.mat({ density: pyRound(div(m * sh_[i], ((4 / 3) * Math.PI) * cube(r / 1000)), 4) }), "eggshell", "an egg",
			pyRound(k, 4))
	})
	let n = 0
	for (let i = 0; i < B.length; i++) {
		for (let j = i + 1; j < B.length; j++) {
			const [xi, yi] = B[i]
			const [xj, yj] = B[j]
			if (Math.sqrt((xi - xj) * (xi - xj) + (yi - yj) * (yi - yj)) < Rr[i] + Rr[j] + 2.0) {
				n += 1
				const mx = 0.5 * (xi + xj)
				const my = 0.5 * (yi + yj)
				c.joint("pin", `egg-hold${n}`, {
					a: names[i], b: names[j], anchorA: [(mx - xi) / 1000, (my - yi) / 1000], anchorB: [(mx - xj) / 1000, (my - yj) / 1000],
					render: { hinge: "none" }
				})
			}
		}
	}
}

/** The egg's pieces (m, about its middle) at sx, sy times the 57 x 44 mm egg: (middle, tip, cap, ball centre x, ball radius). The blunt end is a ball, because a polygon's
 *  corner there would hold the egg up on its end: a smooth blunt end is curved more tightly (23.9 mm) than the 26.7 mm to the centre of gravity, so a real egg topples off it, but a
 *  chord near the curve holds the centre of gravity whenever the curve's radius is over half that. The ball is the largest circle that touches the tip (0.1 mm in) and stays inside
 *  the curve, less 0.11 mm: on the 57 x 44 mm egg it follows the curve within 0.32 mm for 80 degrees round each side, so the egg rolls off its end and along its blunt side as a
 *  smooth egg does. On a longer or flatter egg it follows the curve less far; there the cap piece's corners make the outline (each pulled inside the ball wherever the ball still
 *  follows the curve 0.8 mm past it). */
function _egg_outline(sx, sy) {
	const s = pymin(sx, sy)
	const sc = (pts) => pts.map(([x, y]) => [(x * sx) / 1000, (y * sy) / 1000])
	const xt = -0.0284 * sx
	const radii = []
	for (const [x, y] of EGG_CURVE) {
		const u = (x * sx) / 1000 - xt
		const v = (y * sy) / 1000
		if (u > 1e-12) radii.push(div(u * u + v * v, 2 * u))
	}
	let R = minOf(radii) - 0.00011 * s
	// (and no bigger than leaves the resting flat standing 0.15 mm clear of it where the egg lies on the flat: a rounder egg's ball would otherwise reach past the flat)
	const rest = _egg_side_rest(sx, sy)
	let ux
	let uy
	let gx
	let dist_
	if (rest !== null) {
		let r
		;[, [ux, uy], r] = rest
		gx = (EGG_CG * sx) / 1000
		dist_ = (r - 0.52 * msqrt(sx * sy)) / 1000
		R = pymin(R, div(dist_ - 0.00015 * s - (xt - gx) * ux, 1 + ux))
	}
	const cb = xt + R
	let cover = 0.0
	for (let k = 0; k < EGG_CURVE.length; k++) {
		const [x, y] = EGG_CURVE[k]
		const u = (x * sx) / 1000 - cb
		const v = (y * sy) / 1000
		if (Math.sqrt(u * u + v * v) - R > 0.0008 * s) break
		cover = 5.0 * k
	}
	const slit = (EGG_SLIT / 1000) * pymax(1.0, sx)
	// the resting flat each side: the 57 x 44 mm egg's, stretched, then turned to lie square to the true curve's normal through the centre of gravity (where a real egg of this
	// shape rests: the stretch alone would tilt it up to 2 degrees off) and set 0.52 mm x sqrt(sx sy) inside the curve there (0.52 mm on the 57 x 44 mm egg, where it is unchanged)
	let m_ = sc(EGG_MID)
	if (rest !== null) {
		for (const i of [6, 7]) {
			const [qx, qy] = m_[i]
			const f = (qx - gx) * ux + qy * uy - dist_
			m_[i] = [qx - f * ux, qy - f * uy]
		}
		const n0 = [m_[7][0], -m_[7][1]]
		const n1 = [m_[6][0], -m_[6][1]]
		m_[0] = n0
		m_[1] = n1
	}
	// the flat's blunt-side corners under the ball: in the direction of each corner from the centre of gravity the ball must reach 0.05 mm past it, or the corner stands out as a
	// top of its own beside the ball (by microns, but a top with a hollow next to it); where it does not, the corner is drawn in toward the centre of gravity until it does (a
	// hundredth of a millimetre or so, near the width where the blunt end begins to stand; the ball sits a hair above the axis, so the two corners can differ)
	const off = 0.0001 * s
	gx = (EGG_CG * sx) / 1000
	for (const a_ of [7, 0]) {
		const [x, y] = m_[a_]
		const r = Math.sqrt((x - gx) * (x - gx) + y * y)
		const short = r - (R + div((cb - gx) * (x - gx) + off * y, r)) + 0.00005 * s
		if (cover >= 80.0 && 0 < short && short < 0.00025 * s) {
			// (only where the ball, not the cap, is the corner's neighbour)
			const f = div(r - short, r)
			m_[a_] = [gx + (x - gx) * f, y * f]
		}
	}
	const fa = m_[7] // the flat's blunt-side corners (the cap stands a slit off them)
	const fb = m_[0]
	m_ = _hull(m_) // (on a very long, thin egg the turned flat can leave a corner inside: it goes)
	const right = argmax(m_.length, (i) => m_[i][0] + m_[(i + 1) % m_.length][0])
	const mid = _tidy(_inset_edge(m_, right, slit), 0.0007) // cut back from the tip piece (its right side)
	const xr = pymin(fa[0], fb[0]) - slit // the cap's right side, a slit short of the middle piece, 0.3 mm inside the curve
	let yr = (_egg_prof(div(xr * 1000, sx)) * sy) / 1000 - 0.0003 * s
	// (and no higher than the resting flat's line there, so that its corner never stands out past the flat)
	if (rest !== null) {
		;[, [ux, uy]] = rest
		yr = pymin(yr, fa[1] - div((xr - fa[0]) * ux, uy) - 0.00005 * s)
	}
	// a corner the ball covers goes 0.8 mm inside it (more than the 0.5 mm within which the engine counts a corner as touching, so it never props the egg up beside the ball)
	const pin = pymax(0.0003 * s, 0.0008)
	const cap = []
	const corners = [[xr, yr], ...sc(EGG_CAP), [xr, -yr]]
	const ts = [80.0, ...EGG_CAP_T, 80.0]
	for (let i = 0; i < corners.length; i++) {
		let [x, y] = corners[i]
		const t = ts[i]
		if (cover >= (40 < t && t < 80 ? 75.0 : t <= 40 ? t + 10.0 : 80.0)) {
			const u = Math.sqrt((x - cb) * (x - cb) + y * y)
			const f = div(R - pin, u)
			x = cb + (x - cb) * f
			y = y * f
		}
		cap.push([x, y])
	}
	// the tip's point far enough past its neighbours that the egg cannot stand on it: 0.6 mm plus the drop of a neighbour as the egg leans over onto it
	const tip = sc(EGG_TIP)
	tip[3] = [pymax(tip[3][0], tip[2][0] + 0.0006 + div(tip[2][1] * tip[2][1], 0.0307 * sx)), 0.0]
	// rounded to the engine's 5 decimals first, then the hull (rounding a corner that is all but on its neighbours' line could turn it clockwise: 25.4 x 14 mm did)
	const r5 = (pts) => pts.map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)])
	return [_tidy(_hull(r5(mid)), 0.0007), _tidy(_hull(r5(tip)), 0.0007), _tidy(_hull(r5(cap)), 0.0007), cb, R]
}

// ---------------------------------------------------------------- round things
function _fruit() {
	function ball(key, name, D, mass, kw) {
		_claim(key, [[{}, mass]])
		const { material, ...rest } = kw
		ball_type(key, name, D, mass, material, { category: CAT, ...rest })
	}
	function build_egg(c, P) {
		// side view, blunt end left, lying on its belly. Its outline is the true curve, its weight, centre of gravity and inertia the real egg's, and it rests exactly where an egg
		// of its shape rests, made one of two ways by its shape:
		// - a hen's egg (width up to 0.815 of the length, its blunt end a top it rolls off): the middle piece with the resting flat each side (the root of the weld), a ball for
		//   the blunt end, the pointed tip and, where the ball cannot follow a long or flattened egg's curve, a cap piece (_egg_outline);
		// - a rounder one, up to as wide as it is long, which can also stand on its blunt end: balls (_egg_balls, _egg_build_balls; they fit every such shape the sliders make).
		// An egg's length is its long axis, so no egg is wider than it is long: a width set past the length builds the roundest egg, as wide as it is long, and the item resolves
		// to that width (the 3D shell and its depth follow it). (Wider than long, the curve is so nearly a circle about its centre of gravity, within microns over tens of degrees,
		// that pieces the engine collides with its 0.5 mm of contact slop held such a shape wherever it was set down.)
		// Nor is a bird's egg much more than 1.6 times as long as it is wide (the most elongated orders, loons and kiwis, average 1.61): a width set below 0.55 of the length
		// (1.8 times as long as wide) builds an egg 0.55 as wide as it is long, and the item resolves to that. (Narrower, the pieces' prisms carry more of the weight toward
		// the ends than an egg's round body does, so no share of it gives the real moment of inertia: at half the length it came out 11 % high; and a needle of a shape is no
		// egg: 57 x 8.8 mm leapt 0.74 m off the table, and 285 x 8.8 on its 2 mm blunt-end ball, then the root of the weld, flew apart.)
		if (P.width > P.length) P.width = P.length
		if (P.width < EGG_MIN_WIDTH * P.length) P.width = EGG_MIN_WIDTH * P.length
		const sx = P.length / 0.057
		const sy = P.width / 0.044
		if (_egg_ends_rest(sx, sy)[0]) {
			const fit = _egg_balls_cached(sx, sy)
			if (fit !== null) {
				_egg_build_balls(c, P, sx, sy, fit)
				return
			}
		}
		const [mid, tip, cap, cb, R] = _egg_outline(sx, sy)
		const m = P.mass
		const d = P.width
		const pieces = [["egg", "an egg", mid], ["egg-tip", "the pointed end of an egg", tip], ["egg-cap", "the blunt end of an egg", cap]]
		const plane = pieces.map(([, , pts]) => _plane(pts)) // (area, centroid x, inertia about the centroid per kg)
		const Rr = R + EGG_SKIN / 1000 // the ball as the engine sees it: as far out as a polygon's skin reaches
		const Gc = (EGG_CG * sx) / 1000
		const sY = EGG_TIP_SHARE
		let sZ = EGG_CAP_SHARE
		const [[, cX], [, cY], [, cZ]] = plane
		// the ball and the middle piece share the rest of the weight so that the centre of gravity is the real egg's; on a flattened egg, whose ball sits near the middle,
		// the middle piece keeps 2 % and the cap takes what the ball cannot
		let sB = div((1 - sY - sZ) * cX - (Gc - sY * cY - sZ * cZ), cX - cb)
		if (sB > 1 - sY - sZ - 0.02) {
			const sX = 0.02
			sZ = pymin(pymax(div((1 - sY - sX) * cb - (Gc - sY * cY - sX * cX), cb - cZ), EGG_CAP_SHARE), 0.5)
			sB = 1 - sY - sX - sZ
		}
		sB = pymax(sB, 0.05)
		const shares = [1 - sY - sZ - sB, sY, sZ]
		// and the ball's own inertia makes up the real egg's moment of inertia about its centre of gravity (a crosswise axis)
		const Ie = (sy * sy * EGG_I[0] + sx * sx * EGG_I[1]) * 1e-6
		const Ip = pySum(plane.map(([, cx, j], i) => shares[i] * (j + (cx - Gc) * (cx - Gc)))) + sB * (cb - Gc) * (cb - Gc)
		const k = pymin(pymax(div(Ie - Ip, sB * Rr * Rr), 0.05), 2 / 3)
		// (the ball sits 0.1 mm off the axis, as no real egg is perfectly round: stood exactly on its blunt end it does not balance there for ever, it topples)
		const off = pyRound(0.0001 * pymin(sx, sy), 5)
		// the middle piece, the heaviest and nearest the centre of gravity, is the root that the others are welded to (welded to the ball, a long thin egg's tip, 40 mm out
		// from a ball of a third of the weight, swung 35 degrees off it for a moment when the egg landed on its end); the ball and each end piece are joined by a hidden pin
		// as well, which adds nothing to the welds but keeps the two from colliding (the cap lies inside the ball, and a round egg's ball reaches the tip piece's skin)
		const [[name0, words0, pts0], sh0, [a0]] = [pieces[0], shares[0], plane[0]]
		const root = c.poly(name0, pts0, d, 0.0, 0.0, { material: c.mat({ density: pyRound(div(m * sh0, a0 * d), 4) }), look: "eggshell", words: words0, ..._raw(c) })
		_weld_ball(c, "egg-end", root, Rr, [cb, off], c.mat({ density: pyRound(div(m * sB, ((4 / 3) * Math.PI) * cube(Rr)), 4) }), "eggshell", "the round blunt end of an egg", pyRound(k, 4))
		for (let n = 0; n < pieces.length - 1; n++) {
			const [name, words, pts] = pieces[n + 1]
			_weld_poly(c, name, root, pts, d, c.mat({ density: pyRound(div(m * shares[n + 1], plane[n + 1][0] * d), 4) }), "eggshell", words)
			c.joint("pin", `egg-hold${n + 1}`, { a: "egg-end", b: name, anchorA: [0.0, 0.0], anchorB: [pyRound(cb, 5), off], render: { hinge: "none" } })
		}
	}
	_claim("egg", [[{}, 0.057]])
	register(new ItemType("egg", "Egg", CAT, build_egg, {
		material: "eggshell", materials: ["eggshell"], anchor: "its centre",
		props: [_len("length", "Length", 0.057),
			_len("width", "Width (and front to back)", 0.044,
				"0.55 of the length to the length, as real eggs are: an egg's length is its long axis, so a larger width builds an egg as wide as it is long " +
				"(the roundest egg); and the most elongated birds' eggs are about 1.6 times as long as wide, so a width under 0.55 of the length builds one " +
				"0.55 as wide as it is long"), _mass(0.057)],
		tags: ["hen's egg", "chicken egg", "breakfast", "fragile", "shell", "boiled", "oval"],
		description: "A hen's egg lying on its side: oval, so it rocks and wobbles instead of rolling smoothly, and it cannot stand on either end. It hardly bounces. " +
			"It is raw: its liquid insides slow its rocking. " +
			"Made rounder (wider than 0.815 of its length, up to as wide as it is long) it can also stand on its blunt end, as a round egg does. " +
			"Its width goes from 0.55 of its length (past the most elongated birds' eggs) to its length (the roundest).",
		source: "USDA large egg: at least 2 oz (56.7 g) whole, about 57 × 44 mm, widest a little toward the blunt end. Its side outline is the true egg curve (Hügelschäffer's), within 0.6 mm " +
			"all round: the blunt end is a ball (a polygon's corner there would hold the egg up on its end; the real end is curved too tightly, 23.9 mm, for its centre of gravity 26.7 mm " +
			"above it), welded to three convex pieces. Its weight, its centre of gravity (the centroid of its volume, 1.8 mm toward the blunt end) and its moment of inertia are the real egg's. " +
			"So it settles with its axis tilted 8.85 degrees, pointed end down, as a real egg does, never rests level, and topples off either end. Resized or reshaped, it rests " +
			"where an egg of that shape does (the true curve's normal through its centre of gravity): a rounder egg (width over 0.815 of the length) is curved flatter at its " +
			"blunt end than its centre of gravity is high, so it can stand there too (just past 0.815 its blunt end is level to within microns over 9 degrees each way, so stood " +
			"there it stays where it is put, as a real one would); it is made of balls, which roll smoothly where its curve is nearly a circle about its centre " +
			"of gravity. No egg is wider than it is long (its length is its long axis), so a width set past the length builds an egg as wide as it is long; and the most " +
			"elongated are about 1.6 times as long as wide (length over breadth averages 1.21 in owls to 1.61 in loons and kiwis, the most elongated orders: Rahn and " +
			"Paganelli's summary of Schönwetter's tables), so a width set below 0.55 of the length (1.8 times as long as wide) builds an egg 0.55 as wide as it is " +
			"long; down to there its weight, centre of gravity and moment of inertia are the real egg's within about 1 %. A raw egg's liquid insides lag its shell and slow its turning, " +
			"dω/dt = −2ω (provisional). Bounce provisional.",
		facts: "57 × 44 mm · 57 g", edit: [{ kind: "size", w: "length", h: "width" }, { kind: "rotate" }]
	}))
	ball("apple", "Apple", 0.076, 0.182, {
		material: "fruit", look: "fruit", tags: ["fruit", "red apple", "snack", "food", "round"],
		description: "A medium apple: a soft round fruit that lands with a dull thud.",
		source: "USDA FoodData Central: one medium apple, 3 in (76 mm) across, 182 g. Bounce and friction provisional.", facts: "76 mm · 182 g"
	})
	ball("orange", "Orange", 0.067, 0.131, {
		material: "fruit", look: "fruit", color: "#f28c1e", tags: ["fruit", "citrus", "tangerine", "snack", "food", "round"],
		description: "A medium orange: a soft round fruit that lands with a dull thud.",
		source: "USDA FoodData Central: one medium orange, 2-5/8 in (67 mm) across, 131 g. Bounce and friction provisional.", facts: "67 mm · 131 g"
	})
}

// ---------------------------------------------------------------- shapes with a taper
function _shapes() {
	// --- bowling pin: the USBC profile (rows of [height above the foot, radius] in mm) cut into six convex pieces; the 3D model is a smooth spline through the same stations
	// USBC Equipment Specifications, "Bowling Pin Dimensions": diameter at each height (in): 0 (flat) 2.031 (5/32 in round), 3/4 2.828, 2-1/4 3.906, 3-3/8 4.510, 4-1/2 4.766, 5-7/8 4.563,
	// 7-1/4 3.703, 8-5/8 2.472, 9-3/8 1.965, 10 1.797, 10-7/8 1.870, 11-3/4 2.094, 12-5/8 2.406, 13-1/2 2.547; the crown is an arc of radius 1.273 in. Each piece's chords stay within 0.8 mm of that curve.
	const pin_rows = [[[0, 25.8], [18.5, 36.1], [42.5, 45.1], [70.4, 53.7]], // the foot (flat 2.031 in across) widening into the belly
		[[70.4, 53.7], [94.9, 59.3], [124.4, 61.0], [151.6, 58.0]], // the belly (widest, 4.766 in, 4.5 in up)
		[[151.6, 58.0], [177.3, 50.1], [201.3, 39.4], [229.1, 26.9]], // the shoulder narrowing in
		[[229.1, 26.9], [260.6, 22.0]], // the waist down to the neck (a concave stretch: one straight piece)
		[[260.6, 22.0], [308.3, 28.6], [338.1, 32.5]], // the neck (narrowest, 1.797 in, 10 in up) swelling out to the head
		[[338.1, 32.5], [359.5, 31.1], [373.8, 21.3], [381, 5.9]]] // the head (widest 2.547 in) and its crown (a smooth arc, not a cone)
	const pin_mass = 1.588 // 3 lb 8 oz, the USBC target (1.53-1.64 kg allowed)
	const pin_names = [["foot", "the foot of a bowling pin"], ["belly", "the belly of a bowling pin"], ["shoulder", "the shoulder of a bowling pin"], ["waist", "the waist of a bowling pin"],
		["neck", "the neck of a bowling pin"], ["head", "the head of a bowling pin"]]

	function build_pin(c, P) {
		const parts = pin_names.map(([n, w], i) => {
			const rs = pin_rows[i]
			return [n, w, _mmpts(_revolve(rs), 0, 190.5), pyRound((2 * Math.max(...rs.map(([, r]) => r))) / 1000, 5)]
		})
		// the weight is shared by each piece's volume of revolution: that puts the centre of gravity 147 mm above the foot (the USBC target is 5-25/32 in, 146.8 mm, 142.9 to 150.8 allowed)
		_compound(c, parts, pin_mass, "plastic", "#f6f3ea")
	}
	_claim("bowling-pin", [[{}, pin_mass]])
	register(new ItemType("bowling-pin", "Bowling pin", CAT, build_pin, {
		material: "varnished hardwood", materials: ["varnished hardwood"], anchor: "its centre",
		tags: ["pin", "skittle", "ten pin", "bowling", "strike", "knock down", "target", "tenpin"],
		description: "A ten-pin bowling pin standing on its 52 mm foot: it takes only about ten degrees of tilt to topple.",
		source: "USBC Equipment Specifications: 15 in (381 mm) tall, 4.766 in (121 mm) across the belly 4.5 in up, 1.797 in (46 mm) at the neck, 2.547 in (65 mm) at the head, a flat foot 2.031 in (51.6 mm) across, " +
			"3 lb 8 oz (1.588 kg) target (1.53-1.64 kg allowed); the crown of the head is a smooth arc of radius 1.273 in. The outline is the USBC diameter-by-height table cut into six welded convex pieces, each within 0.8 mm of the curve " +
			"(the chords straddle it). The weight is shared by each piece's volume of revolution, which puts the centre of gravity 147 mm above the foot (the USBC target is 146.8 mm); it topples at about 10 degrees. " +
			"Bounce and friction provisional.",
		facts: "381 mm tall · 1.59 kg", edit: [{ kind: "rotate" }]
	}))

	// --- traffic cone: a heavy square rubber base with the hollow cone standing on it
	function build_cone(c, P) {
		const W = P.width
		const H = P.height
		const D = P.depth
		const m = pymin(W, D)
		const hb = 0.0656 * H // the base plate: 30 mm of 457
		const rb = 0.34 * m // the cone's foot is 0.68 of the plate's width
		const rt = (0.025 * m) / 0.305 // the top is 5 cm across on the 305 mm base: a smaller or larger cone keeps the same taper (a 12 in cone's top is about 1.25 in across)
		const base = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, -H / 2 + hb], [-W / 2, -H / 2 + hb]]
		// the moulded collar round the cone's foot: 12.5 mm out, 6 mm tall on the 305 x 457 mm cone (it grows with the cone), rounded off (a hexagon in side view); it is part of
		// the rubber base, so it takes its share of the base's 60 %
		const y0 = -H / 2 + hb
		const rw = (0.0125 * m) / 0.305
		const rh = (0.006 * H) / 0.457
		// the cone's polygon starts on top of the collar (the collar holds its foot), so the two do not overlap: pieces that overlapped pushed on each other through the contact skin
		const rb2 = rb + div((rt - rb) * rh, H / 2 - y0)
		const cone = [[-rb2, y0 + rh], [rb2, y0 + rh], [rt, H / 2], [-rt, H / 2]]
		const cw = (0.003 * m) / 0.305 // the collar's rounded top corner: 3 mm in, from 3.2 mm up
		const ch = (0.0032 * H) / 0.457
		const collar = [[-rb - rw, y0], [rb + rw, y0], [rb + rw, y0 + ch], [rb + rw - cw, y0 + rh], [-rb - rw + cw, y0 + rh], [-rb - rw, y0 + ch]]
		const r5 = (pts) => pts.map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)])
		const v_base = _area(base) * D
		const v_collar = _area(collar) * 2 * (rb + rw)
		const shares = [div(0.6 * v_base, v_base + v_collar), 0.4, div(0.6 * v_collar, v_base + v_collar)]
		_compound(c, [["base", "the square rubber base of a traffic cone", r5(base), D], ["cone", "a traffic cone", r5(cone), 2 * rb],
			["collar", "the moulded collar round the foot of a traffic cone", r5(collar), pyRound(2 * (rb + rw), 5)]],
		P.mass, "pvc", "#f26a1b", { shares, gap: 0.0012 })
	}
	_claim("traffic-cone", [[{}, 1.36]])
	register(new ItemType("traffic-cone", "Traffic cone", CAT, build_cone, {
		material: "vinyl rubber", materials: ["vinyl rubber"], anchor: "its centre",
		props: [_len("width", "Base width", 0.305, "Left to right; the cone's foot is 0.68 of it, its top a sixth of it (5 cm on a 305 mm base)"), _len("height", "Height", 0.457, "Bottom to top"),
			_len("depth", "Base front to back", 0.305, "Only for the 3D look; the weight is set by Weight"), _mass(1.36)],
		tags: ["cone", "pylon", "road", "witch's hat", "marker", "construction", "safety", "orange", "bollard"],
		description: "A road cone on its heavy square base: stable, because most of its weight is low down; knock it hard and it slides and topples.",
		source: "An 18 in (457 mm) road cone on a 12 in (305 mm) square rubber base 30 mm thick, 3 lb (1.36 kg): cones of this height weigh 1-3 kg (product specs; provisional). " +
			"The hollow cone (210 mm across its foot, 50 mm at the top, straight sides), the base and a 6 mm moulded collar round the foot are three welded solids; the base (with its collar) is about 60 % of the weight " +
			"(a hollow cone on a rubber base: provisional), so the centre of gravity is low. Resized, it keeps these proportions: the top and the collar grow and shrink with the base, as on smaller and larger cones (a 12 in cone has a 7.5 in base and a top about 1.25 in across).",
		facts: "457 mm tall · 1.36 kg", edit: [{ kind: "size", w: "width", h: "height" }, { kind: "rotate" }]
	}))
}

// ---------------------------------------------------------------- open containers: the cup's floor and walls (fixed in place)
function _vessel(noun, color = null) {
	return function build(c, P) {
		const W = P.width
		const H = P.wall
		const t = P.thickness
		const d = P.depth
		const Wb = W * P.bottom_ratio
		c.slab("floor", Wb, t, d, 0, -t / 2, { kind: "static", words: `the ${noun}'s floor`, ..._paint(color) })
		const run = (W - Wb) / 2
		const L = hypot(run, H)
		const phi = degrees(Math.atan2(run, H))
		for (const [side, nm] of [[-1, "left"], [1, "right"]]) {
			c.slab(nm, t, L, d, side * ((Wb - t) / 2 + run / 2), H / 2, { langle: -side * phi, kind: "static", words: `the ${noun}'s ${nm} wall`, ..._paint(color) })
		}
	}
}

function _container(key, name, noun, W, H, t, ratio, material, tags, description, source, color = null) {
	_claim(key, [])
	register(new ItemType(key, name, "Containers", _vessel(noun, color), {
		dynamic: false, material, materials: [material], anchor: "the middle of its floor's top",
		props: [_len("width", "Width (top)", W), _len("wall", "Depth", H, "Wall height"), _len("thickness", "Wall thickness", t), _len("depth", "Front to back", W),
			new Prop("bottom_ratio", "Bottom width / top width", ratio, 0.3, 1.0, 0.01, "", "1 is straight sides, less is tapered")],
		tags, description, source, facts: `${_mm(W)} mm wide, ${_mm(H)} mm deep`,
		edit: [{ kind: "boxWidth", prop: "width" }, { kind: "top", prop: "wall" }]
	}))
}

// the jar: a straight body, a shoulder, a threaded neck (centre line of the 3 mm glass: body to 0.768 of the height, shoulder to 0.875), and an optional lid
const JAR_BODY = 0.768
const JAR_SHOULDER = 0.875
const JAR_NECK = 0.897

function _jar(c, P) {
	const W = P.width
	const H = P.wall
	const t = P.thickness
	const d = P.depth
	const hb = JAR_BODY * H
	const hs = JAR_SHOULDER * H
	const rn = (JAR_NECK * W) / 2
	c.slab("floor", W, t, d, 0, -t / 2, { kind: "static", words: "the jar's glass floor" })
	const shoulder_dx = W / 2 - rn
	const shoulder_dy = hs - hb
	const ls = hypot(shoulder_dx, shoulder_dy)
	const phi = degrees(Math.atan2(shoulder_dx, shoulder_dy))
	for (const [side, nm] of [[-1, "left"], [1, "right"]]) {
		c.slab(nm, t, hb, d, side * (W / 2 - t / 2), hb / 2, { kind: "static", words: `the jar's ${nm} wall` })
		c.slab(`${nm}-shoulder`, t, ls, d, side * ((W / 2 + rn) / 2 - t / 2), (hb + hs) / 2, { langle: side * phi, kind: "static", words: `the jar's ${nm} shoulder` })
		c.slab(`${nm}-neck`, t, H - hs, d, side * (rn - t / 2), (hs + H) / 2, { kind: "static", words: `the jar's ${nm} neck` })
	}
	if (truthy(P.lid)) {
		const lw = 2 * rn + 0.003
		const lh = 0.012
		c.slab("lid", lw, lh, d, 0, H + lh / 2 - 0.002, { kind: "static", words: "the jar's metal lid", look: "steel" })
	}
}

function _glass_jar(W, H, t) {
	_claim("glass-jar", [])
	register(new ItemType("glass-jar", "Glass jar", "Containers", _jar, {
		dynamic: false, material: "glass", materials: ["glass"], anchor: "the middle of its floor's top",
		props: [_len("width", "Width (body)", W), _len("wall", "Height", H, "Floor to the rim of the neck"), _len("thickness", "Glass thickness", t), _len("depth", "Front to back", W),
			new Prop("lid", "Lid on", false, { kind: "bool", help: "Screws on: the jar is shut and things sit on top of it" })],
		tags: ["jar", "mason jar", "canning jar", "pot", "glass", "target", "catch", "goal", "container", "pint", "lid"],
		description: "A pint canning jar with a shoulder and a threaded neck, fixed in place: a hard, narrow target. Tick the lid and it is shut.",
		source: "A 16 oz (pint) wide-mouth canning jar: about 87 mm across the body and 112 mm tall, a shoulder 12 mm tall narrowing to a 78 mm neck (a 72 mm opening: " +
			"an orange still drops in), 3 mm glass (typical; product specs vary: provisional). The lid is a 12 mm metal band, off unless ticked.",
		facts: `${_mm(W)} mm wide, ${_mm(H)} mm tall`,
		edit: [{ kind: "boxWidth", prop: "width" }, { kind: "top", prop: "wall" }]
	}))
}

function _containers() {
	_container("plastic-cup", "Plastic cup", "plastic cup", 0.095, 0.125, 0.002, 0.61, "polypropylene",
		["cup", "party cup", "solo", "disposable", "target", "catch", "goal", "bin", "container", "plastic", "pot"],
		"A disposable party cup, fixed in place: a light target to land things in.",
		"A 16 US fl oz (473 mL) party cup: about 95 mm across the top, 58 mm at the base, 125 mm tall (brands differ; provisional). Wall thickness is a minimum, not the real 0.5 mm.",
		"#d93b30")
	_glass_jar(0.087, 0.112, 0.003)
}
