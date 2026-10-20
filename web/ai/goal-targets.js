// A goal's numbers (its target: "at least 4000 mL", "by 20 s", "within 10 %") are the person's. This file says how an edit changed them, in
// real units, and holds back an AI answer that quietly makes a goal easier to meet ("make it work" answered by lowering 4 L to 200 mL: V8956
// F5, 20 Oct): the version keeps the person's target, the card says what the AI wanted, and the panel offers it as a chip the person may take.
// Pure: goals as plans and scenes carry them ({kind, label, item, at_least_ml, before_s, ...}); ./goals.js pairs them by kind and refs.
//   targetChanges(was, now)          -> [{was, now, label, changes: [{field, from, to, sense, easier}]}] for goals that are the same goal
//   targetLines(was, now)            -> ["changed the goal “The hose carries at least 4 L” (at least 4 L → 200 mL)"]
//   holdTargets(was, now, {text})    -> {goals, held}: `now` with every easier (or moved) target put back as `was` had it, unless the words
//                                       ask for a goal change themselves ("lower the goal", "only 200 mL"); held: what was put back
//   heldWords(held) / heldOffer(held) -> the card's line and the chip that offers the AI's easier target for the person to confirm
import { goalKind, goalRefs } from "./goals.js"

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const sig = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Number(Number(v).toPrecision(3))))
/** A goal field's sense: "min" (a lower number is easier: at_least_ml, min_m, count), "max" (a higher one is: before_s, by_min, at_most_c),
 *  "tol" (a wider tolerance is easier), or "exact" (a target to hit: seconds, pitch_hz, kpa: any change moves it). */
export function targetSense(field) {
	const f = String(field)
	if (/^(at_least|min)(_|$)/.test(f) || /^(count|turns)$/.test(f) || f === "after_s") return "min"
	if (/^(at_most|max)(_|$)/.test(f) || /^(before_s|by_min|within_s|within)$/.test(f)) return "max"
	if (/^tol(_|$)/.test(f)) return "tol"
	return "exact"
}
/** A goal field's value in its unit, from the field's name: at_least_ml 4000 -> "4 L", before_s 20 -> "20 s", at_least_c 60 -> "60 °C". */
export function targetValue(field, v) {
	if (typeof v !== "number" || !Number.isFinite(v)) return String(v)
	const f = String(field)
	const a = Math.abs(v)
	if (/(^|_)ml$/.test(f)) return a >= 1000 ? `${sig(v / 1000)} L` : `${sig(v)} mL`
	if (/(^|_)(s|seconds)$/.test(f) || f === "seconds" || f === "delay_s") return `${sig(v)} s`
	if (/(^|_)min$/.test(f)) return `${sig(v)} min`
	if (/(^|_)c$/.test(f)) return `${sig(v)} °C`
	if (/(^|_)mm$/.test(f)) return `${sig(v)} mm`
	if (/(^|_)cm$/.test(f)) return `${sig(v)} cm`
	if (/(^|_)(m|meters)$/.test(f) || /^x[01]?$/.test(f)) return a < 0.01 ? `${sig(v * 1000)} mm` : a < 1 ? `${sig(v * 100)} cm` : `${sig(v)} m`
	if (/(^|_)(deg|degrees)$/.test(f)) return `${sig(v)}°`
	if (/(^|_)hz$/.test(f)) return `${sig(v)} Hz`
	if (/(^|_)db$/.test(f)) return `${sig(v)} dB`
	if (/(^|_)rpm$/.test(f)) return `${sig(v)} rpm`
	if (/(^|_)a$/.test(f)) return `${sig(v)} A`
	if (/(^|_)lux$/.test(f)) return `${sig(v)} lux`
	if (/(^|_)(g|grams)$/.test(f)) return a >= 1000 ? `${sig(v / 1000)} kg` : `${sig(v)} g`
	if (/(^|_)j$/.test(f)) return `${sig(v)} J`
	if (/(^|_)kpa$/.test(f)) return `${sig(v)} kPa`
	if (f === "newtons") return `${sig(v)} N`
	if (f === "mps") return `${sig(v)} m/s`
	if (f === "accel") return `${sig(v)} m/s²`
	return sig(v)
}
/** The words before a field's value: "at least", "at most", "by", "within", "after", "tolerance", "" (an exact target). */
export function targetPrefix(field) {
	const f = String(field)
	if (f === "before_s" || f === "within_s") return "by"
	if (f === "by_min" || f === "within") return "within"
	if (f === "after_s") return "after"
	if (/^tol(_|$)/.test(f)) return "give or take"
	const s = targetSense(f)
	return s === "min" && !/^(count|turns)$/.test(f) ? "at least" : s === "max" ? "at most" : ""
}
const keyOf = (g) => `${goalKind(g)}|${goalRefs(g).slice().sort().join(",")}`
const labelOf = (g) => String(g?.label ?? "").trim().toLowerCase()
/** The number fields of a pair of goals (the target fields: never the item fields, whose values are ids). */
const numFields = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((f) => f !== "kind" && f !== "label" && (typeof a?.[f] === "number" || typeof b?.[f] === "number"))
/** Pairs of goals that are the same goal before and after (the same kind and things, or the same kind and label). */
function pairs(was, now) {
	const A = (Array.isArray(was) ? was : []).filter(isObj)
	const B = (Array.isArray(now) ? now : []).filter(isObj)
	const used = new Set()
	const out = []
	for (const b of B) {
		const i = A.findIndex((a, k) => !used.has(k) && keyOf(a) === keyOf(b))
		const j = i >= 0 ? i : A.findIndex((a, k) => !used.has(k) && goalKind(a) === goalKind(b) && labelOf(a) && labelOf(a) === labelOf(b))
		if (j < 0) continue
		used.add(j)
		out.push([A[j], b])
	}
	return out
}
/** How an edit changed the same goals' numbers. A field taken away counts as its target dropped (easier unless a "min" count), one added as harder. */
export function targetChanges(was, now) {
	const out = []
	for (const [a, b] of pairs(was, now)) {
		const changes = []
		for (const f of numFields(a, b)) {
			const from = typeof a[f] === "number" ? a[f] : null
			const to = typeof b[f] === "number" ? b[f] : null
			if (from !== null && to !== null && Math.abs(from - to) <= Math.max(1e-9, Math.abs(from) * 1e-9)) continue
			const sense = targetSense(f)
			let easier
			if (from === null) easier = false // (a target added: asks for more)
			else if (to === null) easier = true // (a target dropped: asks for less)
			else easier = sense === "min" ? to < from : sense === "max" || sense === "tol" ? to > from : null // (an exact target moved: neither, but not the person's)
			changes.push({ field: f, from, to, sense, easier })
		}
		for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
			if (f === "kind" || f === "label" || typeof a[f] === "number" || typeof b[f] === "number") continue
			if ((typeof a[f] === "string" || typeof b[f] === "string" || typeof a[f] === "boolean" || typeof b[f] === "boolean") && a[f] !== b[f] && !goalRefs(a).includes(a[f]) && !goalRefs(b).includes(b[f]))
				changes.push({ field: f, from: a[f] ?? null, to: b[f] ?? null, sense: "exact", easier: null })
		}
		if (changes.length) out.push({ was: a, now: b, label: String(a.label ?? b.label ?? goalKind(a)).replace(/[.!]+$/, ""), changes })
	}
	return out
}
/** One change of a goal's number in words: "at least 4 L → 200 mL", "by 20 s → no time limit", "toward left → right". */
export function changeWords(c) {
	const pre = targetPrefix(c.field)
	// (a goal turned round, expect false: "now it must not happen"; another yes-or-no field by its name)
	if (c.field === "expect" && (typeof c.from === "boolean" || typeof c.to === "boolean" || c.to === null)) return c.to === false ? "now it must not happen" : "now it must happen"
	if (typeof c.from === "boolean" || typeof c.to === "boolean") return `${c.field.replace(/_/g, " ")}: ${c.to === true ? "yes" : c.to === false ? "no" : "as standard"}`
	if (typeof c.from !== "number" && typeof c.to !== "number") return `${c.field.replace(/_/g, " ")} ${c.from ?? "none"} → ${c.to ?? "none"}`
	const fa = c.from === null ? (c.sense === "max" ? "no limit" : "none") : targetValue(c.field, c.from)
	const fb = c.to === null ? (c.sense === "max" || c.sense === "min" ? "no limit" : "none") : targetValue(c.field, c.to)
	return `${pre ? `${pre} ` : ""}${fa} → ${fb}`
}
/** The change list's lines for the goals' numbers an edit changed. */
export function targetLines(was, now) {
	return targetChanges(was, now).map((t) => `changed the goal “${t.label}” (${t.changes.map(changeWords).join("; ")})`)
}
/** The words ask for the goal itself to change: "lower the goal", "the target", "only 200 mL", "ask for less". */
export const GOAL_WORDS_RE = /\b(goals?|targets?|aims?|thresholds?|ask(s|ing)? for (less|more|only)|lower the bar|expect(s|ing)? (less|more|only))\b/i
/** Whether the words give this number for the field (in its unit, or in another of the common ones: 200 mL for 0.2 L, 1 minute for 60 s). */
export function numberSaid(text, field, v) {
	if (typeof v !== "number") return false
	const t = String(text ?? "").toLowerCase()
	const nums = [...t.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => Number(m[1].replace(",", ".")))
	const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, half: 0.5 }
	for (const m of t.matchAll(/\b(a|an|one|two|three|four|five|six|ten|half)\s+(?:full\s+)?(minute|second|litre|liter|metre|meter|kilogram|hour)s?\b/g)) nums.push(words[m[1]])
	if (/\ba minute\b|\bone minute\b|\ba full minute\b/.test(t)) nums.push(60)
	const cands = [v, v / 1000, v * 1000, v / 100, v * 100, v / 60, v * 60, v / 3600]
	return nums.some((n) => cands.some((c) => Math.abs(n - c) <= Math.max(1e-6, Math.abs(c) * 1e-3)))
}
/**
 * `now` with the targets an edit made easier (or moved) put back as `was` had them, unless the words ask for it ("lower the goal to 200 mL",
 * or the new number itself). -> {goals, held: [{label, was, now, changes}]}: held is what the AI wanted, for the card and the chip.
 * A target made harder, or one the person named, stays. `moved: false` (a request with an outcome of its own, "make the ball go twice as fast":
 * web/ai/orchestrator.js ownOutcome) lets an exact target move ("reads about 1 m/s" → "about 2 m/s" is what was asked) and keeps the answer's
 * label; only a target made easier is put back.
 */
export function holdTargets(was, now, { text = "", moved = true } = {}) {
	if (!Array.isArray(now) || GOAL_WORDS_RE.test(String(text ?? ""))) return { goals: now, held: [] }
	const held = []
	const swap = new Map()
	for (const t of targetChanges(was, now)) {
		const back = t.changes.filter((c) => (c.easier === true || (moved && c.easier !== false)) && !(c.to !== null && numberSaid(text, c.field, c.to)))
		if (!back.length) continue
		const g = { ...t.now }
		for (const c of back) {
			if (c.from === null) delete g[c.field]
			else g[c.field] = c.from
		}
		if (moved && t.was.label !== undefined) g.label = t.was.label
		swap.set(t.now, g)
		held.push({ label: moved ? t.label : String(t.now.label ?? t.label).replace(/[.!]+$/, ""), was: t.was, now: t.now, changes: back })
	}
	return held.length ? { goals: now.map((g) => swap.get(g) ?? g), held } : { goals: now, held }
}
/** The card's line for what was held back: "Kept your goal “The hose carries at least 4 L”: the AI wanted at least 4 L → 200 mL". */
export function heldWords(h) {
	return `Kept your goal “${h.label}” as it was (the AI wanted ${h.changes.map(changeWords).join("; ")}${h.why ? `: ${String(h.why).replace(/[.!]+$/, "").replace(/^(A|An|The|This|That|These|Those|It|Its|With|Without|Only|At|In|On|For|By|So|Each|Every|Such|Then|Now)\b/, (c) => c.toLowerCase())}` : ""}); lowering a goal is yours to choose`
}
/** One sentence for a reply that says nothing worked: "The AI wanted to lower the goals (at least 4 L → 200 mL): that is yours to choose." */
export function heldSentence(held) {
	const list = (Array.isArray(held) ? held : []).filter((h) => h?.changes?.length)
	if (!list.length) return ""
	const ch = [...new Set(list.flatMap((h) => h.changes.map(changeWords)))]
	return `The AI wanted to lower ${list.length > 1 ? "the goals" : `the goal “${list[0].label}”`} (${ch.join("; ")}): that is yours to choose.`
}
/** The chip that offers the AI's easier targets (all the held goals at once), or null. */
export function heldOffer(held) {
	const list = (Array.isArray(held) ? held : []).filter((h) => h?.changes?.some((c) => c.to !== null))
	if (!list.length) return null
	const tos = list.flatMap((h) => h.changes.filter((c) => c.to !== null).map((c) => targetValue(c.field, c.to)))
	const one = [...new Set(tos)]
	const label = one.length === 1 ? `Lower the ${list.length > 1 ? "goals" : "goal"} to ${one[0]}` : list.length === 1 ? "Lower the goal as the AI said" : "Lower the goals as the AI said"
	const parts = list.map((h) => `“${h.label}” to ${h.changes.filter((c) => c.to !== null).map((c) => `${targetPrefix(c.field) ? `${targetPrefix(c.field)} ` : ""}${targetValue(c.field, c.to)}`).join(" and ")}`)
	return { label, prompt: `Change the ${list.length > 1 ? "goals" : "goal"} ${parts.join(", and ")}. Keep everything else as it is.` }
}
