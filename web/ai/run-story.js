// What a run shows that no solid's motion and no module event says: the readings of the things that have them, start → end in their units (an
// ice cube melting on a hot plate, a pan of water warming, a stopwatch's time), and what a physics module says of an item itself (its
// `words.story`, below). The card's "In the run" line (./orchestrator.js describeRun) tells them, so a run where only heat, light or liquid
// changes never reads "nothing moves", and a run where something also moves still tells what the modules did.
//   import { storyLines, lessonSpan } from "./run-story.js"
//   storyLines(sim, scene, {max, skip}) -> ["Ice cube: temperature −17.9 → 0.0 °C, melted 0 → 93 %, puddle 0.0 → 52.4 g", "Hot plate: top 20 → 78 °C"]
// A module may say an item's part of the story in its own words (web/sim/plugins.js registry, read here):
//   words.story(item, run, {type, scene, name}) -> text | [text] | null   (null: the readings are told as above)
// e.g. "Ice cube melts 93 % (its puddle 52 g)". Pure, no DOM.
import { catalog as simCatalog } from "../sim/index.js"
import { modules } from "../sim/plugins.js"

const isNum = (v) => typeof v === "number" && Number.isFinite(v)
let TYPES = null
const typeOf = (key) => {
	if (!TYPES)
		try {
			TYPES = new Map(simCatalog().types.map((t) => [t.key, t]))
		} catch {
			TYPES = new Map()
		}
	return TYPES.get(key) ?? null
}
/** For tests: forget the catalog read. */
export const _resetStory = () => (TYPES = null)
const fixed = (v, d) => {
	const s = Number(v).toFixed(Math.max(0, Math.min(6, d)))
	return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s.replace(/^-/, "−")
}
/** Lesson time in a teacher's words: "45 s", "12 min", "1 h 5 min". */
function clock(s) {
	const v = Math.max(0, Number(s) || 0)
	if (v < 120) return `${+v.toFixed(v < 10 ? 2 : 1)} s`
	if (v < 3570) {
		const m = Math.floor(v / 60)
		const r = Math.round(v - m * 60)
		return r && m < 20 ? `${m} min ${r} s` : `${Math.round(v / 60)} min`
	}
	const mins = Math.round(v / 60)
	const h = Math.floor(mins / 60)
	return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`
}
/** A time-lapse run's lesson time, in words ("1 min 20 s of lesson time"), or null for a run in real time. */
export function lessonSpan(sim) {
	const lapse = sim?.doc?.settings?.timeLapse
	const t = sim?.track?.frames?.at(-1)?.t
	return isNum(lapse) && lapse > 1 && isNum(t) && t > 0 ? `${clock(t * lapse)} of lesson time` : null
}
/** One reading start → end in words ("temperature −17.9 → 0.0 °C", "melted 0 → 93 %", "boiling no → yes"), or null when it did not change. */
function readingWords(r, v) {
	const xs = v.filter(isNum)
	if (xs.length < 2) return null
	const a = xs[0]
	const b = xs.at(-1)
	const d = Number.isInteger(r.digits) ? r.digits : 2
	const unit = String(r.unit ?? "")
	const label = String(r.label ?? r.key).replace(/^./, (c) => c.toLowerCase())
	const words = r.words && typeof r.words === "object" ? r.words : null
	let fa
	let fb
	if (words || (unit === "" && d === 0 && xs.every((x) => x === 0 || x === 1))) {
		// (a state with its word, a 0/1 flag as no and yes: "boiling no → yes", never "boiling 0 → 1")
		const w = (x) => words?.[String(Math.round(x))] ?? (Math.round(x) ? "yes" : "no")
		fa = w(a)
		fb = w(b)
		return fa === fb ? null : `${label} ${fa} → ${fb}`
	}
	if (unit === "" && d >= 2 && xs.every((x) => x >= 0 && x <= 1)) {
		// (a share of the whole, "melted 0 → 93 %")
		fa = String(Math.round(a * 100))
		fb = String(Math.round(b * 100))
		return fa === fb ? null : `${label} ${fa} → ${fb} %`
	}
	fa = fixed(a, d)
	fb = fixed(b, d)
	if (fa === fb) return null
	return `${label} ${fa} → ${fb}${unit ? ` ${unit}` : ""}`
}
/** When a series first leaves its start value (its frame's time), or Infinity. */
function changedAt(v, frames) {
	const a = v.find(isNum)
	const i = v.findIndex((x) => isNum(x) && x !== a)
	return i >= 0 && frames[i] ? frames[i].t : Infinity
}
/** A module's own words for an item's part of the run (words.story), or null. */
function moduleStory(item, sim, h) {
	for (const m of modules()) {
		if (typeof m.words?.story !== "function") continue
		try {
			const t = m.words.story(item, sim, h)
			const list = (Array.isArray(t) ? t : [t]).filter((x) => typeof x === "string" && x.trim())
			if (list.length) return list.join("; ")
		} catch {} // (a module's words never stop the card)
	}
	return null
}
/** How much a resized solid of an item ends at against its start (an ice cube melting to 41 %), from the track's `scale`, or null. */
function scaleWords(sim, id) {
	const sids = (sim?.doc?.solids ?? []).filter((s) => s.item === id).map((s) => s.id)
	const frames = sim?.track?.frames ?? []
	if (!sids.length || frames.length < 2) return null
	const at = (f) => {
		for (const sid of sids) {
			const p = f.placements?.[sid]
			if (p && isNum(p.scale)) return p.scale
		}
		return null
	}
	let first = null
	let last = null
	for (const f of frames) {
		const s = at(f)
		if (s === null) continue
		if (first === null) first = s
		last = s
	}
	if (first === null || last === null || Math.abs(last - first) < 0.02) return null
	if (last <= 0.005) return { t: Infinity, text: "shrinks away to nothing" }
	const k = last / (first || 1)
	return { t: Infinity, text: k < 1 ? `shrinks to ${Math.round(k * 100)} % of its size` : `grows to ${+k.toFixed(k < 2 ? 2 : 1)}× its size` }
}
/**
 * Each item's part of a run that its motion and the modules' events do not say: a module's own words for it, else its readings that changed
 * (the ones its type lists as `readouts`, in their order, at most `per`), else how its size changed; ordered by when each first changed, at most
 * `max` items. skip: ids to leave out (things the events already tell about). -> [text]
 */
export function storyLines(sim, scene, { max = 3, per = 3, skip = null } = {}) {
	const state = sim?.track?.state
	const frames = sim?.track?.frames ?? []
	const out = []
	for (const it of scene?.items ?? []) {
		if (!it || it.type === "table" || (it.type === "wall" && it.props?.invisible_in_3d === true) || skip?.has?.(it.id)) continue
		const T = typeOf(it.type)
		const name = it.name ?? T?.name ?? it.id
		const own = moduleStory(it, sim, { type: T, scene, name })
		if (own) {
			out.push({ t: -1, text: `${name}: ${own}` })
			continue
		}
		const series = state && typeof state === "object" ? state[it.id] : null
		const bits = []
		let t = Infinity
		if (series && typeof series === "object")
			for (const r of T?.readouts ?? []) {
				const v = series[r.key]
				if (!Array.isArray(v) || bits.length >= per) continue
				const w = readingWords(r, v)
				if (!w) continue
				bits.push(w)
				t = Math.min(t, changedAt(v, frames))
			}
		if (!bits.length) {
			const sc = scaleWords(sim, it.id)
			if (sc) out.push({ t: sc.t, text: `${name} ${sc.text}` })
			continue
		}
		out.push({ t, text: `${name}: ${bits.join(", ")}` })
	}
	return out
		.sort((a, b) => a.t - b.t)
		.slice(0, max)
		.map((x) => x.text)
}
