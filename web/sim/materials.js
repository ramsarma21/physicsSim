// Materials and how two of them meet: machines/items.py's MATERIALS, measured() and contact(). Plain ES module.
//
// bounce: restitution against a perfectly rigid surface; two materials meet with bounce_a * bounce_b unless the pair was measured
// (MEASURED). friction: Coulomb; two meet with sqrt(f_a * f_b). rolling: rolling-resistance coefficient (the larger of the two applies).
// side: sideways spring-back (Garwin e_x) of a gripping, springy surface; grip: the friction that limits it during a bounce.
import { PyInt, div, pymax, pymin, pyRound, toFloat } from "./pymath.js"

export const MATERIALS = {}
/** Which numbers of a material were written as Python ints (only the print of a float differs: 700 and 700.0). material name -> Set of keys. */
export const MATERIAL_INTS = new Map()

/** Defines a material: `values` as machines/items.py writes them, `ints` the keys it wrote as ints (a density of 700). */
export function define_material(name, values, ints = ["density"]) {
	MATERIALS[name] = values
	MATERIAL_INTS.set(name, new Set(ints))
}

define_material("varnished hardwood", {
	density: 700, bounce: 0.93, friction: 0.45, rolling: 0.0, side: 0.0, look: "wood",
	source: "Density: hardwood 600-800 kg/m³. Bounce chosen so a superball on it gives Cross's measured 0.86."
})
define_material("domino wood", {
	density: 700, bounce: 0.93, friction: 0.4, rolling: 0.0, side: 0.0, look: "light wood",
	source: "Hardwood; domino-on-domino values calibrated to Larham's measured wave speed."
})
define_material("solid rubber", {
	density: 906, bounce: 0.925, friction: 0.52, rolling: 0.012, side: 0.55, grip: 0.9, look: "rubber",
	source: "102.5 g, 60 mm superball (Cross, Am. J. Phys. 70, 482 and 1093, 2002); e 0.86 on a wood floor."
})
define_material("hollow plastic", {
	density: 950, bounce: 0.806, friction: 0.33, rolling: 0.02, side: 0.15, look: "plastic",
	source: "Polyethylene 910-960 kg/m³; e from a 92 cm drop rebounding 43.6 cm with drag removed (Physics Factbook)."
})
define_material("modeling clay", {
	density: 1570, bounce: 0.054, friction: 0.9, rolling: 0.3, side: 0.0, yieldStrength: 120000, look: "clay",
	source: "Van Aken plasticine 1570 kg/m³ (Eckerson et al. 2008); flow stress 0.08-0.175 MPa (Sofuoglu & Rasty 2000)."
}, ["density", "yieldStrength"])
define_material("steel", {
	density: 7850, bounce: 0.95, friction: 0.4, rolling: 0.001, side: 0.1, look: "steel",
	source: "Carbon steel 7850 kg/m³; hard steel-on-steel restitution about 0.9-0.95 at low speed."
})

// Measured (or deliberately calibrated) pairs: these override the mixing rule. The key is the unordered pair (a frozenset in Python).
export const MEASURED = new Map()
export const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

/** measured(a, b, {friction, restitution, rollingResistance, tangentRestitution?, grip?, source}): keep the keys in the order items.py writes them. */
export function measured(a, b, kw) {
	MEASURED.set(pairKey(a, b), kw)
}

measured("solid rubber", "varnished hardwood", {
	friction: 0.52, restitution: 0.86, rollingResistance: 0.012, tangentRestitution: 0.55, grip: 0.9,
	source: "Restitution 0.86 and friction 0.52: Cross, Am. J. Phys. 70, 482 (2002); sideways e_x 0.49-0.76 (Cross 2002; Garwin 1969). Rolling resistance provisional."
})
measured("hollow plastic", "varnished hardwood", {
	friction: 0.33, restitution: 0.75, rollingResistance: 0.02, tangentRestitution: 0.15,
	source: "A hollow hard plastic ball dropped 92 cm rebounded 43.6 cm (Physics Factbook), e 0.75 with drag removed. Friction: polyethylene on wood (Murase 1984)."
})
measured("modeling clay", "varnished hardwood", { friction: 0.9, restitution: 0.05, rollingResistance: 0.3, source: "Provisional: clay barely bounces." })
measured("varnished hardwood", "varnished hardwood", {
	friction: 0.4, restitution: 0.3, rollingResistance: 0.0,
	source: "Dry wood on wood friction 0.25-0.5 (Engineering ToolBox); restitution provisional."
})
measured("domino wood", "domino wood", {
	friction: 0.1, restitution: 0.3, rollingResistance: 0.0,
	source: "Calibrated: the domino wave runs 1.49 sqrt(gH), Larham's measured 1.50 (arXiv:1302.3311)."
})
measured("domino wood", "varnished hardwood", { friction: 0.4, restitution: 0.3, rollingResistance: 0.0, source: "Dry wood on wood (Engineering ToolBox)." })
for (const ball of ["solid rubber", "hollow plastic", "modeling clay"]) MEASURED.set(pairKey(ball, "domino wood"), { ...MEASURED.get(pairKey(ball, "varnished hardwood")) })
measured("solid rubber", "hollow plastic", { friction: 0.4, restitution: 0.6, rollingResistance: 0.0, source: "Provisional (ball on ball)." })
measured("hollow plastic", "hollow plastic", { friction: 0.4, restitution: 0.6, rollingResistance: 0.0, source: "Provisional (ball on ball)." })
measured("modeling clay", "hollow plastic", { friction: 0.4, restitution: 0.05, rollingResistance: 0.0, source: "Provisional (ball on ball)." })

// Steel is one of the six materials above (the table, wall, plank, seesaw and box offer it), but machines/catalog_items.py is where the server
// defines how steel meets steel and the two woods (the rest of its _pairs() are about materials only that file defines). A scene of core items
// alone has to meet steel as the server does, so these three are here too; the catalog port registers the same values again, harmlessly, and
// tools/parity/core.mjs --mode server compares them with the server's own tables.
measured("steel", "steel", {
	friction: 0.4, restitution: 0.95, rollingResistance: 0.001,
	source: "Hard steel on steel at low speed 0.9-0.95; the upper end for bearing balls, so a Newton's cradle swings on. Provisional."
})
// a steel ball on wood or stone is not a steel-on-steel ring: the softer body's losses dominate, not the product of the two bounces
for (const m of ["varnished hardwood", "domino wood"]) {
	measured("steel", m, {
		friction: pyRound(Math.sqrt(0.4 * MATERIALS[m].friction), 3), restitution: 0.6, rollingResistance: 0.001,
		source: "Physics Factbook: a steel ball bearing dropped 92 cm onto concrete rebounds 32.8 cm, e 0.597; wood and brick are no stiffer than concrete. Friction mixed."
	})
}

export const MATERIAL_KEYS = ["bounce", "friction", "rolling", "side"]

const INTS = Symbol("ints") // on a material's values: the keys that are Python ints

/** A material's values with an item's own changes (each overridden value becomes a float, as float(v) does). */
export function material_of(base, overrides) {
	const m = { ...MATERIALS[base] }
	const ints = new Set(MATERIAL_INTS.get(base) ?? [])
	for (const k of Object.keys(overrides ?? {})) {
		const v = overrides[k]
		if (v !== null && v !== undefined) {
			m[k] = toFloat(v)
			ints.delete(k)
		}
	}
	Object.defineProperty(m, INTS, { value: ints, enumerable: false })
	return m
}
/** Sets one value of a material instance (density, from an item's own mass): a number is a float, a PyInt an int. */
export function set_value(props, key, value) {
	if (value instanceof PyInt) {
		props[key] = value.value
		props[INTS]?.add(key)
	} else {
		props[key] = value
		props[INTS]?.delete(key)
	}
}
export const is_int = (props, key) => !!props[INTS]?.has(key)

/** How two material instances (objects with base and props) meet: the pair's measured values scaled by what the items changed, else mixed. */
export function contact(a, b) {
	const pa = a.props
	const pb = b.props
	const key = pairKey(a.base, b.base)
	if (MEASURED.has(key)) {
		const baseA = MATERIALS[a.base]
		const baseB = MATERIALS[b.base]
		const c = { ...MEASURED.get(key) }
		// an item's own bounce or friction scales the measured pair by how far it moved from its material's
		const rb = (baseA.bounce ? div(pa.bounce, baseA.bounce) : 1) * (baseB.bounce ? div(pb.bounce, baseB.bounce) : 1)
		const rf = Math.sqrt((baseA.friction ? div(pa.friction, baseA.friction) : 1) * (baseB.friction ? div(pb.friction, baseB.friction) : 1))
		if (Math.abs(rb - 1) > 1e-9) c.restitution = pymin(1.0, c.restitution * rb)
		if (Math.abs(rf - 1) > 1e-9) {
			c.friction = c.friction * rf
			if ("grip" in c) c.grip = c.grip * rf
		}
		if (pa.rolling !== baseA.rolling || pb.rolling !== baseB.rolling) c.rollingResistance = pymax(pa.rolling, pb.rolling)
		if (pa.side !== baseA.side || pb.side !== baseB.side) c.tangentRestitution = pymax(pa.side, pb.side)
		return c
	}
	const side = pymin(pa.bounce, pb.bounce) >= 0.5 ? pymax(pa.side, pb.side) : 0.0
	const c = {
		friction: pyRound(Math.sqrt(pa.friction * pb.friction), 4),
		restitution: pyRound(pa.bounce * pb.bounce, 4),
		rollingResistance: pymax(pa.rolling, pb.rolling),
		source: "Mixed from each material's own values (bounce a x bounce b, friction sqrt(a x b)); provisional."
	}
	if (side > 0) {
		c.tangentRestitution = side
		c.grip = pymax("grip" in pa ? pa.grip : pa.friction, "grip" in pb ? pb.grip : pb.friction)
	}
	return c
}
