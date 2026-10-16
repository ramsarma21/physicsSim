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
	return String(text ?? "").replace(/(^|, | and |; )([a-z]+)\b/g, (m, sep, w) => (VERBS[w] ? `${sep}${VERBS[w]}` : m))
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
	c = c.replace(/[\s,;:–—-]+$/, "")
	return c.length < 8 ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : `${c}…`
}
