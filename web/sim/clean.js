// What a scene may hold: web/server.py's clean() and its helpers, with the same clamping, coercion and messages. Plain ES module.
// clean(scene) returns a scene the builder can use (known item types only, every number a finite float inside its catalog range) or throws
// BadScene (the server answered those with HTTP 400 {error: message}).
import { TYPES } from "./items.js"
import { ValueError, hasOwn, pyLen, pyLower, pyRepr, pyRoundInt, pySlice, pyStr, pyStrip, pymax, pymin, setOwn, toFloat } from "./pymath.js"

export const MAX_ITEMS = 200

/** A request the builder can't use: the message says why (HTTP 400). */
export class BadScene extends ValueError {
	constructor(message) {
		super(message)
		this.name = "BadScene"
	}
}

const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const isNone = (v) => v === null || v === undefined

function _short(v) {
	const r = pyRepr(v)
	return pyLen(r) <= 30 ? r : pySlice(r, 27) + "..."
}

/** v as a finite float clamped to [lo, hi]; None -> default (or an error if there is none); anything else unusable -> BadScene. */
function _num(v, what, def = null, lo = null, hi = null) {
	if (isNone(v)) {
		if (def === null) throw new BadScene(`${what} is missing`)
		return toFloat(def)
	}
	if (typeof v === "boolean" || Array.isArray(v) || isDict(v)) throw new BadScene(`${what} must be a number, not ${_short(v)}`)
	let x
	try {
		x = toFloat(v)
	} catch (e) {
		if (e instanceof TypeError || e instanceof ValueError) throw new BadScene(`${what} must be a number, not ${_short(v)}`)
		throw e
	}
	if (!Number.isFinite(x)) throw new BadScene(`${what} must be a finite number, not ${_short(v)}`)
	if (!isNone(lo)) x = pymax(lo, x)
	if (!isNone(hi)) x = pymin(hi, x)
	return x
}

function _bool(v, what) {
	if (typeof v === "boolean") return v
	if (typeof v === "number" && (v === 0 || v === 1)) return v === 1
	if (typeof v === "string") {
		const t = pyLower(pyStrip(v))
		if (["true", "false", "yes", "no", "1", "0"].includes(t)) return ["true", "yes", "1"].includes(t)
	}
	throw new BadScene(`${what} must be true or false, not ${_short(v)}`)
}

const _specs = new WeakMap() // ItemType -> its specs (a type registered again is a new object, so a stale entry is never read)

/** {prop key: spec} for an item type, as the catalog lists them (the material props included): the ones clean() checks with, not to be handed out. */
function specsOf(type_key) {
	const t = TYPES[type_key]
	if (!_specs.has(t)) _specs.set(t, new Map(t.schema().props.map((p) => [p.key, p])))
	return _specs.get(t)
}

/** {prop key: spec} for an item type, as the catalog lists them (the material props included). A copy: changing it changes nothing in what clean() accepts. */
export function prop_specs(type_key) {
	return new Map([...specsOf(type_key)].map(([k, p]) => [k, { ...p, ...(p.choices ? { choices: [...p.choices] } : {}), ...(Array.isArray(p.auto) ? { auto: [...p.auto] } : {}) }]))
}

function _prop(v, spec, what) {
	const kind = spec.kind
	if (kind === "bool") return _bool(v, what)
	if (kind === "choice") {
		if (typeof v === "string" && spec.choices.includes(v)) return v
		throw new BadScene(`${what} must be one of ${spec.choices.join(", ")}, not ${_short(v)}`)
	}
	const x = _num(v, what, null, spec.min, spec.max)
	return kind === "int" ? pyRoundInt(x) : x
}

function _item(i, n, seen) {
	if (!isDict(i)) throw new BadScene(`item ${n + 1} is not an object`)
	const t = i.type
	if (typeof t !== "string" || !(t in TYPES)) return null // an unknown type is left out
	const iid = i.id
	if (typeof iid !== "string" || !(pyLen(iid) > 0 && pyLen(iid) <= 80) || iid.includes("/")) throw new BadScene(`item ${n + 1} (${t}) needs an id of 1 to 80 characters without '/'`)
	if (seen.has(iid)) throw new BadScene(`two items are called ${pyRepr(iid)}`)
	seen.add(iid)
	const out = { ...i }
	for (const [k, hi] of [["x", 1000.0], ["y", 1000.0], ["angle", 1e5]]) out[k] = _num(i[k], `${iid}: ${k}`, 0.0, -hi, hi)
	for (const k of ["held", "fixed"]) if (!isNone(i[k])) out[k] = _bool(i[k], `${iid}: ${k}`)
	if (!isNone(i.name)) out.name = pySlice(pyStr(i.name), 80)
	const props = i.props
	if (!isNone(props) && !isDict(props)) throw new BadScene(`${iid}: props must be an object`)
	const specs = specsOf(t)
	const clean_props = {}
	for (const k of Object.keys(props ?? {})) {
		const v = props[k]
		if (isNone(v)) continue
		if (specs.has(k)) setOwn(clean_props, k, _prop(v, specs.get(k), `${iid}: ${specs.get(k).label}`))
		else if ((typeof v === "boolean" || typeof v === "number" || typeof v === "string") && (typeof v !== "number" || Number.isFinite(v)) && pyLen(pyStr(v)) <= 64) setOwn(clean_props, k, v) // an optional prop the type reads but doesn't list (a ball's colour)
	}
	out.props = clean_props
	return out
}

/** The scene as the server received it: the app's fetch sent JSON.stringify(scene), so a NaN or an infinity arrived as null (and a default
 *  was used), an undefined or a function was left out, a Date was its ISO text, toJSON was honoured, and the server worked on its own copy. A
 *  scene handed in directly gets the same treatment, so it means what it meant over HTTP (and the caller's scene is never changed). */
function _received(scene) {
	const text = JSON.stringify(scene ?? {})
	return text === undefined ? null : JSON.parse(text) // (JSON.parse makes "__proto__" an own key like any other, as Python's json does)
}

/** A scene as the builder takes it: known item types only, every number a finite float and every prop inside its catalog range.
 *  Throws BadScene, with a short reason, for anything that can't be made usable. */
export function clean(scene) {
	scene = _received(scene)
	if (isNone(scene)) scene = {}
	if (!isDict(scene)) throw new BadScene("scene must be an object")
	const s = scene
	if (!hasOwn(s, "version")) s.version = 2
	s.seconds = _num(s.seconds, "seconds", 4.5, 0.5, 20.0)
	s.release = _num(s.release, "release", 0.5, 0.0, 20.0)
	const stage = s.stage
	if (!isNone(stage) && !isDict(stage)) throw new BadScene("stage must be an object {x0, x1, y0, y1}")
	const base = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
	const edges = {}
	for (const k of Object.keys(base)) edges[k] = _num((stage ?? {})[k], `stage.${k}`, base[k], -1000.0, 1000.0)
	s.stage = edges
	if (edges.x1 - edges.x0 < 0.01 || edges.y1 - edges.y0 < 0.01) throw new BadScene("stage needs x1 > x0 and y1 > y0")
	if (!isNone(s.name)) s.name = pySlice(pyStr(s.name), 80)
	if (!isNone(s.id)) s.id = pySlice(pyStr(s.id), 80)
	let raw = s.items
	if (isNone(raw)) raw = []
	if (!Array.isArray(raw)) throw new BadScene("items must be a list")
	if (raw.length > MAX_ITEMS) throw new BadScene(`too many items (${raw.length}; at most ${MAX_ITEMS})`)
	const seen = new Set()
	s.items = raw.map((it, n) => _item(it, n, seen)).filter((it) => it !== null)
	const goals = s.goals
	if (!isNone(goals)) {
		if (!Array.isArray(goals) || !goals.every(isDict)) throw new BadScene("goals must be a list of objects")
		for (const g of goals) {
			for (const k of ["item", "container"]) if (typeof g[k] !== "string") g[k] = null
			if (!isNone(g.label)) g.label = pySlice(pyStr(g.label), 200)
		}
	}
	return s
}
