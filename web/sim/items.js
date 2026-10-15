// Scenes made of catalog items, turned into the engine's scene document: a port of machines/items.py (core part) that runs in the browser
// and in node with the same numbers as the Python. Plain ES module, no dependencies.
//
// scene = {version: 2, name, seconds, release (s, when held items let go), stage: {x0, x1, y0, y1} (m, the scene's edges), items, goals}
// item  = {id, type: catalog key, x: m, y: m, angle: degrees counter-clockwise, props: {key: value} (only what differs from the type's
//          defaults), held: bool, fixed: bool, name}
// goal  = {kind: "in", item: item id, container: item id, label}
//
// Every item type says what its (x, y) is (its anchor, usually its centre) and builds its solids in its own frame; build() places them in
// the world. Item types live in TYPES: the ones defined here are the core ones (table, wall, plank, three balls, domino, domino-row, seesaw,
// box). The rest of the catalog registers through use_catalog_module() (see the bottom of this file), as machines/items.py imports
// catalog_items.py, catalog_everyday.py and catalog_mechanisms.py at its end.
//
// Names follow the Python (snake_case where it has underscores, c.slab / c.ball / c.poly / c.joint / c.cord / c.mat) so the catalog files
// port line by line. Python keyword arguments become one trailing options object: c.slab("plank", L, th, d, lx, ly, {langle: -tilt, words: "..."}).
// Exactness: see pymath.js (round(), float formatting, hypot) and tools/parity/ (the harness that compares this with the Python).
import {
	D2R, PyInt, ValueError, cos, cube, degrees, div, dumps, floatRepr, floorLog10, fmtF, fmtG, hasOwn, hypot, maxOf, minOf,
	pyLower, pyRound, pyRoundInt, pySorted, pySum, pymax, pymin, setOwn, sha1hex, sin, toFloat, truthy
} from "./pymath.js"
import { MATERIALS, MATERIAL_KEYS, MATERIAL_INTS, MEASURED, contact, define_material, is_int, material_of, measured, set_value } from "./materials.js"
import { SPRITE_RECORDS } from "./sprites.js"
import * as rube from "./rube.js"
import * as py from "./pymath.js"

export { MATERIALS, MATERIAL_KEYS, MEASURED, measured, define_material, material_of, contact, D2R, PyInt }
export const CORD = rube.CORD

const isKw = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof PyInt)

// ---------------------------------------------------------------- item types
/** One setting an item shows on the left: a number (with range), an int, a yes/no, or a choice.
 *  new Prop(key, label, default, lo, hi, step, unit, help, {kind, choices, auto, slider_max}) (the options object may follow `default` directly). */
export class Prop {
	constructor(key, label, def, ...rest) {
		const kw = rest.length && isKw(rest[rest.length - 1]) ? rest.pop() : {}
		const o = { lo: rest[0] ?? null, hi: rest[1] ?? null, step: rest[2] ?? null, unit: rest[3] ?? "", help: rest[4] ?? "", kind: "number", choices: null, auto: false, slider_max: null, ...kw }
		this.key = key
		this.label = label
		this.default = def
		this.lo = o.lo
		this.hi = o.hi
		this.step = o.step
		this.unit = o.unit
		this.help = o.help
		this.kind = o.kind
		this.choices = o.choices
		this.auto = o.auto
		this.slider_max = o.slider_max
	}

	json() {
		const d = { key: this.key, label: this.label, default: this.default, kind: this.kind, unit: this.unit, help: this.help }
		if (truthy(this.auto)) d.auto = Array.isArray(this.auto) ? [...this.auto] : true // the default is for the default size: the built value follows other props until this is set; a list names them (true = every prop that is not auto itself)
		if (this.kind === "number" || this.kind === "int") {
			d.min = this.lo
			d.max = this.hi
			d.step = this.step
			if (this.slider_max !== null) d.slider_max = this.slider_max // the slider's own top (min..max is what a typed value may be)
		}
		if (truthy(this.choices)) d.choices = [...this.choices]
		return d
	}
}

/** A catalog entry. build_fn(ctx, P) adds its solids in its own frame (its anchor at the origin). */
export class ItemType {
	constructor(key, name, category, build, kw = {}) {
		const o = { props: [], tags: [], description: "", source: "", dynamic: true, material: null, materials: [], anchor: "its centre", edit: [], facts: "", hidden_3d: false, color: null, ...kw }
		this.key = key
		this.name = name
		this.category = category
		this.build_fn = build
		this.props = [...o.props]
		this.tags = [...o.tags]
		this.description = o.description
		this.source = o.source
		this.dynamic = o.dynamic
		this.material = o.material
		this.materials = [...o.materials]
		this.anchor = o.anchor
		this.edit = [...o.edit]
		this.facts = o.facts
		this.hidden_3d = o.hidden_3d
		this.color = o.color
	}

	/** Every `auto` prop of this type and the props each follows: what a built value of an auto prop depends on (a Set). */
	auto_keys() {
		const keys = new Set()
		for (const p of this.props) {
			if (truthy(p.auto)) {
				keys.add(p.key)
				for (const k of Array.isArray(p.auto) ? p.auto : this.props.filter((q) => !truthy(q.auto)).map((q) => q.key)) keys.add(k)
			}
		}
		return keys
	}

	defaults() {
		const d = {}
		for (const p of this.props) setOwn(d, p.key, p.default)
		if (this.material) {
			d.material = this.material
			const m = MATERIALS[this.material]
			for (const k of MATERIAL_KEYS) d[k] = m[k]
		}
		return d
	}

	schema() {
		const props = this.props.map((p) => p.json())
		if (this.material) {
			props.push(new Prop("material", "Material", this.material, { kind: "choice", choices: this.materials.length ? this.materials : [this.material] }).json())
			const m = MATERIALS[this.material]
			props.push(
				new Prop("bounce", "Bounciness", m.bounce, 0, 1, 0.01, "", "Against a perfectly hard surface").json(),
				new Prop("friction", "Friction", m.friction, 0, 2, 0.01).json(),
				new Prop("rolling", "Rolling resistance", m.rolling, 0, 0.5, 0.001).json(),
				new Prop("side", "Side spring-back", m.side, 0, 1, 0.01, "", "How a grippy, springy ball kicks back sideways").json()
			)
		}
		const autos = new Set(this.props.filter((p) => truthy(p.auto)).map((p) => p.key))
		// (an auto prop has no default of its own: its value at any other size is built, so a value the item sets is always kept)
		const defaults = {}
		const all = this.defaults()
		for (const k of Object.keys(all)) if (!autos.has(k)) setOwn(defaults, k, all[k])
		return {
			key: this.key, name: this.name, category: this.category, tags: [...this.tags], description: this.description, source: this.source,
			dynamic: this.dynamic, anchor: this.anchor, edit: this.edit.map((h) => ({ ...h })), props, defaults, facts: this.facts
		}
	}
}

export const TYPES = Object.create(null) // catalog key -> ItemType, in registration order
export const CATEGORIES = ["Balls", "Blocks & shapes", "Surfaces & ramps", "Rods & hinges", "Dominoes", "Containers", "Groups", "Air", "Scenery"]

export function register(t) {
	TYPES[t.key] = t
	return t
}

// ---------------------------------------------------------------- building
const tup = (p) => `(${floatRepr(p[0])}, ${floatRepr(p[1])})`

/** Why points [(x, y)] cannot be a polygon body's outline, or null (the engine's own check, part.ts polygonProblem):
 *  3 to 8 points, every side at least 0.5 mm, counter-clockwise once around, every corner turning left. */
export function polygon_problem(pts) {
	const n = pts.length
	if (n < 3 || n > 8) return `has ${n} points; a polygon body takes 3 to 8`
	for (let k = 0; k < n; k++) {
		const [x1, y1] = pts[k]
		const [x2, y2] = pts[(k + 1) % n]
		const side = hypot(x2 - x1, y2 - y1)
		if (side < 0.0005) {
			return `has a side ${fmtF(side * 1000, 2)} mm long, from point ${k} ${tup(pts[k])} to point ${(k + 1) % n} ${tup(pts[(k + 1) % n])}; the shortest a polygon body's side may be is 0.5 mm`
		}
	}
	const area2 = []
	for (let k = 0; k < n; k++) area2.push(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1])
	if (pySum(area2) <= 0) return "runs clockwise (or crosses itself): list its points counter-clockwise, in the solid's frame (x right, y up)"
	let turning = 0.0
	for (let k = 0; k < n; k++) {
		const [x0, y0] = pts[(k - 1 + n) % n]
		const [x1, y1] = pts[k]
		const [x2, y2] = pts[(k + 1) % n]
		const ax = x1 - x0
		const ay = y1 - y0
		const bx = x2 - x1
		const by = y2 - y1
		const cross = ax * by - ay * bx
		const sine = div(cross, hypot(ax, ay) * hypot(bx, by))
		if (sine < -1e-9) return `is not convex: it turns clockwise at point ${k} ${tup(pts[k])}; make every corner turn left, or build the shape from several convex solids welded together`
		if (sine <= 1e-9) return `has point ${k} ${tup(pts[k])} on the straight line between its neighbours; leave it out`
		turning += Math.atan2(cross, ax * bx + ay * by)
	}
	if (Math.abs(turning - 2 * Math.PI) > 1e-6) return `winds ${pyRoundInt(turning / (2 * Math.PI))} times around; a convex outline goes around once`
	return null
}

/** Collects one item's solids in its own frame and places them in the world. */
export class Ctx {
	constructor(scene_builder, item, P) {
		this.sb = scene_builder
		this.item = item
		this.P = P
		const a = (item.angle ?? 0.0) * D2R
		this.ox = item.x ?? 0.0
		this.oy = item.y ?? 0.0
		this.ca = cos(a)
		this.sa = sin(a)
		this.a = a
		this.kind = truthy(item.fixed) || !TYPES[item.type].dynamic ? "static" : "dynamic"
	}

	/** An item-frame point [lx, ly] as a world point. */
	world(lx, ly) {
		return [this.ox + lx * this.ca - ly * this.sa, this.oy + lx * this.sa + ly * this.ca]
	}

	/** The material instance for this item: its chosen base with its own bounce/friction/... and density ({base, density, overrides}). */
	mat({ base = null, density = null, overrides = null } = {}) {
		const P = this.P
		base = truthy(base) ? base : truthy(P.material) ? P.material : TYPES[this.item.type].material
		const given = overrides !== null && overrides !== undefined ? overrides : Object.fromEntries(MATERIAL_KEYS.map((k) => [k, P[k] ?? null]))
		const props = material_of(base, given)
		if (density !== null && density !== undefined) set_value(props, "density", density)
		return this.sb.material(base, props)
	}

	_solid(part, body, lx, ly, langle, material, kind, look, words, extra) {
		const sid = `${this.item.id}/${part}`
		const [x, y] = this.world(lx, ly)
		const s = {
			kind: truthy(kind) ? kind : this.kind, id: sid, words: truthy(words) ? words : TYPES[this.item.type].name.toLowerCase(), body, material,
			at: { x: pyRound(x, 5), y: pyRound(y, 5) }, item: this.item.id, look: truthy(look) ? look : MATERIALS[this.sb.base_of(material)].look
		}
		const ang = langle * D2R + this.a
		if (Math.abs(ang) > 1e-12) s.angle = pyRound(ang, 6)
		Object.assign(s, extra)
		this.sb.solids.push(s)
		return sid
	}

	/** c.slab(part, w, h, depth, lx, ly, [langle,] {langle, material, kind, look, words, taper, fill, ...extra}) */
	slab(part, w, h, depth, lx = 0.0, ly = 0.0, a7, a8) {
		let langle = 0.0
		let kw = {}
		if (isKw(a7)) kw = a7
		else {
			if (a7 !== undefined) langle = a7
			if (a8 !== undefined) kw = a8
		}
		const { langle: la = langle, material = null, kind = null, look = null, words = null, ...extra } = kw
		const body = { kind: "slab", width: pyRound(w, 5), height: pyRound(h, 5), depth }
		if ("taper" in extra) {
			body.taper = extra.taper
			delete extra.taper
		}
		const fill = extra.fill ?? null
		delete extra.fill
		const sid = this._solid(part, body, lx, ly, la, truthy(material) ? material : this.mat(), kind, look, words, extra)
		const s = this.sb.solids[this.sb.solids.length - 1]
		if (!("placeholder" in s)) s.placeholder = { fill: truthy(fill) ? fill : LOOK_FILL[s.look] ?? "#c8955a" }
		if (!("render" in s)) s.render = { kind: "procedural", shade: LOOK_SHADE[s.look] ?? "#8a6a45" }
		if (!("depth" in s)) s.depth = 2
		return sid
	}

	/** A convex prism (a cone's slope, a wedge, a car's hood, an egg): its side outline, 3 to 8 points counter-clockwise, each [x, y] or {x, y},
	 *  in the solid's own frame: around its origin at (lx, ly) in the item frame, turned langle degrees with it (as a slab's width and height are).
	 *  depth = front-to-back size. An outline the engine would refuse raises ValueError here. */
	poly(part, points, depth, lx = 0.0, ly = 0.0, a7, a8) {
		let langle = 0.0
		let kw = {}
		if (isKw(a7)) kw = a7
		else {
			if (a7 !== undefined) langle = a7
			if (a8 !== undefined) kw = a8
		}
		const { langle: la = langle, material = null, kind = null, look = null, words = null, ...extra } = kw
		let pts = points.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]))
		pts = pts.map(([x, y]) => [pyRound(x, 5), pyRound(y, 5)])
		const problem = polygon_problem(pts)
		if (problem) throw new ValueError(`${this.item.id}/${part}: polygon ${problem}`)
		const body = { kind: "polygon", points: pts.map(([x, y]) => ({ x, y })), depth }
		const fill = extra.fill ?? null
		delete extra.fill
		const sid = this._solid(part, body, lx, ly, la, truthy(material) ? material : this.mat(), kind, look, words, extra)
		const s = this.sb.solids[this.sb.solids.length - 1]
		if (!("placeholder" in s)) s.placeholder = { fill: truthy(fill) ? fill : LOOK_FILL[s.look] ?? "#c8955a" }
		if (!("render" in s)) s.render = { kind: "procedural", shade: LOOK_SHADE[s.look] ?? "#8a6a45" }
		if (!("depth" in s)) s.depth = 2
		return sid
	}

	/** c.ball(part, r, lx, ly, {material, kind, look, words, wall, inertia, fill, sprite, ...extra}) */
	ball(part, r, lx = 0.0, ly = 0.0, kw = {}) {
		const { material = null, kind = null, look = null, words = null, wall = null, inertia = null, ...extra } = kw
		const body = { kind: "ball", radius: pyRound(r, 5) }
		if (wall !== null && wall !== undefined) body.wall = wall
		if (inertia !== null && inertia !== undefined) body.inertia = inertia
		const fill = extra.fill ?? null
		delete extra.fill
		const sprite = extra.sprite ?? null
		delete extra.sprite
		this._solid(part, body, lx, ly, 0.0, truthy(material) ? material : this.mat(), kind, look, words, extra)
		const s = this.sb.solids[this.sb.solids.length - 1]
		if (!("placeholder" in s)) s.placeholder = { fill: truthy(fill) ? fill : LOOK_FILL[s.look] ?? "#888" }
		if (truthy(sprite)) {
			s.render = { kind: "rigid" }
			s.sprite = sprite
			this.sb.use_sprite(sprite)
		} else if (!("render" in s)) s.render = { kind: "procedural", shade: LOOK_SHADE[s.look] ?? "#555" }
		if (!("depth" in s)) s.depth = 4
		return `${this.item.id}/${part}`
	}

	/** A doc joint "<item id>/<part>" (CONTRACT.md Phase 2). a/b/chassis/wheel name this item's parts (null: the world; a name with "/" is a
	 *  solid id kept as is); a world side's anchor, and a pulley's groundA/groundB, are in the item's frame and become world points; anchors
	 *  on a solid stay in that solid's own frame. Points are [x, y] or {x, y}. */
	joint(kind, part, fields = {}) {
		const pt = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y])
		const here = (p) => ({ x: pyRound(pt(p)[0], 5), y: pyRound(pt(p)[1], 5) })
		const there = (p) => {
			const [x, y] = this.world(...pt(p))
			return { x: pyRound(x, 5), y: pyRound(y, 5) }
		}
		const j = { kind, id: `${this.item.id}/${part}`, item: this.item.id, ...fields }
		for (const side of ["a", "b", "chassis", "wheel"]) {
			if (side in j && j[side] !== null && j[side] !== undefined && !j[side].includes("/")) j[side] = `${this.item.id}/${j[side]}`
		}
		for (const [key, side] of [["anchorA", "a"], ["anchorB", "b"], ["anchor", "chassis"], ["groundA", null], ["groundB", null]]) {
			if (key in j) j[key] = side === null || j[side] === null || j[side] === undefined ? there(j[key]) : here(j[key])
		}
		this.sb.joints.push(j)
		return j.id
	}

	cord(part, lx, ly) {
		const [x, y] = this.world(lx, ly)
		this.sb.use_sprite("cord")
		this.sb.animated.push({
			kind: "animated", id: `${this.item.id}/${part}`, words: "a thin cord", sprite: "cord", item: this.item.id,
			vector: [{ id: "cord", tag: "rect", attrs: { x: -0.0015, y: 0, width: 0.003, height: CORD, fill: "#555" } }],
			at: { x: pyRound(x, 5), y: pyRound(y, 5) }, keys: [], depth: 0
		})
	}
}

// How each look renders: fill/shade (a flat placeholder colour) and the 3D surface hints (the view reads these from the catalog).
export const LOOKS = {
	"wood": { fill: "#c8955a", shade: "#a8743f", roughness: 0.5, metalness: 0.0, clearcoat: 1.0, grain: true },
	"light wood": { fill: "#d7a86e", shade: "#b07a42", roughness: 0.5, metalness: 0.0, clearcoat: 0.6, grain: true },
	"rubber": { fill: "#dd2222", shade: "#aa1111", roughness: 0.42, metalness: 0.0, clearcoat: 0.0 },
	"plastic": { fill: "#f2c230", shade: "#c99a10", roughness: 0.22, metalness: 0.0, clearcoat: 0.4 },
	"clay": { fill: "#5a9b4a", shade: "#3f7434", roughness: 0.65, metalness: 0.0, clearcoat: 0.0 },
	"steel": { fill: "#9aa3ab", shade: "#6b737a", roughness: 0.25, metalness: 1.0, clearcoat: 0.0 }
}
export const LOOK_FILL = Object.create(null)
export const LOOK_SHADE = Object.create(null)
for (const k of Object.keys(LOOKS)) {
	LOOK_FILL[k] = LOOKS[k].fill
	LOOK_SHADE[k] = LOOKS[k].shade
}

export function add_look(key, kw) {
	LOOKS[key] = kw
	LOOK_FILL[key] = kw.fill
	LOOK_SHADE[key] = kw.shade
}

export class SceneBuilder {
	constructor() {
		this.solids = []
		this.animated = []
		this.materials = {}
		this.instances = new Map()
		this.sprites_used = new Set()
		this.joints = []
	}

	/** The name of the material instance (base + props), made on first use: the base name when the props are the base's own, else with a short hash. */
	material(base, props) {
		const picked = {}
		for (const k of Object.keys(props).sort()) {
			if (["density", "bounce", "friction", "rolling", "side", "grip"].includes(k)) picked[k] = is_int(props, k) ? new PyInt(props[k]) : props[k]
		}
		const key = dumps([base, picked])
		if (this.instances.has(key)) return this.instances.get(key).name
		const same = ["density", "bounce", "friction", "rolling", "side"].every((k) => Math.abs((k in props ? props[k] : 0) - (k in MATERIALS[base] ? MATERIALS[base][k] : 0)) < 1e-12)
		const name = same ? base : `${base} [${sha1hex(key).slice(0, 6)}]`
		const rec = { density: props.density }
		if ("yieldStrength" in MATERIALS[base]) rec.yieldStrength = MATERIALS[base].yieldStrength
		if (truthy(MATERIALS[base].source)) rec.source = MATERIALS[base].source
		setOwn(this.materials, name, rec)
		this.instances.set(key, { name, base, props })
		return name
	}

	base_of(name) {
		for (const v of this.instances.values()) if (v.name === name) return v.base
		throw new Error("StopIteration")
	}

	use_sprite(name) {
		this.sprites_used.add(name)
	}

	contacts() {
		const byName = new Map()
		for (const v of this.instances.values()) byName.set(v.name, v) // a dict keyed by name: first place, last value
		const inst = [...byName.values()]
		const out = []
		for (let i = 0; i < inst.length; i++) {
			for (let j = i; j < inst.length; j++) out.push({ between: [inst[i].name, inst[j].name], ...contact(inst[i], inst[j]) })
		}
		return out
	}
}

/** The sprite records of the named sprites, sorted by name (the PNGs' hashes and sizes are in sprites.js: a browser has no files). */
export function sprite_records(names) {
	const out = {}
	for (const n of [...names].sort()) {
		if (!hasOwn(SPRITE_RECORDS, n)) throw new Error(`'${n}'`)
		out[n] = { ...SPRITE_RECORDS[n] }
	}
	return out
}

/** An item's props: its type's defaults, then its own, with a changed material bringing its own values unless the item changed them too. */
export function props_of(item) {
	const t = TYPES[item.type]
	const P = t.defaults()
	const own = item.props ?? null
	if (own) for (const k of Object.keys(own)) setOwn(P, k, own[k])
	if (t.material && truthy(own && own.material) && own.material !== t.material) {
		const m = MATERIALS[P.material]
		for (const k of MATERIAL_KEYS) if (!(own && hasOwn(own, k))) P[k] = m[k]
	}
	return P
}

export function camera_of(stage) {
	const W = 1536
	const H = 1024
	const { x0, x1, y0, y1 } = stage
	const ppm = pymin(div(W, x1 - x0), div(H, y1 - y0))
	const px = pyRoundInt((W - (x1 - x0) * ppm) / 2 - x0 * ppm)
	const py = pyRoundInt(H - (H - (y1 - y0) * ppm) / 2 + y0 * ppm)
	return { canvas: { width: W, height: H }, origin: { x: 0, y: 0 }, pixel: { x: px, y: py }, pixelsPerMeter: pyRound(ppm, 3) }
}

/** scene -> {doc: the engine document, resolved: {item id: the props it was built with}}. */
export function build(scene) {
	const sb = new SceneBuilder()
	const resolved = {}
	const items = scene.items ?? []
	for (const item of items) {
		if (!(typeof item.type === "string" && item.type in TYPES)) continue
		const P = props_of(item)
		setOwn(resolved, item.id, P)
		const t = TYPES[item.type]
		t.build_fn(new Ctx(sb, item, P), P)
		const auto = t.auto_keys()
		if (auto.size) {
			// what an auto prop's built value was made for, so the inspector can tell it from another state's: the item's type, and which of
			// the auto props and what they follow the item sets itself (a typed weight is not "automatic" any more once the item drops it)
			P._type = item.type
			P._own = pySorted(Object.keys(item.props ?? {}).filter((k) => auto.has(k)))
		}
	}
	// every solid says which item type and which of its parts it is: the 3D view picks its model by (itemType, part)
	const type_of = new Map(items.map((i) => [i.id, i.type]))
	for (const s of sb.solids) {
		if (!("itemType" in s)) s.itemType = type_of.has(s.item) ? type_of.get(s.item) : null
		if (!("part" in s)) s.part = s.id.includes("/") ? s.id.slice(s.id.indexOf("/") + 1) : s.id
	}
	const itemOf = (id) => items.find((i) => i.id === id) ?? {}
	const held = sb.solids.filter((s) => s.kind === "dynamic" && truthy(itemOf(s.item).held)).map((s) => s.id)
	const release = { parts: held, at: scene.release !== undefined ? toFloat(scene.release) : 0.5 }
	const organic = []
	const hand_ball = sb.solids.find((s) => held.includes(s.id) && s.body.kind === "ball")
	if (hand_ball !== undefined) {
		organic.push({
			kind: "organic", id: "hand", words: "a child's hand and forearm in a blue sleeve", at: { ...hand_ball.at }, reach: { x: -0.5, y: 0.25 },
			poses: ["holding", "opening", "open"], depth: 5
		})
		release.holder = { id: "hand", from: "holding", via: [{ pose: "opening", seconds: 0.08 }], to: "open" }
		for (const n of ["hand-holding", "hand-opening", "hand-open"]) sb.use_sprite(n)
	}
	const doc = {
		version: 1, id: scene.id !== undefined ? scene.id : "sandbox", camera: camera_of(scene.stage), materials: sb.materials, contacts: sb.contacts(),
		solids: sb.solids, animated: sb.animated, organic, release, seconds: scene.seconds !== undefined ? toFloat(scene.seconds) : 4.5,
		sprites: sprite_records(sb.sprites_used)
	}
	if (sb.joints.length) doc.joints = sb.joints
	return { doc, resolved }
}

// ---------------------------------------------------------------- the core types
export const WOOD_PLANKS = ["varnished hardwood", "domino wood"]

function build_table(c, P) {
	c.slab("top", P.width, P.thickness, 1.6, 0, -P.thickness / 2, { kind: "static", words: "a varnished hardwood table top" })
}

register(new ItemType("table", "Table top", "Scenery", build_table, {
	dynamic: false, material: "varnished hardwood", materials: [...WOOD_PLANKS, "steel"],
	props: [new Prop("width", "Width", 3.7, 0.5, 8.0, 0.05, "m"), new Prop("thickness", "Thickness", 0.15, 0.02, 0.4, 0.01, "m")],
	tags: ["floor", "ground", "base", "bench", "desk"], anchor: "the middle of its top surface",
	description: "The surface everything stands on.", edit: [{ kind: "length", prop: "width", y: "surface" }]
}))

function build_wall(c, P) {
	c.slab("wall", P.thickness, P.height, 0.3, 0, P.height / 2, { kind: "static", words: "a wall", hidden_3d: truthy(P.invisible_in_3d) })
}

register(new ItemType("wall", "Wall", "Scenery", build_wall, {
	dynamic: false, material: "varnished hardwood", materials: [...WOOD_PLANKS, "steel"],
	props: [
		new Prop("height", "Height", 1.4, 0.05, 3.0, 0.01, "m"), new Prop("thickness", "Thickness", 0.05, 0.005, 0.3, 0.005, "m"),
		new Prop("invisible_in_3d", "See-through", false, { kind: "bool", help: "A safety wall, invisible except as a faint pane while selected" })
	],
	tags: ["barrier", "side", "stop", "backstop"], anchor: "the middle of its base", edit: [{ kind: "top", prop: "height" }]
}))

function build_plank(c, P) {
	c.slab("plank", P.length, P.thickness, P.depth, 0, 0, { kind: null, words: "a tilted varnished hardwood plank", legs: truthy(P.legs) })
}

register(new ItemType("plank", "Wooden plank", "Surfaces & ramps", build_plank, {
	dynamic: false, material: "varnished hardwood", materials: [...WOOD_PLANKS, "steel"],
	props: [
		new Prop("length", "Length", 1.0, 0.05, 4.0, 0.01, "m"), new Prop("thickness", "Thickness", 0.022, 0.003, 0.2, 0.001, "m"),
		new Prop("depth", "Width (front to back)", 0.12, 0.01, 1.0, 0.01, "m", "Front to back: only for the look; the physics runs in one plane"),
		new Prop("legs", "Legs under it", true, { kind: "bool" })
	],
	tags: ["ramp", "board", "slope", "incline", "shelf", "beam", "track"], description: "A varnished hardwood plank. Tilt it to make a ramp.",
	facts: "Fixed in place · 1 m × 22 mm", edit: [{ kind: "length", prop: "length" }, { kind: "rotate" }]
}))

/** The material in a ball d across, m³: solid, or a hollow shell `wall` thick. */
function _ball_volume(d, wall = null) {
	const r = d / 2
	// (a ball type that lists no `wall` prop still reads one the item sets: clean() keeps a short string there, and Python's `r - wall` then
	// raises, which the server answers with HTTP 500; any other value is a number or a bool, which both languages subtract alike)
	if (typeof wall === "string" && wall.length > 0) throw new TypeError("unsupported operand type(s) for -: 'float' and 'str'")
	return (4 / 3) * Math.PI * (cube(r) - (truthy(wall) ? cube(pymax(0.0, r - wall)) : 0.0))
}

/** A ball of a real size and weight (its density follows); hollow when hollow_wall is set.
 *  The stated weight is for the stated size: resize it and the weight follows the volume of material (solid: (d/d0)³; hollow: its
 *  wall grows with d/d0 too) unless the item sets "mass" itself (an explicit weight is kept), and a wall the item sets is kept.
 *  The built values go into the item's resolved props, which is what the inspector shows.
 *  ball_type(key, name, diameter, mass, material, {hollow_wall, sprite, pattern, look, tags, description, source, facts, color, inertia, category}) */
export function ball_type(key, name, diameter, mass, material, kw = {}) {
	const { hollow_wall = null, sprite = null, pattern = null, look = null, tags = [], description = "", source = "", facts = "", color = null, inertia = null, category = "Balls" } = kw
	const ref = _ball_volume(diameter, hollow_wall)

	function build(c, P) {
		const given = c.item.props ?? {}
		const d = P.diameter
		const r = d / 2
		if (hollow_wall !== null && !hasOwn(given, "wall")) P.wall = hollow_wall * (d / diameter)
		const wall = truthy(P.hollow) ? P.wall ?? null : null
		const vol = _ball_volume(d, wall)
		if (!hasOwn(given, "mass")) P.mass = mass * div(vol, ref)
		const x = div(P.mass, vol)
		const density = x >= 1 ? pyRound(x, 6) : Number(fmtG(x, 6)) // a very light ball keeps 6 significant figures (6 decimals would round 1e-7 kg to no weight)
		const extra = {}
		if (truthy(pattern)) extra.pattern = pattern
		if (truthy(color) || truthy(P.color)) extra.color = truthy(P.color) ? P.color : color
		// The engine draws every solid that names a sprite as one rigid object and refuses a document where two of them differ in body or words,
		// so the type's sprite goes only on a ball whose body is the stated ball's (its size and its stated wall, none for a solid type): one that is
		// resized, filled in (hollow off), given a wall of its own, or whose wall followed a size a hair off the stated one, is drawn without it.
		// (`wall == hollow_wall` as Python compares: None only equals None, a bool is the number 0 or 1, a string equals no number)
		const stated = Math.abs(P.diameter - diameter) < 1e-9 && pyRound(r, 5) === pyRound(diameter / 2, 5) && (typeof wall === "boolean" ? Number(wall) : wall) === hollow_wall
		c.ball("ball", r, 0.0, 0.0, {
			material: c.mat({ density }), look, wall, inertia, sprite: stated ? sprite : null,
			words: `a ${name.toLowerCase()}`, ...extra
		})
	}
	// Wall (hollow balls): from what a 5 mm ball's default wall comes to (rounded down), or the old minimum of 0.2 mm if that is lower, so the range always
	// holds what it held before, to what a 1 m ball's comes to; a step of 1 µm keeps every stated wall on the slider's grid (0.0002 is on it)
	const wall_lo = hollow_wall !== null ? pymin(0.0002, pymax(1e-6, Math.floor((hollow_wall * 0.005) / diameter * 1e6 + 1e-6) / 1e6)) : null
	// Weight: a typed value may be anything the size range (5 mm to 1 m) can make of the stated weight, solid or hollow, so the box reaches from
	// below a 5 mm ball's weight (a power of ten, which is also the step) up to a 1 m solid ball's; the slider covers the handy part
	const smallest = (mass * _ball_volume(0.005, wall_lo)) / ref
	const w_lo = Number(`1e${floorLog10(smallest)}`)
	const biggest = pymax(20.0, Math.ceil(((mass / ref) * Math.PI) / 6))
	const props = [
		new Prop("diameter", "Diameter", diameter, 0.005, 1.0, 0.001, "m"),
		new Prop("mass", "Weight", mass, w_lo, biggest, w_lo, "kg", "Follows the size until you type a weight", {
			auto: ["diameter", "hollow", "wall"], slider_max: Number(fmtG(pymin(biggest, 20 * mass), 3))
		})
	]
	if (hollow_wall !== null) {
		props.push(
			new Prop("hollow", "Hollow", true, { kind: "bool" }),
			new Prop("wall", "Wall thickness", hollow_wall, wall_lo, pymax(0.05, Math.ceil((hollow_wall / diameter) * 1000) / 1000), 1e-6, "m", "Follows the size until you set it", { auto: ["diameter"] })
		)
	}
	return register(new ItemType(key, name, category, build, {
		props, tags: [...tags, "ball", "sphere", "round"], description, source, material, materials: [material],
		facts: truthy(facts) ? facts : mass < 1 ? `${fmtF(diameter * 1000, 0)} mm · ${fmtF(mass * 1000, 1)} g` : `${fmtF(diameter * 100, 1)} cm · ${fmtF(mass, 2)} kg`,
		edit: [{ kind: "radius", prop: "diameter" }]
	}))
}

const _V60 = (4 / 3) * Math.PI * cube(0.03)
ball_type("superball", "Superball", 0.06, 906 * _V60, "solid rubber", {
	sprite: "rubber", look: "rubber", tags: ["bouncy", "rubber", "red", "super ball", "high bounce"],
	description: "A solid rubber superball: very bouncy, and it grips and spins hard when it bounces at an angle.",
	source: "102.5 g, 60 mm superball measured by Cross, Am. J. Phys. 70, 482 (2002)."
})
ball_type("plastic-ball", "Hollow plastic ball", 0.06, 950 * (4 / 3) * Math.PI * (cube(0.03) - cube(0.0294)), "hollow plastic", {
	hollow_wall: 0.0006, sprite: "plastic", look: "plastic", tags: ["yellow", "light", "hollow", "toy"], description: "A light hollow plastic toy ball.",
	source: "Physics Factbook: hollow hard plastic ball, 92 cm drop, 43.6 cm rebound."
})
ball_type("clay-ball", "Modelling clay ball", 0.06, 1570 * _V60, "modeling clay", {
	sprite: "clay", look: "clay", tags: ["plasticine", "dead", "no bounce", "green", "soft"], description: "A ball of modelling clay: it doesn't bounce, it dents.",
	source: "Van Aken plasticine, 1570 kg/m³."
})

function build_domino(c, P) {
	const h = P.height
	c.slab("domino", P.thickness, h, P.depth, 0, h / 2, { words: "a wooden domino block", look: "light wood" })
}

register(new ItemType("domino", "Domino", "Dominoes", build_domino, {
	material: "domino wood", materials: ["domino wood", "varnished hardwood"],
	props: [
		new Prop("height", "Height", 0.05, 0.01, 0.6, 0.001, "m"), new Prop("thickness", "Thickness", 0.008, 0.002, 0.1, 0.0005, "m"),
		new Prop("depth", "Width (front to back)", 0.025, 0.005, 0.3, 0.001, "m")
	],
	tags: ["tile", "block", "chain", "topple"], anchor: "the middle of its base", description: "One standard domino (5 x 2.5 x 0.8 cm).",
	source: "Larham's dominoes, 51.6 x 25.5 x 7.9 mm (arXiv:1302.3311).", edit: [{ kind: "top", prop: "height" }, { kind: "rotate" }]
}))

function build_domino_row(c, P) {
	let x = 0.0
	let h = P.first_height
	let prev
	for (let i = 0; i < Math.trunc(P.count); i++) {
		if (i) x += P.spacing * prev
		const t = h * P.thickness_ratio
		c.slab(`domino${i + 1}`, t, h, h / 2, x, h / 2, { words: "a wooden domino block", look: "light wood" })
		prev = h
		h *= P.growth
	}
}

register(new ItemType("domino-row", "Domino row (growing)", "Dominoes", build_domino_row, {
	material: "domino wood", materials: ["domino wood", "varnished hardwood"],
	props: [
		new Prop("count", "How many", 7, 1, 30, 1, "", "", { kind: "int" }), new Prop("first_height", "First domino height", 0.098, 0.01, 0.4, 0.001, "m"),
		new Prop("growth", "Each one bigger by", 1.193, 1.0, 1.7, 0.005, "×", "A domino can topple one about 1.5× its size"),
		new Prop("spacing", "Spacing", 0.568, 0.2, 1.2, 0.005, "heights", "Gap between dominoes, in domino heights"),
		new Prop("thickness_ratio", "Thickness", 1 / 6, 0.05, 0.5, 0.005, "of height")
	],
	tags: ["dominoes", "chain reaction", "row", "topple", "cascade"], anchor: "the first domino's base",
	description: "A row of dominoes, each a little bigger than the last, so the wave gains energy.",
	source: "Growing chains: Whitehead, Am. J. Phys. 51, 182 (1983).", edit: [{ kind: "top", prop: "first_height" }]
}))

function build_seesaw(c, P) {
	const L = P.length
	const th = P.plank_thickness
	const tilt = P.tilt * D2R
	const off = P.pivot_offset
	const right = L / 2 - off
	const cy = right * sin(tilt) + (th / 2) * cos(tilt)
	const plank_center = [-off * cos(tilt), cy + off * sin(tilt)]
	const fh = cy - th / 2 - 0.004
	c.slab("fulcrum", 0.026, fh, 0.06, 0, fh / 2, { kind: "static", words: "a wooden fulcrum block" })
	const plank = c.slab("plank", L, th, 0.04, plank_center[0], plank_center[1], {
		langle: -P.tilt, words: "a thin varnished hardwood seesaw plank", pivot: { x: pyRound(off, 5), y: 0.0 }
	})
	if (truthy(P.lip)) {
		const s = {
			kind: c.kind, id: `${c.item.id}/lip`, words: "a small wooden lip at the seesaw's end", item: c.item.id, look: "wood",
			body: { kind: "slab", width: 0.008, height: 0.026, depth: 0.04 }, material: c.mat(),
			at: { x: pyRound(L / 2 - 0.004, 5), y: pyRound(th / 2 + 0.013, 5) }, parent: plank,
			placeholder: { fill: "#c8955a" }, render: { kind: "procedural", shade: "#a8743f" }, depth: 2
		}
		c.sb.solids.push(s)
	}
}

register(new ItemType("seesaw", "Seesaw", "Rods & hinges", build_seesaw, {
	material: "varnished hardwood", materials: [...WOOD_PLANKS, "steel"],
	props: [
		new Prop("length", "Length", 0.598, 0.1, 2.0, 0.005, "m"), new Prop("tilt", "Tilt", 12.452, 1.0, 40.0, 0.25, "°", "Its right end rests on the floor"),
		new Prop("pivot_offset", "Pivot off centre", -0.046, -0.4, 0.4, 0.002, "m", "Negative makes the right arm longer"),
		new Prop("plank_thickness", "Plank thickness", 0.012, 0.004, 0.05, 0.001, "m"),
		new Prop("lip", "Lip at the right end", true, { kind: "bool", help: "Holds a ball on the end" })
	],
	tags: ["lever", "teeter", "catapult", "fling", "launcher", "pivot"], anchor: "the floor under its pivot",
	description: "A plank hinged on a fulcrum. Hit the raised end and the other end flings what sits on it.",
	edit: [{ kind: "tiltEnd", prop: "tilt" }, { kind: "armEnd", prop: "length" }]
}))

function build_box(c, P) {
	const bw = P.width
	const bwall = P.wall
	const bt = P.thickness
	c.slab("floor", bw, bt, P.depth, 0, -bt / 2, { kind: "static", words: "the box's wooden floor" })
	c.slab("left", bt, bwall, P.depth, -bw / 2 + bt / 2, bwall / 2, { kind: "static", words: "the box's left wall" })
	c.slab("right", bt, bwall, P.depth, bw / 2 - bt / 2, bwall / 2, { kind: "static", words: "the box's right wall" })
	if (truthy(P.hung)) {
		c.cord("cord-l", -bw / 2 + bt / 2, bwall)
		c.cord("cord-r", bw / 2 - bt / 2, bwall)
	}
}

register(new ItemType("box", "Open box", "Containers", build_box, {
	dynamic: false, material: "varnished hardwood", materials: [...WOOD_PLANKS, "steel"],
	props: [
		new Prop("width", "Width", 0.26, 0.05, 1.5, 0.005, "m"), new Prop("wall", "Depth", 0.13, 0.02, 1.0, 0.005, "m", "Wall height; a hollow ball bounces out of a shallow box"),
		new Prop("thickness", "Wall thickness", 0.012, 0.003, 0.05, 0.001, "m"), new Prop("depth", "Front to back", 0.12, 0.02, 1.0, 0.01, "m"),
		new Prop("hung", "Hung on cords", true, { kind: "bool" })
	],
	tags: ["crate", "target", "bin", "container", "catch", "goal", "basket"], anchor: "the middle of its floor's top",
	description: "An open wooden box, hung on cords or standing. A target to land things in.",
	edit: [{ kind: "boxWidth", prop: "width" }, { kind: "top", prop: "wall" }]
}))

// ---------------------------------------------------------------- the rest of the catalog
/** What a catalog module's register_all(g) gets (machines/items.py passes globals(); catalog_items.py takes the names it NEEDS). */
export const FRAMEWORK = {
	register, ItemType, Prop, ball_type, MATERIALS, measured, add_look, LOOK_FILL, LOOK_SHADE, D2R, WOOD_PLANKS, CATEGORIES, TYPES, polygon_problem,
	define_material, Ctx, LOOKS, CORD, props_of, material_of, MATERIAL_KEYS, MEASURED, SceneBuilder, MATERIAL_INTS,
	py // pymath.js: pyRound (round), fmtF/fmtG (format), hypot, floatRepr, PyInt, truthy, ...
}
export const CATALOG_MODULES = []
/** Registers one catalog file's types: use_catalog_module("catalog_items", register_all); register_all gets FRAMEWORK. Call it after this module loads. */
export function use_catalog_module(name, register_all) {
	if (!CATALOG_MODULES.includes(name)) CATALOG_MODULES.push(name)
	register_all(FRAMEWORK)
}

// ---------------------------------------------------------------- what happened
/** Each solid's world pose [x, y, angle] at the start, a Map keyed by solid id. */
export const _world_poses = rube._world

/** Plain-language results: the goals, each moving item's story, and the first hits between items in order. */
const FALL_MIN_DEG = 20 // ai/goals.mjs: the least and the most a body must turn to have fallen, and the margin
const FALL_MAX_DEG = 85 // past its tipping angle (degrees)
const FALL_MARGIN_DEG = 5
const R2D = 180 / Math.PI

/** A JSON number that is a finite float (not a bool), else null (a goal's own fields are whatever the scene says). */
function _num(v) {
	return typeof v === "number" && Number.isFinite(v) ? v : null
}

/** A length for a label, as ai/goals.mjs writes it: 1.25 m, 12.3 cm. */
function _short_m(m) {
	let t = m >= 1 ? fmtF(m, 2) : fmtF(m * 100, 1)
	if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, "")
	return m >= 1 ? `${t} m` : `${t} cm`
}

/** The balance-point rule of ai/goals.mjs (trackTools: bodies, tipAngle, fell), so the run's summary counts a fallen body as the AI's
 *  goal check does: an item's rigid bodies that can fall (weld groups not hinged to the world or a parent; round ones only when it has
 *  nothing else) have fallen when turned past their tipping angle (atan(base / height) of their outline box at the start, + 5 degrees,
 *  within 20 to 85) or knocked down at least half their smaller side and 2 cm (not a body on wheels). */
class _Fall {
	constructor(doc, fr) {
		this.f0 = fr[0].placements
		this.end = fr[fr.length - 1].placements
		const by_id = new Map(doc.solids.map((s) => [s.id, s]))
		const root_of = (s) => {
			let r = s
			for (let k = 0; k < 50; k++) {
				if (!(truthy(r.parent) && !truthy(r.pivot) && by_id.has(r.parent))) break
				r = by_id.get(r.parent)
			}
			return r
		}
		this.groups = new Map()
		for (const s of doc.solids) {
			if (s.kind !== "dynamic") continue
			const r = root_of(s)
			if (!this.groups.has(s.item)) this.groups.set(s.item, [])
			const lst = this.groups.get(s.item)
			let gr = lst.find((g) => g.root === r)
			if (gr === undefined) {
				gr = { root: r, members: [] }
				lst.push(gr)
			}
			gr.members.push(s)
		}
		this.cache = new Map()
	}
	_points(s, pose) {
		const b = s.body
		let pts
		if (b.kind === "ball") {
			const r = b.radius
			pts = [[-r, 0], [r, 0], [0, -r], [0, r]]
		} else if (b.kind === "slab") {
			const hw = b.width / 2
			const hh = b.height / 2
			const hb = hw * (hasOwn(b, "taper") ? b.taper : 1)
			pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
		} else pts = b.points.map((p) => [p.x, p.y])
		const c = cos(pose.angle)
		const n = sin(pose.angle)
		return pts.map(([x, y]) => [pose.x + x * c - y * n, pose.y + x * n + y * c])
	}
	bodies(iid) {
		if (this.cache.has(iid)) return this.cache.get(iid)
		const all = (this.groups.get(iid) ?? []).filter((g) => !truthy(g.root.pivot))
		const round = (g) => g.members.every((m) => m.body.kind === "ball")
		const keep = all.some((g) => !round(g)) ? all.filter((g) => !round(g)) : all
		const out = keep.map((g) => {
			const pts = g.members.flatMap((m) => this._points(m, this.f0[m.id]))
			const xs = pts.map((p) => p[0])
			const ys = pts.map((p) => p[1])
			const w = pts.length ? maxOf(xs) - minOf(xs) : 0.0
			const h = pts.length ? maxOf(ys) - minOf(ys) : 0.0
			return { ...g, w, h, round: round(g), wheeled: keep.length < all.length }
		})
		this.cache.set(iid, out)
		return out
	}
	static _wrap_deg(rad) {
		let d = (rad * R2D) % 360
		if (d > 180) d -= 360
		if (d < -180) d += 360
		return Math.abs(d)
	}
	tip(b) {
		return b.w > 0 && b.h > 0 ? pymin(FALL_MAX_DEG, pymax(FALL_MIN_DEG, Math.atan(b.w / b.h) * R2D + FALL_MARGIN_DEG)) : 45
	}
	fell(b) {
		const rid = b.root.id
		const turned = b.round ? 0 : _Fall._wrap_deg(this.end[rid].angle - this.f0[rid].angle)
		const mid = (at) => pySum(b.members.map((m) => at[m.id].y)) / b.members.length
		const dropped = mid(this.f0) - mid(this.end)
		return turned > this.tip(b) || (!b.wheeled && dropped >= pymax(0.02, pymin(b.w, b.h) / 2))
	}
}

/** Plain-language results: the goals, each moving item's story, and the first hits between items in order. A goal is
 *  {kind: "in", item, container} (it ends between the container's walls), {kind: "falls", item | items: [id]} (every rigid body of them ends
 *  fallen, _Fall), {kind: "hits", item, target, before_s?} (something of it touches something of the target, by before_s if given) or
 *  {kind: "moves", item, min_m?} (the mean of its moving parts ends at least min_m, default 5 cm, from where it started), as ai/goals.mjs
 *  checks them; each is reported {label, ok, item, container} ("in", as always) or {label, ok, kind, ...} (the others). */
export function summarize(scene, doc, track) {
	const items = new Map((scene.items ?? []).map((i) => [i.id, i]))
	const name = (iid) => (items.has(iid) ? (truthy(items.get(iid).name) ? items.get(iid).name : TYPES[items.get(iid).type].name) : iid)
	const item_of = new Map(doc.solids.map((s) => [s.id, s.item]))
	const fr = track.frames
	const T = fr.map((f) => f.t)
	const first = []
	const seen = new Set()
	const moved_first = new Map()
	const hyp = (k, j, sid) => hypot(fr[k].placements[sid].x - fr[j].placements[sid].x, fr[k].placements[sid].y - fr[j].placements[sid].y)
	for (const iid of items.keys()) {
		const sol = doc.solids.filter((s) => s.item === iid && s.kind === "dynamic").map((s) => s.id)
		for (let k = 0; k < fr.length; k++) {
			if (sol.length && maxOf(sol.map((sid) => hyp(k, 0, sid))) > 0.005) {
				moved_first.set(iid, T[k])
				break
			}
		}
	}
	const dyn = (iid) => doc.solids.some((s) => s.item === iid && s.kind === "dynamic")
	for (const h of track.impacts ?? []) {
		const a = item_of.get(h.a)
		const b = item_of.get(h.b)
		if (a === undefined || b === undefined || a === null || b === null || a === b) continue
		const key = JSON.stringify(a < b ? [a, b] : [b, a])
		if (seen.has(key)) continue
		seen.add(key)
		let mover = dyn(a) ? a : b
		if (dyn(a) && dyn(b)) {
			// two moving things: the one that was already moving struck the other
			const ma = moved_first.has(a) ? moved_first.get(a) : 1e9
			const mb = moved_first.has(b) ? moved_first.get(b) : 1e9
			mover = mb < ma ? b : a
		}
		const other = mover === a ? b : a
		const nm = name(mover)
		const verb = nm.endsWith("s") && !nm.endsWith("ss") ? "hit" : "hits"
		first.push({ t: pyRound(h.t, 3), a: mover, b: other, text: `${nm} ${verb} ${name(other)}`, speed: h.speed })
	}
	first.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0))
	const stories = []
	let fall = null
	for (const [iid, it] of items) {
		const sol = doc.solids.filter((s) => s.item === iid && s.kind === "dynamic")
		if (!sol.length) continue
		const t0 = fr[0].placements
		let moved_at = null
		let max_v = 0.0
		// A speed is a position change over about a frame or more: the engine's frame nearest each impact sits 2 ms from its
		// neighbour, where a ball pushed back out of the surface it struck (a few mm in one step) would count as 6 m/s.
		const span = 0.9 / (truthy(track.fps) ? track.fps : 120)
		let j = 0
		for (let k = 1; k < fr.length; k++) {
			while (j + 1 < k && T[k] - T[j + 1] >= span) j++
			const dt = T[k] - T[j]
			if (dt >= span) {
				const v = maxOf(sol.map((s) => hyp(k, j, s.id) / dt))
				max_v = pymax(max_v, v)
			}
			const d = maxOf(sol.map((s) => hypot(fr[k].placements[s.id].x - t0[s.id].x, fr[k].placements[s.id].y - t0[s.id].y)))
			if (moved_at === null && d > 0.01) moved_at = T[k]
		}
		const end = fr[fr.length - 1].placements
		const story = { item: iid, name: name(iid), moved_at, max_speed: pyRound(max_v, 2) }
		if (it.type === "domino-row") {
			// (by the balance-point rule the AI's goal check uses, _Fall: a domino leaning on the next past its tipping angle has fallen)
			fall = fall ?? new _Fall(doc, fr)
			const bodies = fall.bodies(iid)
			const fallen = bodies.filter((b) => fall.fell(b)).length
			story.text = `${fallen} of ${bodies.length} fall`
			story.ok = fallen === bodies.length
		} else if (it.type === "seesaw" || sol.some((s) => "pivot" in s)) {
			let turn = 0
			if (sol.some((s) => "pivot" in s)) {
				const turns = []
				for (const f of fr) for (const s of sol) if ("pivot" in s) turns.push(Math.abs(f.placements[s.id].angle - t0[s.id].angle))
				turn = maxOf(turns)
			}
			story.text = `turns ${fmtF(degrees(turn), 0)}°`
			story.ok = degrees(turn) > 5
		} else {
			story.text = moved_at === null ? "doesn't move" : `top speed ${fmtF(max_v, 1)} m/s`
			story.ok = moved_at !== null
		}
		stories.push(story)
	}
	const goals = []
	const poses = new Map(Object.entries(fr[fr.length - 1].placements).map(([sid, p]) => [sid, [p.x, p.y]]))
	const known = (v) => typeof v === "string" && items.has(v)
	for (const g of scene.goals ?? []) {
		const kind = g.kind
		if (kind === "in" && items.has(g.item) && items.has(g.container)) {
			const ok = inside(scene, doc, poses, g.item, g.container)
			goals.push({ label: truthy(g.label) ? g.label : `${name(g.item)} ends in the ${pyLower(name(g.container))}`, ok, item: g.item, container: g.container })
		} else if (kind === "falls") {
			const ids = Array.isArray(g.items) && g.items.length ? g.items : g.item !== null && g.item !== undefined ? [g.item] : []
			if (!ids.length || !ids.every(known)) continue
			fall = fall ?? new _Fall(doc, fr)
			const bodies = ids.flatMap((i) => fall.bodies(i))
			const down = bodies.filter((b) => fall.fell(b)).length
			const who = ids.length > 1 ? `all ${ids.length} of ${ids.slice(0, 3).map(name).join(", ")}${ids.length > 3 ? "…" : ""}` : name(ids[0])
			goals.push({ label: truthy(g.label) ? g.label : `${who} ${ids.length > 1 ? "fall" : "falls"} over`, ok: bodies.length > 0 && down === bodies.length, kind: "falls", items: ids, fallen: down, of: bodies.length })
		} else if (kind === "hits" && known(g.item) && known(g.target)) {
			const a = new Set(doc.solids.filter((s) => s.item === g.item).map((s) => s.id))
			const b = new Set(doc.solids.filter((s) => s.item === g.target).map((s) => s.id))
			let t = null
			for (const h of track.impacts ?? []) if ((a.has(h.a) && b.has(h.b)) || (a.has(h.b) && b.has(h.a))) t = t === null || h.t < t ? h.t : t
			const by = _num(g.before_s)
			const when = by === null ? "" : ` by ${fmtF(by, 2).replace(/0+$/, "").replace(/\.$/, "")} s`
			goals.push({ label: truthy(g.label) ? g.label : `${name(g.item)} hits ${name(g.target)}${when}`, ok: t !== null && (by === null || t <= by), kind: "hits", item: g.item, target: g.target, t: t === null ? null : pyRound(t, 3) })
		} else if (kind === "moves" && known(g.item)) {
			const sids = doc.solids.filter((s) => s.item === g.item && s.kind === "dynamic").map((s) => s.id)
			let least = _num(g.min_m)
			least = least === null ? 0.05 : least
			let d = 0.0
			if (sids.length) {
				const c0 = [pySum(sids.map((i) => fr[0].placements[i].x)) / sids.length, pySum(sids.map((i) => fr[0].placements[i].y)) / sids.length]
				const c1 = [pySum(sids.map((i) => fr[fr.length - 1].placements[i].x)) / sids.length, pySum(sids.map((i) => fr[fr.length - 1].placements[i].y)) / sids.length]
				d = hypot(c1[0] - c0[0], c1[1] - c0[1])
			}
			goals.push({ label: truthy(g.label) ? g.label : `${name(g.item)} moves at least ${_short_m(least)}`, ok: sids.length > 0 && d >= least, kind: "moves", item: g.item, moved_m: pyRound(d, 4) })
		}
	}
	return { goals, stories, events: first.slice(0, 16) }
}

/** A slab's (tapered: its true trapezoid) or a polygon's corners in the world, counter-clockwise. */
function _corners(s, pose) {
	const [x, y, a] = pose
	const b = s.body
	let pts
	if (b.kind === "polygon") pts = b.points.map((p) => [p.x, p.y])
	else {
		const hw = b.width / 2
		const hh = b.height / 2
		const hb = hw * ("taper" in b ? b.taper : 1.0)
		pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
	}
	const c = cos(a)
	const n = sin(a)
	return pts.map(([px, py]) => [x + px * c - py * n, y + px * n + py * c])
}

/** How deep two solids interpenetrate at the start, m (0 if apart): rube's for balls and slabs, and here for polygons
 *  (separating axes between two outlines; a ball's centre against an outline). */
export function _overlap_depth(sa, pa, sb, pb) {
	const ka = sa.body.kind
	const kb = sb.body.kind
	if (ka !== "polygon" && kb !== "polygon") return rube._overlap_depth(sa, pa, sb, pb)
	if (ka === "ball" || kb === "ball") {
		const [[sc, pc], [so, po]] = ka === "ball" ? [[sa, pa], [sb, pb]] : [[sb, pb], [sa, pa]]
		const r = sc.body.radius
		const [cx, cy] = pc
		const P = _corners(so, po)
		let inside = Infinity
		let near = Infinity
		for (let i = 0; i < P.length; i++) {
			const [x1, y1] = P[i]
			const [x2, y2] = P[(i + 1) % P.length]
			const ex = x2 - x1
			const ey = y2 - y1
			const m = hypot(ex, ey)
			inside = pymin(inside, div(ex * (cy - y1) - ey * (cx - x1), m)) // distance inside this side's line (negative: outside)
			const u = pymax(0.0, pymin(1.0, div((cx - x1) * ex + (cy - y1) * ey, m * m)))
			near = pymin(near, hypot(cx - x1 - u * ex, cy - y1 - u * ey))
		}
		if (inside >= 0) return r + inside
		return near < r ? r - near : 0.0
	}
	const A = _corners(sa, pa)
	const B = _corners(sb, pb)
	let depth = Infinity
	for (const poly of [A, B]) {
		for (let i = 0; i < poly.length; i++) {
			const [x1, y1] = poly[i]
			const [x2, y2] = poly[(i + 1) % poly.length]
			let ax = -(y2 - y1)
			let ay = x2 - x1
			const m = hypot(ax, ay)
			ax = div(ax, m)
			ay = div(ay, m)
			const pA = A.map(([px, py]) => px * ax + py * ay)
			const pB = B.map(([px, py]) => px * ax + py * ay)
			const o = pymin(maxOf(pA), maxOf(pB)) - pymax(minOf(pA), minOf(pB))
			if (o <= 0) return 0.0
			depth = pymin(depth, o)
		}
	}
	return depth
}

/** A box [x0, y0, x1, y1] that holds everything _overlap_depth looks at of a solid (a slab: its rectangle and, with a taper, its trapezoid; a polygon:
 *  its corners; a ball: its disc), a hair larger than the shape; null when that can't be known (then the pair is always measured). */
function _bounds(s, pose) {
	const b = s.body
	const pad = 1e-9 // (more than rounding in the corners could move them: two boxes that do not touch hold two shapes that do not either)
	if (pose === undefined) return null
	const [x, y, a] = pose
	if (b.kind === "ball") return b.radius >= 0 && Number.isFinite(b.radius) ? [x - b.radius - pad, y - b.radius - pad, x + b.radius + pad, y + b.radius + pad] : null
	if (b.kind === "polygon") {
		if (!Array.isArray(b.points) || b.points.length < 3) return null
		let x0 = Infinity
		let y0 = Infinity
		let x1 = -Infinity
		let y1 = -Infinity
		for (const [px, py] of _corners(s, pose)) {
			if (px < x0) x0 = px
			if (px > x1) x1 = px
			if (py < y0) y0 = py
			if (py > y1) y1 = py
		}
		return Number.isFinite(x0 + y0 + x1 + y1) ? [x0 - pad, y0 - pad, x1 + pad, y1 + pad] : null
	}
	if (b.kind !== "slab" || !(b.width > 0 && b.height > 0)) return null // (a slab with no width or height makes the depth test divide by zero: keep every pair that reaches it)
	const hw = b.width / 2
	const hh = b.height / 2
	const hx = pymax(hw, "taper" in b ? Math.abs(hw * b.taper) : hw)
	const c = Math.abs(cos(a))
	const n = Math.abs(sin(a))
	const ex = c * hx + n * hh + pad
	const ey = n * hx + c * hh + pad
	return Number.isFinite(ex + ey + x + y) ? [x - ex, y - ey, x + ex, y + ey] : null
}

/** Plain-language warnings for items that start inside one another (deeper than tol). The depth is compared rounded to 9 decimals (a nanometre),
 *  as items.py does: a pair exactly tol deep (a 3 mm plank through a block) is the tolerance itself, whatever the last bit of the sin and cos of its
 *  angle (V8's and CPython's libm differ there).
 *  The same answer as comparing every pair of solids, but a pair whose boxes do not touch is passed over without measuring it (a pair of items
 *  already reported is not measured again either; measuring changes nothing but a division by zero, which the pairs without a box still reach). */
export function overlaps(scene, doc, tol = 0.003) {
	const items = new Map((scene.items ?? []).map((i) => [i.id, i]))
	const name = (iid) => (items.has(iid) ? (truthy(items.get(iid).name) ? items.get(iid).name : TYPES[items.get(iid).type].name) : iid)
	const world = rube._world(doc)
	const solids = doc.solids
	const typeOf = (iid) => (items.has(iid) ? items.get(iid).type : undefined)
	const n = solids.length
	const owners = new Map() // item id -> a small number, so a pair of items is one integer
	const owner = solids.map((s) => {
		if (!owners.has(s.item)) owners.set(s.item, owners.size)
		return owners.get(s.item)
	})
	const poses = solids.map((s) => world.get(s.id))
	const isStatic = solids.map((s) => s.kind === "static")
	const isTable = solids.map((s) => typeOf(s.item) === "table")
	const boxes = solids.map((s, k) => (tol >= 1e-6 ? _bounds(s, poses[k]) : null))
	const owned = owners.size
	const seen = new Set()
	const out = []
	for (let i = 0; i < n; i++) {
		let ia = i // the solid `a` stands for (it can change to a partner below)
		for (let j = i + 1; j < n; j++) {
			if (owner[ia] === owner[j] || (isStatic[ia] && isStatic[j] && (isTable[ia] || isTable[j]))) continue
			const ba = boxes[ia]
			const bb = boxes[j]
			const boxed = ba !== null && bb !== null
			if (boxed && (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1])) continue
			const key = owner[ia] < owner[j] ? owner[ia] * owned + owner[j] : owner[j] * owned + owner[ia]
			if (boxed) {
				if (seen.has(key) || pyRound(_overlap_depth(solids[ia], poses[ia], solids[j], poses[j]), 9) <= tol) continue
			} else if (pyRound(_overlap_depth(solids[ia], poses[ia], solids[j], poses[j]), 9) <= tol || seen.has(key)) continue
			seen.add(key)
			let a = solids[ia]
			let b = solids[j]
			if (b.kind === "dynamic" && a.kind !== "dynamic") {
				;[a, b] = [b, a] // (as in Python, `a` stays swapped for this solid's remaining partners)
				ia = j
			}
			const na = name(a.item)
			const nb = name(b.item)
			if (a.kind === "dynamic") {
				const many = na.endsWith("s") && !na.endsWith("ss")
				out.push({ items: [a.item, b.item], text: `${na} start${many ? "" : "s"} inside ${nb}: ${many ? "they" : "it"}'ll be shoved out at the start` })
			} else out.push({ items: [a.item, b.item], text: `${na} and ${nb} overlap` })
		}
	}
	return out
}

/** Whether item iid's solids end within container cid's walls (between its floor and the rim). poses: Map solid id -> [x, y]. */
export function inside(scene, doc, poses, iid, cid) {
	const cont = scene.items.find((i) => i.id === cid)
	if (cont === undefined) throw new Error("StopIteration")
	const P = props_of(cont)
	if (!["box", "cup", "bucket", "basket"].includes(cont.type)) return false
	const cx = cont.x
	const cy = cont.y
	const a = (cont.angle ?? 0) * D2R
	const w = "width" in P ? P.width : 0.2
	const wall = "wall" in P ? P.wall : "height" in P ? P.height : 0.1
	const t = "thickness" in P ? P.thickness : 0.012
	for (const s of doc.solids) {
		if (s.item !== iid || s.kind !== "dynamic") continue
		const [x, y] = poses.get(s.id)
		const dx = x - cx
		const dy = y - cy
		const lx = dx * cos(-a) - dy * sin(-a)
		const ly = dx * sin(-a) + dy * cos(-a)
		const r = "radius" in s.body ? s.body.radius : 0
		if (!(-w / 2 + t <= lx && lx <= w / 2 - t && -0.005 <= ly - r && ly - r <= wall)) return false
	}
	return true
}

/** One item of this type alone, built at the origin: its solids, for a catalog card's picture. */
export function preview(key) {
	const { doc } = build({ stage: { x0: -1, x1: 1, y0: -1, y1: 1 }, items: [{ id: "p", type: key, x: 0.0, y: 0.0 }] })
	return { solids: doc.solids, animated: doc.animated, joints: "joints" in doc ? doc.joints : [] }
}

/** A copy that shares nothing with the original (structuredClone keeps the sign of a zero and the key order, as the JSON did; a browser too old to
 *  have it (before 2022) gets the JSON way). */
const deepClone = (v) => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)))

/** The JSON GET /api/catalog serves. */
export function catalog() {
	const types = []
	for (const t of Object.values(TYPES)) {
		const d = t.schema()
		try {
			d.preview = preview(t.key)
		} catch (e) {
			d.preview = { solids: [], animated: [], error: String(e && e.message !== undefined ? e.message : e) } // a broken type still lists, without its picture
		}
		types.push(d)
	}
	// a fresh copy on every call, as every GET /api/catalog was fresh JSON: what a caller changes in it (a look's colour, a type's tags or choices)
	// changes nothing in later catalogs, nor in what clean() accepts
	return deepClone({ categories: CATEGORIES, types, materials: Object.fromEntries(Object.keys(MATERIALS).map((k) => [k, { ...MATERIALS[k] }])), looks: LOOKS })
}
