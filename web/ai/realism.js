// Real materials: what a thing is made of sets its friction, rolling resistance, bounce and sideways kick, and a value no real thing of that
// material has (a soda can that grips like rubber, friction 0.3 → 1.6; a carpet ten times as draggy as carpet, rolling 0.05 → 0.5) is never
// how the make-it-work search (./fixer.js), the AI's reworks and its "make it work" answers, the critic's patches or the build's tuner
// (./orchestrator.js) make a scene work. The person's own values are theirs: only a change that goes further from what is real than the thing
// already was is refused (a carpet the person set to 0.3 may be tuned back toward carpet, never further away).
//
// The limits are physical, each about the material's own value (`catalog().materials[name]`, the item's chosen material, else its type's own):
//   friction ×0.4–×2, at most 1.2   (a finish and what it meets: waxed to dry wood 0.2–0.5, rubber on dry floors 0.7–1.0; only soft rubber
//                                    grips harder than 1.2)
//   rolling  ×1/3–×3, ±0.005        (how much a ball and its surface give: balls on carpet 0.03–0.1, a steel bearing 0.0005–0.002)
//   bounce   ×0.6–×1.2, at most 0.98 (a ball's pressure, its temperature, how fast it lands; nothing real gives back 98 % or more)
//   side     ×0.5–×1.5, ±0.1, ≤ 1   (the sideways kick of a grippy, springy ball is its rubber's)
// (the same limits as the physics-lesson-video skill's realism check, scripts/lib/realism.ts, so what the sandbox offers passes it.)
//   import { realRange, unrealStep, unrealIn, unrealWords, realKnob } from "./realism.js"
import { catalog as simCatalog } from "../sim/index.js"

export const REAL_LIMITS = {
	friction: { lo: 0.4, hi: 2, cap: 1.2, slack: 0, label: "friction", why: "a material's friction moves about ×0.4–×2 with its finish and what it meets; only soft rubber grips harder than 1.2" },
	rolling: { lo: 1 / 3, hi: 3, slack: 0.005, label: "rolling resistance", why: "rolling resistance is how much a ball and its surface give: about ×1/3–×3 of its material's" },
	bounce: { lo: 0.6, hi: 1.2, cap: 0.98, slack: 0, label: "bounciness", why: "a bounce changes with a ball's pressure, its temperature and how fast it lands: about ×0.6–×1.2 of its material's, and nothing gives back 98 %" },
	side: { lo: 0.5, hi: 1.5, cap: 1, slack: 0.1, label: "side spring-back", why: "the sideways kick of a grippy, springy ball is its rubber's: about ×0.5–×1.5" }
}
/** The props these limits are for. */
export const MATERIAL_KEYS = new Set(Object.keys(REAL_LIMITS))
const isNum = (v) => typeof v === "number" && Number.isFinite(v)
const sig = (v) => Number(Number(v).toPrecision(3))

let CAT = null
function cat() {
	if (CAT) return CAT
	try {
		const c = simCatalog()
		CAT = { types: new Map(c.types.map((t) => [t.key, t])), materials: c.materials ?? {} }
	} catch {
		CAT = { types: new Map(), materials: {} }
	}
	return CAT
}
/** For tests: forget the catalog read (a test that loads other modules). */
export const _resetRealism = () => (CAT = null)

/** The value a thing's material gives a prop: its chosen material's own (another material than its type's), else its type's default; null when
 *  the type has no such prop. */
export function materialBase(type, key, props = {}) {
	const t = cat().types.get(type)
	const spec = t?.props?.find((p) => p.key === key)
	if (!spec || !isNum(spec.default)) return null
	const own = t.props.find((p) => p.key === "material")?.default
	const chosen = typeof props?.material === "string" ? props.material : own
	const m = chosen !== own && typeof chosen === "string" ? cat().materials[chosen] : null
	return m && isNum(m[key]) ? m[key] : spec.default
}
/** What a real thing of this type (made of what its props say) may have for a material prop: {lo, hi, base, why, label}, or null (not a material
 *  prop, or a type without it). */
export function realRange(type, key, props = {}) {
	const L = REAL_LIMITS[key]
	if (!L) return null
	const base = materialBase(type, key, props)
	if (base === null) return null
	let lo = base * L.lo - L.slack
	let hi = base * L.hi + L.slack
	if (L.cap !== undefined) hi = Math.min(hi, Math.max(L.cap, base))
	lo = Math.max(0, lo)
	return { lo: sig(lo), hi: sig(hi), base, why: L.why, label: L.label }
}
/** How far a value is outside a range (0 inside it). */
const outBy = (r, v) => (!r || !isNum(v) ? 0 : v < r.lo - 1e-12 ? r.lo - v : v > r.hi + 1e-12 ? v - r.hi : 0)
/**
 * Is setting this material prop from `from` to `to` a step away from what is real: outside the real range and further from it than `from` was?
 * (from: the value before, null for a thing just added.) -> {key, from, to, lo, hi, base, why, label} or null.
 */
export function unrealStep(type, key, from, to, props = {}) {
	if (!MATERIAL_KEYS.has(key) || !isNum(to)) return null
	const r = realRange(type, key, { ...(props ?? {}), [key]: to })
	if (!r) return null
	const o1 = outBy(r, to)
	if (o1 <= 1e-9) return null
	const o0 = isNum(from) ? outBy(r, from) : 0
	return o1 > o0 + 1e-9 ? { key, from: isNum(from) ? from : null, to, lo: r.lo, hi: r.hi, base: r.base, why: r.why, label: r.label } : null
}
/** The value a thing is built with: its own, else its chosen material's (web/sim/items.js props_of: a floor of ice slides as ice does), else its
 *  type's default. */
export const builtValue = (it, key) => {
	const v = it?.props?.[key]
	if (isNum(v)) return v
	return materialBase(it?.type, key, it?.props ?? {})
}
/**
 * The material props a version (b) gives its things that no real one has, beyond what a (the version it was made from) already had: [{id, type,
 * key, from, to, lo, hi, ...}]. A thing new in b (or of another kind) is judged against its own material. keep: Map|Array id -> keys the
 * person chose (their own value is theirs, real or not).
 */
export function unrealIn(a, b, { keep = null } = {}) {
	const A = new Map((a?.items ?? []).map((i) => [i.id, i]))
	const kept = keep instanceof Map ? keep : new Map(Array.isArray(keep) ? keep.filter(Array.isArray).map(([id, ks]) => [id, ks]) : [])
	const out = []
	for (const it of b?.items ?? []) {
		if (!it || it.type === "table" || (it.type === "wall" && it.props?.invisible_in_3d === true)) continue
		const was = A.get(it.id)
		const same = was && was.type === it.type
		const ks = kept.get(it.id)
		for (const key of MATERIAL_KEYS) {
			if (ks === "all" || (ks && (ks.has?.(key) || (Array.isArray(ks) && ks.includes(key))))) continue
			const to = builtValue(it, key)
			const from = same ? builtValue(was, key) : null
			if (to === null || (same && from !== null && Math.abs(to - from) <= 1e-12)) continue
			const u = unrealStep(it.type, key, from, to, it.props ?? {})
			if (u) out.push({ id: it.id, type: it.type, name: it.name ?? null, ...u })
		}
	}
	return out
}
const fmt = (v) => String(sig(v))
/** One unreal value in words: "the soda can a friction of 1.6 (a real one has 0.12–0.6)". nameOf(id) -> the thing's name in a sentence. */
export function unrealWords(u, nameOf = null) {
	const nm = typeof nameOf === "function" ? nameOf(u.id) : u.name ? `the ${String(u.name).replace(/^./, (c) => c.toLowerCase())}` : `the ${String(u.type).replace(/-/g, " ")}`
	return `${nm} a ${u.label} of ${fmt(u.to)} (a real one has ${fmt(u.lo)}–${fmt(u.hi)})`
}
/** The words that ask for a material setting in a request ("make the floor slippery", "a grippier tyre", "less bounce"): a request that says
 *  them chose that setting itself, real or not. */
const SAID = {
	friction: /\b(friction\w*|grippier|grippy|grip\w*|slipper\w*|slippy|slick\w*|sticky|stickier|tack\w*|traction|smoother|rougher|icy)\b/i,
	// ("rolling" alone is how a thing moves, "the ball rolling down the ramp": only the resistance itself, or a drag, asks for it)
	rolling: /\b(resistance|drag\w*)\b/i,
	// (and "bounces" alone is what a thing does: a bouncier ball, more or less bounce, bounce higher)
	bounce: /\b(bouncier|bounciest|bounciness|(?:more|less|very|super|extra|really|not)\s+bouncy|bounc\w*\s+(?:higher|more|less|lower|better|back\s+more|back\s+less)|springier|elastic\w*|rebound\w*|restitution)\b/i,
	side: /\b(side\s+spring[- ]?back|spin\w*\s+off|kick\w*\s+sideways)\b/i
}
export const materialSaid = (key, text) => !!SAID[key]?.test(String(text ?? ""))
/**
 * Plan patches (./orchestrator.js applyPatches: set_props, add, replace_type) with every material value no real thing of its kind has, and that
 * goes further from real than the thing was, taken out (the critic's "friction 1.6" for a soda can): {patches, dropped: [unreal]} (a set_props
 * left with nothing to set is dropped whole).
 */
export function realPatches(plan, patches) {
	const items = new Map((plan?.items ?? []).filter((i) => i && typeof i === "object").map((i) => [i.id, i]))
	const dropped = []
	const out = []
	for (const p0 of Array.isArray(patches) ? patches : []) {
		if (!p0 || typeof p0 !== "object") {
			out.push(p0)
			continue
		}
		const op = String(p0.op ?? "").toLowerCase()
		const strip = (type, props, base, id) => {
			const keep = {}
			for (const [k, v] of Object.entries(props ?? {})) {
				const u = MATERIAL_KEYS.has(k) && isNum(v) ? unrealStep(type, k, base ? builtValue(base, k) : null, v, { ...(base?.props ?? {}), ...props }) : null
				if (u) dropped.push({ id, type, name: base?.name ?? null, ...u })
				else keep[k] = v
			}
			return keep
		}
		if (op === "set_props" || op === "props") {
			const it = items.get(p0.id)
			const field = p0.props && typeof p0.props === "object" ? "props" : p0.set && typeof p0.set === "object" ? "set" : null
			if (!it || !field) {
				out.push(p0)
				continue
			}
			const kept = strip(it.type, p0[field], it, it.id)
			if (Object.keys(kept).length) out.push({ ...p0, [field]: kept })
		} else if (op === "add") {
			const item = p0.item && typeof p0.item === "object" ? p0.item : p0
			if (!item.type || !item.props || typeof item.props !== "object") {
				out.push(p0)
				continue
			}
			const kept = strip(item.type, item.props, null, item.id ?? item.type)
			out.push(p0.item ? { ...p0, item: { ...item, props: kept } } : { ...p0, props: kept })
		} else if (op === "replace_type" && p0.props && typeof p0.props === "object" && p0.type) out.push({ ...p0, props: strip(p0.type, p0.props, null, p0.id) })
		else out.push(p0)
	}
	return { patches: out, dropped }
}
/**
 * A tune knob on a material prop, kept to what is real: its min and max cut to the real range, widened only to take in the value it has now
 * (the planner's, which may be the person's). -> {knob, note} (knob null: no real value left to tune; note: what was cut, or null).
 */
export function realKnob(knob, item) {
	const key = String(knob?.param ?? "")
	if (!MATERIAL_KEYS.has(key) || !item) return { knob, note: null }
	const r = realRange(item.type, key, item.props ?? {})
	if (!r) return { knob, note: null }
	const v0 = builtValue(item, key)
	// (a knob without its range is one the tuner leaves out anyway: nothing to cut)
	if (!isNum(knob.min) || !isNum(knob.max)) return { knob, note: null }
	const lo0 = knob.min
	const hi0 = knob.max
	const lo = Math.max(lo0, Math.min(r.lo, v0 ?? r.lo))
	const hi = Math.min(hi0, Math.max(r.hi, v0 ?? r.hi))
	if (lo <= lo0 + 1e-12 && hi >= hi0 - 1e-12) return { knob, note: null }
	if (!(hi > lo)) return { knob: null, note: `${r.label} was left as planned: every value the tuner might try is one no real ${String(item.type).replace(/-/g, " ")} has (${fmt(r.lo)}–${fmt(r.hi)})` }
	return { knob: { ...knob, min: sig(lo), max: sig(hi) }, note: `${r.label} was tuned only within what a real one has (${fmt(r.lo)}–${fmt(r.hi)})` }
}
