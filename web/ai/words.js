// Words for things on the card, shared by ./orchestrator.js (the change list, the lead) and ./fixer.js (a fix's words): the catalog's name as a
// person says it ("Soda can, standing" -> "a standing soda can", "6 standing soda cans"), what a thing weighs as the engine builds it, and a
// change said as a past-tense line turned into an offer ("emptied the 6 soda cans" -> "empty the 6 soda cans"). Pure; no DOM.
//   import { kindNoun, aKindOf, weightOf, fmtMass, imperative } from "./words.js"
import { typeName } from "./solver.js"
import { build as buildDoc, MATERIALS } from "../sim/index.js"

const trimNum = (v, d) => String(Number(Number(v).toFixed(d)))
// (a name of someone's, "Rubik's cube", "Newton's cradle", keeps its capital: never "4 rubik's cubes": V8832 m1)
const lcFirst = (s) => (/^[A-Z][a-z]+['’]s\b/.test(String(s)) ? String(s) : /^[A-Z][a-z]/.test(String(s)) || /^[A-Z]$/.test(String(s)) ? String(s)[0].toLowerCase() + String(s).slice(1) : String(s))

/** "wooden block" -> "wooden blocks", "box" -> "boxes", "berry" -> "berries" (the last word). */
export function pluralWord(w) {
	return /(s|x|z|ch|sh)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`
}
/**
 * A kind of thing as a person says it, for n of them: the catalog's "Soda can, standing" is "standing soda can" (one word after the comma goes
 * in front), "Soda can, on its side" is "soda can on its side" ("soda cans on their side"), "Domino row (growing)" is "domino row". -> words
 * without an article. short: without how it stands or lies ("soda cans"), for things already named on the table.
 */
export function kindNoun(type, n = 1, { short = false } = {}) {
	let name = String(typeName(type) ?? type ?? "thing").replace(/\s*\([^)]*\)\s*$/, "").trim()
	let pre = ""
	let post = ""
	const m = /^(.*?),\s*(.+)$/.exec(name)
	if (m) {
		name = m[1].trim()
		const tail = m[2].trim()
		// (short: the things themselves, already on the table, "the 6 soda cans": how they stand goes without saying)
		if (short) {
		} else if (/^[a-z]+$/i.test(tail) && !/\d/.test(tail)) pre = `${tail.toLowerCase()} `
		else post = ` ${/\d/.test(tail) ? `(${tail})` : tail}`
	}
	let head = lcFirst(name)
	if (n !== 1) {
		const words = head.split(" ")
		words[words.length - 1] = pluralWord(words.at(-1))
		head = words.join(" ")
		post = post.replace(/\bits\b/g, "their")
	}
	return `${pre}${head}${post}`
}
/** "a standing soda can", "an egg", "an orange". */
export function aKindOf(type) {
	const w = kindNoun(type, 1)
	return `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`
}
/** n things of a kind: "6 standing soda cans", "the 7 dominoes" (a domino row says its dominoes). */
export function countNoun(type, n) {
	return `${n} ${kindNoun(type, n)}`
}

/** A weight in words: "57 g", "6.3 g", "1.6 kg". */
export const fmtMass = (kg) => (kg >= 1 ? `${trimNum(kg, kg >= 10 ? 0 : 2).replace(/(\.\d)0$/, "$1")} kg` : `${trimNum(kg * 1000, kg < 0.01 ? 1 : 0)} g`)

/** A solid's volume (m³) from its body, or null. */
function volumeOf(b) {
	if (!b) return null
	if (b.kind === "ball") return (4 / 3) * Math.PI * (b.radius ** 3 - (b.wall > 0 && b.wall < b.radius ? (b.radius - b.wall) ** 3 : 0))
	if (b.kind === "slab") return b.width * b.height * (Number(b.depth) || 0) * (((b.taper ?? 1) + 1) / 2)
	if (b.kind === "polygon" && Array.isArray(b.points)) {
		let a = 0
		const p = b.points
		for (let i = 0; i < p.length; i++) a += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y
		return Math.abs(a / 2) * (Number(b.depth) || 0)
	}
	return null
}
/** One solid's mass in a built doc (kg), or null: "the part that hits weighs 1.3 kg" (the last domino of a row, not the row). */
export function solidMass(doc, solid) {
	const mat = doc?.materials?.[solid?.material] ?? MATERIALS[String(solid?.material ?? "").replace(/ \[[^\]]*\]$/, "")]
	const v = volumeOf(solid?.body)
	return mat?.density > 0 && v > 0 ? v * mat.density : null
}
const weightCache = new Map()
/**
 * What a thing of this kind with these settings weighs as the engine builds it, in kg: each moving solid's volume × the density of its own
 * material in the built doc (a thing tuned to a measured weight, an egg, a full can, has its own material there). null when a solid's shape
 * can't be measured here (then the caller may use the run's own figure).
 */
export function weightOf(type, props = {}) {
	const key = `${type}|${JSON.stringify(props ?? {})}`
	if (weightCache.has(key)) return weightCache.get(key)
	let out = null
	try {
		const { doc } = buildDoc({ stage: { x0: -0.6, x1: 3.2, y0: -0.2, y1: 2.4 }, items: [{ id: "g", type, x: 0, y: 0.5, angle: 0, props: props ?? {} }] })
		let m = 0
		let ok = true
		for (const s of doc.solids) {
			if (s.kind !== "dynamic") continue
			const mat = doc.materials?.[s.material] ?? MATERIALS[String(s.material ?? "").replace(/ \[[^\]]*\]$/, "")]
			const b = s.body
			if (!mat || !b || !(mat.density > 0)) {
				ok = false
				break
			}
			let v
			if (b.kind === "ball") v = (4 / 3) * Math.PI * (b.radius ** 3 - (b.wall > 0 && b.wall < b.radius ? (b.radius - b.wall) ** 3 : 0))
			else if (b.kind === "slab") v = b.width * b.height * (Number(b.depth) || 0) * (((b.taper ?? 1) + 1) / 2)
			else if (b.kind === "polygon" && Array.isArray(b.points)) {
				let a = 0
				const p = b.points
				for (let i = 0; i < p.length; i++) a += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y
				v = Math.abs(a / 2) * (Number(b.depth) || 0)
			} else {
				ok = false
				break
			}
			m += v * mat.density
		}
		out = ok && m > 0 ? m : null
	} catch {
		out = null
	}
	weightCache.set(key, out)
	return out
}

// past tense -> the offer ("emptied the 6 soda cans" -> "empty the 6 soda cans"): the verbs a change line starts with
const VERBS = {
	added: "add", removed: "remove", replaced: "replace", swapped: "swap", moved: "move", made: "make", turned: "turn", tilted: "tilt", spaced: "space",
	pulled: "pull", renamed: "rename", let: "let", fixed: "fix", widened: "widen", narrowed: "narrow", lowered: "lower", raised: "raise", shifted: "shift",
	emptied: "empty", filled: "fill", took: "take", started: "start", stood: "stand", set: "set", put: "put", gave: "give", hung: "hang", changed: "change"
}
/** A change line in the past tense as an offer: "emptied the cans and moved the box 3 cm left" -> "empty the cans and move the box 3 cm left". */
export function imperative(text) {
	// (after "and", only a verb with a thing after it: "made the rope pendulum shorter and tilted more" keeps its participle, never "…and tilt
	// more" (V8842 y5))
	return String(text ?? "").replace(/(^|, | and |; )([a-z]+)\b/g, (m, sep, w, off, all) => {
		if (!VERBS[w]) return m
		if (sep === " and " && !/^\s+(?:the|a|an|its|their|it|them|both|all|each|every|one|two|three|four|five|six|seven|eight|nine|ten|[A-Z0-9])/.test(all.slice(off + m.length))) return m
		return `${sep}${VERBS[w]}`
	})
}

/** A "Try:" chip's label that names every change of the version it puts on the table, never the first alone: "Move the seesaw 20 cm
 *  right" for one, "2 changes: move the seesaw 20 cm right and add a cutting board" for more (V8837 y4: "Try: Move the seesaw 20 cm right"
 *  also added a cutting board). Shortened to each change's verb and thing when long, never cut mid-phrase. */
export function changesLabel(lines, n = 60) {
	const shorts = (lines ?? []).map((t) => imperative(String(t)).replace(/\s*\([^)]*\)/g, "").replace(/,.*$/, "").trim()).filter(Boolean)
	if (!shorts.length) return ""
	const cap = (s) => s.replace(/^./, (c) => c.toUpperCase())
	if (shorts.length === 1) return clipLabel(cap(shorts[0]), Math.min(n, 46))
	// (", and" when a change has an "and" of its own: "make the rope pendulum shorter and tilted more, and move it")
	const and = (l) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")}${l.some((x) => / and /.test(x)) ? "," : ""} and ${l.at(-1)}`)
	const full = `${shorts.length} changes: ${and(shorts)}`
	if (full.length <= n) return full
	// (each change by its verb and its thing: "move the seesaw", "add a cutting board")
	const bare = shorts.map((t) => t.replace(/\s+(?:by\s+)?-?\d[\d.,]*\s*(?:mm|cm|m|°|g|kg|s|%|×)?(?=\s|$).*$/, "").replace(/\s+(?:next to|between|beside|by|under|on top of|onto|on|in|into|at|to|from|so|until|toward|towards|closer|further|farther|higher|lower|up|down|left|right)\b.*$/, "").trim())
	const mid = `${shorts.length} changes: ${and(bare)}`
	// (two are always both named, by their verb and thing; three or more as the "Make N changes" chips are, the count with the first)
	if (mid.length <= n || shorts.length === 2) return mid
	return `${shorts.length} changes: ${bare[0]} and ${shorts.length - 1} more`
}
/** One bracket at a time in a line of words: a name that ends in its own brackets takes "with … on it" after a comma ("Ramp 1 (top), with the
 *  big wooden ball on it, 16 cm up"), and two bracket groups side by side are one ("10 LEGO bricks (2 × 4; 2.3 g each, 2 cm apart)"): V8837 k2 / k3. */
export function tidyBrackets(text) {
	let t = String(text ?? "")
	t = t.replace(/(\([^()]*\)) \((with [^()]*? (?:on|in) (?:it|them))\)(?=( |,|$))/g, (m, a, w, after) => `${a}, ${w}${after === "," || after === "" ? "" : ","}`)
	for (let k = 0; k < 3 && /\(([^()]*)\) \(/.test(t); k++) t = t.replace(/\(([^()]*)\) \(/g, "($1; ")
	return t
}
/** A chip's label cut to about n characters at a word, never inside brackets ("Make Ball 2 smaller (diameter 6 → 2 cm;…" was: V8814 s6): an
 *  open bracket left by the cut is dropped with what follows it, then "…" when anything was left out. */
export function clipLabel(text, n = 46) {
	const t = String(text ?? "").trim()
	if (t.length <= n) return t
	let c = t.slice(0, n)
	const open = c.lastIndexOf("(")
	if (open > c.lastIndexOf(")")) c = c.slice(0, open)
	else c = c.replace(/\s+\S*$/, "")
	// (and before a comma when there is one: "Add a cutting board 50 cm wide…", never "…50 cm wide, on its…" (V8837 x5))
	const comma = c.lastIndexOf(",")
	if (comma >= 12 && c.indexOf(":") < comma) c = c.slice(0, comma)
	c = c.replace(/[\s,;:–—-]+$/, "")
	return c.length < 8 ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : `${c}…`
}
