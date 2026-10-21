// An edit's own outcome (core-ai, 20 Oct): a request that asks for something to HAPPEN in its own words ("make the 100 g spring squash more
// than the 300 g spring", "make the boat float", "so the ice melts first") is checked by a goal, as a built scene's outcomes are; and the goals
// an edit leaves cannot contradict each other (a new "A squashes more than C" beside the scene's "C more than B" and "B more than A").
// Pure (one import: the goal kinds of ./goals.mjs, which imports nothing). web/ai/outcome-goals.js is the browser's copy of statesNewOutcome:
// keep the two the same (web/ai/test/outcome-goals.test.mjs checks they agree).
//   statesNewOutcome(text) -> bool      goalClash(goals, before) -> null | {cycle: [goal], fresh: [goal], old: [goal]}
import { goalKind, goalLabel, moduleGoal } from "./goals.mjs"

// what a thing does (an outcome), as a verb: the core goals' and the physics modules' (a bare verb after "make <the thing>", or before
// "more than" / "first"); never "work" ("make it work" asks for the scene's own goals again)
const VERBS =
	"land|fall|topple|tip|roll|go|travel|move|slide|fly|bounce|hit|reach|knock|spin|swing|stop|win|finish|cross|arrive|break|crack|smash|shatter|survive|squash|squeeze|bend|stretch|compress|dent|sag|melt|freeze|boil|dissolve|cool|warm|heat|glow|light|shine|ring|sound|buzz|beep|pour|drain|fill|empty|float|sink|rise|lift|sail|drift|attract|repel|stick|orbit|launch|overtake|beat|tick|balance|turn"
const FORMS = `(?:${VERBS})(?:s|es|ed|ing)?`
const AFTER = "more|less|farther|further|faster|slower|higher|lower|longer|sooner|earlier|later|first|last|before|after|up|over|off|out|into|onto|in|through|across|past|again|completely|apart|together|away|down|the most|the least|at all"
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

// ---- goals that put things in an order ("a squashes more than b", "a melts before b"): a module kind with two item fields a, b (or item,
// other) whose rule says "than" or "before"; never one about both together ("each other", "together", "opposite": repels, lands_together,
// recoils), never a core kind
const PAIRS = [
	["a", "b"],
	["item", "other"]
]
function orderOf(g) {
	const spec = moduleGoal(goalKind(g))
	if (!spec) return null
	const about = String(spec.about ?? "")
	if (!/\b(than|before|sooner)\b/i.test(about) || /\b(each other|together|opposite)\b/i.test(about)) return null
	const f = spec.fields ?? {}
	const pair = PAIRS.find(([x, y]) => String(f[x] ?? "").startsWith("item") && String(f[y] ?? "").startsWith("item"))
	if (!pair) return null
	const [x, y] = pair
	if (typeof g[x] !== "string" || typeof g[y] !== "string" || g[x] === g[y]) return null
	// (the same quantity: the same kind with the same other fields, "warmer at 10 min" is not "warmer at the end")
	const rest = Object.keys(f)
		.filter((k) => k !== x && k !== y)
		.sort()
		.map((k) => [k, g[k] ?? null])
	return { a: g[x], b: g[y], sig: `${spec.kind}|${JSON.stringify(rest)}` }
}
const sameGoal = (g, h) => {
	const o = orderOf(g)
	const p = orderOf(h)
	return !!o && !!p && o.sig === p.sig && o.a === p.a && o.b === p.b
}

/**
 * Goals of one order kind that go round in a circle (A more than C, C more than B, B more than A) can never all happen. -> null, or the
 * circle {cycle: [goals, in order], fresh: the ones `before` (the scene's goals) does not have, old: the scene's own}. Only a circle with a
 * goal of this change in it is returned (one the scene had already is not this change's).
 */
export function goalClash(goals, before = []) {
	const list = (Array.isArray(goals) ? goals : []).filter((g) => g && typeof g === "object")
	const had = (Array.isArray(before) ? before : []).filter((g) => g && typeof g === "object")
	const edges = new Map() // sig -> [{a, b, g}]
	for (const g of list) {
		const o = orderOf(g)
		if (!o) continue
		if (!edges.has(o.sig)) edges.set(o.sig, [])
		edges.get(o.sig).push({ ...o, g })
	}
	for (const es of edges.values()) {
		const out = new Map()
		for (const e of es) {
			if (!out.has(e.a)) out.set(e.a, [])
			out.get(e.a).push(e)
		}
		// depth first from each thing: the first path that comes back to where it started
		const find = (start) => {
			const seen = new Set()
			const walk = (node, path) => {
				for (const e of out.get(node) ?? []) {
					if (e.b === start) return [...path, e]
					if (seen.has(e.b)) continue
					seen.add(e.b)
					const p = walk(e.b, [...path, e])
					if (p) return p
				}
				return null
			}
			return walk(start, [])
		}
		for (const start of out.keys()) {
			const path = find(start)
			if (!path) continue
			const cycle = path.map((e) => e.g)
			const fresh = cycle.filter((g) => !had.some((h) => sameGoal(g, h)))
			if (!fresh.length) continue
			return { cycle, fresh, old: cycle.filter((g) => !fresh.includes(g)) }
		}
	}
	return null
}

/** The words of a clash for the edit step's repair turn. */
export function clashText(c) {
	const say = (g) => `“${String(g.label ?? goalLabel(g)).replace(/[.!]+$/, "")}”`
	const all = c.cycle.map(say).join(", ")
	if (!c.old.length) return `set_goals: these goals cannot all happen, they go round in a circle (${all}): keep only the outcome the request asks for`
	return `set_goals: these goals cannot all happen, they go round in a circle (${all}): the new outcome ${c.fresh.map(say).join(" and ")} overrides the scene's ${c.old.map(say).join(" or ")}. Leave out the scene's goal that the request contradicts (${c.old.length > 1 ? "one of them: the one the request's outcome makes untrue" : "it"}), keep every other goal, and say in the reply which goal you left out and why`
}
