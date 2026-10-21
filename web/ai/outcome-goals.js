// The browser's copy of ai/edit-outcome.mjs (core-ai, 20 Oct): statesNewOutcome, does an edit request ask for an outcome in its own words
// ("make the 100 g spring squash more than the 300 g spring", "make the boat float", "so the ice melts first"), one a goal can check? Then the
// edit's own goal for it is kept (web/ai/orchestrator.js goalsAsked), also in a "fix", and the fix is no pure "make it work". orderOf /
// overriddenBy: a goal that puts things in an order, and whether the goals on the table turn that order round (the card's "No longer checked:
// … (the new outcome makes it untrue)"). Keep them the same as the server's (ai/test/edit-outcome.test.mjs checks the words agree).
import { goalKind, moduleGoal } from "./goals.js"

// what a thing does (an outcome), as a verb: the core goals' and the physics modules' (a bare verb after "make <the thing>", or before
// "more than" / "first"); never "work" ("make it work" asks for the scene's own goals again)
const VERBS =
	"land|fall|topple|tip|roll|go|travel|move|slide|fly|bounce|hit|reach|knock|spin|swing|stop|win|finish|cross|arrive|break|crack|smash|shatter|survive|squash|squeeze|bend|stretch|compress|dent|sag|melt|freeze|boil|dissolve|cool|warm|heat|glow|light|shine|ring|sound|buzz|beep|pour|drain|fill|empty|float|sink|rise|lift|sail|drift|attract|repel|stick|orbit|launch|overtake|beat|race|tick|balance|turn"
const FORMS = `(?:${VERBS})(?:s|es|ed|ing)?`
const AFTER = "more|less|farther|further|faster|slower|higher|lower|longer|sooner|earlier|later|first|last|before|after|up|over|off|out|into|onto|in|through|across|past|again|completely|apart|together|away|down|the most|the least|at all"
// ("race": "add a second car next to it, so the two race" asks for a race the run must show, checked by a goal: faster, farther, crosses)
// "make <up to 6 words> <verb>" followed by what says how (more, first, up, off...) or by the end of the clause
const MAKE_RE = new RegExp(`\\bmake\\s+(?:[\\w'’%.-]+\\s+){1,6}?${FORMS}(?:\\s+(?:${AFTER})\\b|\\s*(?:[,.;:!?]|$)|\\s+(?:and|but|so|without|while|when|than|instead)\\b)`, "i")
// "<verb> more than", "<verb> first", "<verb> before the …"
const THAN_RE = new RegExp(`\\b${FORMS}\\s+(?:(?:a lot|a bit|a little|much|far|clearly|even)\\s+)?(?:more|less|farther|further|faster|slower|higher|lower|longer|sooner|earlier|later)\\s+than\\b|\\b${FORMS}\\s+(?:first|before (?:the|a|an|it|they|both)\\b)`, "i")
// "make the stopwatch read 3 s", "make the spring squash 2 cm"
const NUM_RE = /\bmake\s+(?:[\w'’%.-]+\s+){1,6}?(?:read|show|squash|stretch|bend|sag|reach|go|roll|travel|fly|rise)(?:s|es)?\s+(?:about\s+|exactly\s+|at least\s+|over\s+|more than\s+)?\d/i
// "so (that) the boat floats", "until it melts", "make sure the bulb lights"
const SO_RE = new RegExp(`\\b(?:so(?: that)?|until|make sure(?: that)?)\\s+(?:it|they|both|all|each|the(?:\\s+[\\w'’%.-]+){1,4}|[\\w-]+\\s+\\d+)\\s+(?:(?:is|are|gets?|will|would|still|then|also|now|be|stays?|keeps?|can|does|do|doesn['’]t|don['’]t|never)\\s+)*${FORMS}\\b`, "i")
// a request that only asks for the scene's own goals again ("make it work", "fix it", the app's own "Make it work again so that …, keeping …")
const AGAIN_RE = /^\s*(?:(?:ok(?:ay)?|now|please|just|so|and|then|can you|could you)[,\s]+)*(?:make (?:it|this|that|them|everything|the (?:scene|machine)) work\b|fix (?:it|this|that|the (?:scene|machine))\b|get (?:it|this) (?:to )?work(?:ing)?\b|try again\b)/i

/** Does the request ask for an outcome in its own words (one a goal can check), not only for the scene's goals to work again? */
export function statesNewOutcome(text) {
	const t = String(text ?? "")
	if (!t.trim() || AGAIN_RE.test(t)) return false
	return MAKE_RE.test(t) || THAN_RE.test(t) || SO_RE.test(t) || NUM_RE.test(t)
}

// ---- goals that put things in an order ("a squashes more than b", "a melts before b"): as ai/edit-outcome.mjs orderOf
const PAIRS = [
	["a", "b"],
	["item", "other"]
]
/** An order goal's {a, b, sig} (a module kind with two item fields a, b or item, other whose rule says "than" or "before", never one about both
 *  together; sig = the kind and its other fields), or null. */
export function orderOf(g) {
	const spec = moduleGoal(goalKind(g))
	if (!spec) return null
	const about = String(spec.about ?? "")
	if (!/\b(than|before|sooner)\b/i.test(about) || /\b(each other|together|opposite)\b/i.test(about)) return null
	const f = spec.fields ?? {}
	const pair = PAIRS.find(([x, y]) => String(f[x] ?? "").startsWith("item") && String(f[y] ?? "").startsWith("item"))
	if (!pair) return null
	const [x, y] = pair
	if (typeof g[x] !== "string" || typeof g[y] !== "string" || g[x] === g[y]) return null
	const rest = Object.keys(f)
		.filter((k) => k !== x && k !== y)
		.sort()
		.map((k) => [k, g[k] ?? null])
	return { a: g[x], b: g[y], sig: `${spec.kind}|${JSON.stringify(rest)}` }
}
/** The same order goal (kind, other fields and direction), as a key; null for any other goal. */
export function orderKey(g) {
	const o = orderOf(g)
	return o ? `${o.sig}|${o.a}>${o.b}` : null
}
/** Do `goals` turn g's order round (b ahead of a, directly or through others of the same kind)? */
export function overriddenBy(g, goals) {
	const o = orderOf(g)
	if (!o) return false
	const out = new Map()
	for (const h of Array.isArray(goals) ? goals : []) {
		const p = h && typeof h === "object" ? orderOf(h) : null
		if (!p || p.sig !== o.sig) continue
		if (!out.has(p.a)) out.set(p.a, [])
		out.get(p.a).push(p.b)
	}
	const seen = new Set([o.b])
	const todo = [o.b]
	while (todo.length) {
		const n = todo.pop()
		for (const m of out.get(n) ?? []) {
			if (m === o.a) return true
			if (!seen.has(m)) seen.add(m), todo.push(m)
		}
	}
	return false
}
