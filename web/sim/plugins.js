// The physics modules' plug-in points for everything that is not the engine: goal kinds (the run's summary, the AI's goal checks), the AI's
// catalog digest and prompts, the edit step's readings, the make-it-work search's knobs, the solver's placement rules and the card's words.
// Pure, no imports: ONE registry per JavaScript realm, kept on globalThis[Symbol.for("sandbox.plugins")], so ai/goals.mjs and web/ai/goals.js
// (which import nothing) read the very same one. Filled by web/sim/modules/index.js (written by `node tools/gen-modules.mjs`), which loads
// every module file web/sim/modules/<name>.js and passes its `plugin` export here as registerModule({name: "mod_<name>", ...plugin}).
//
// plugin = {
//   title: "Heat and temperature",                  // what the module is about (the digest's section heading)
//   howto: "...",                                   // a short paragraph for the AI's catalog digest: how its items work together (links,
//                                                   // settings, what to put where); cache-friendly: fixed text
//   prompt: {plan?: "...", edit?: "...", refine?: "..."},  // a few lines added to that step's prompt (fixed text, in module name order)
//   examples: [{ask: "...", plan: {...}}],          // optional: worked requests for the prompts / tests
//   goals: [goalKind],                              // see GOAL KINDS below
//   knobs: [knob],                                  // see KNOBS below
//   digest(item, run, h) -> [lines] | null          // optional extra lines for an item in the edit step's rich digest (the readings are
//                                                   // listed for every item whose type has `readouts`, without this)
//   place: {containers?: [type], inside?: {type: [container types]},   // solver placement rules (see placeRules)
//           interior?(type, props) -> {x0, x1, floor, rim} | null,     // a module container's inside in its own frame (m from its anchor): the
//                                                                     // solver keeps what goes inside it between x0 and x1, above floor, under rim
//           float?(thing, container, riders) -> y | null},            // where a thing put inside a container rests at the start, when not on the
//                                                                     // floor (it floats on a liquid): its anchor's y; thing = {type, props, x,
//                                                                     // angle}, container = {type, props, x, y} (props as the plan gives them),
//                                                                     // riders = [{type, props}]: what rests on it (a boat's cargo) weighs it down
//           hover?(type) -> bool,                                     // a thing a hand holds in the air over others (a pitcher): the solver places
//                                                                     // it after the rest and raises it clear of what it starts inside, however far
//           held?(type, types) -> bool},                              // the module's view holds a fixed item of this type up in a scene of these
//                                                                     // types (a stand it draws), so the solver does not call it floating
//   words: {change?(type, key, a, b, nameOf, items?) -> text | null,   // a change line in real units ("lamp 30 → 20 cm from the ice"); items =
//                                                                     // {before, after} (the item as it was and is) when the caller has them
//           added?(item) -> text | null,                              // what one added thing is called on the card ("a stack of 20 pennies")
//           how?(type, key, a, b) -> word | null,                      // the card's one word for a setting's change where the plain one would
//                                                                     // mislead: "brighter" for a lamp's watts (not "faster"), "a narrower
//                                                                     // beam" for its beam angle (not "tilted less") (howWords)
//           keys?: {"<type>.<key>" | "<key>": "words|regex"},          // the words that name a setting in a request (keyWords below)
//           outcomes?: "words|regex",                                  // more words an outcome is said in ("push\\w* (?:\\w+ ){0,3}away"), beside
//                                                                     // the goal kinds and their aliases (outcomeWords below)
//           picks?: "regex",                                           // request words that pick this module for the AI's prompt though they are
//                                                                     // everyday words ("time it", "how many seconds": ai/catalog-digest.mjs)
//           regoals?: "words|regex",                                   // a change whose real result changes what a goal must expect ("take the
//                                                                     // cap off": a fizz bottle's gas now escapes, so mass_same becomes
//                                                                     // mass_changes): an edit asking for it may change the goals (moduleRegoals)
//           setting?(key, a, b) -> text | null,                         // a scene setting's change ("gravity: Earth → the Moon (g 9.81 → 1.62 m/s²)")
//           moves?(item, run) -> true | null,                          // the item still does its thing in this run though no part of it moves 1 cm
//                                                                     // (a diving board that dips 8.7 mm): no "no longer moves" heads-up (moduleMoves)
//           ownHits?(type) -> false | null,                            // false: its own parts striking each other is no news for the card's story
//                                                                     // (a launcher's pouch on its own board) (ownHitsTold)
//           mass?(type, props) -> kg | null}                           // what one of these weighs on the card when its moving parts are not all of
//                                                                     // it (a ruler whose clamped end the engine holds still) (moduleMass)
// }
//
// GOAL KINDS (the run's summary reports them: web/sim/items.js summarize and machines/items.py, number for number; the AI checks them with
// ai/goals.mjs = web/ai/goals.js; ai/schemas.mjs validates them in plans):
// {
//   kind: "melts", aliases: ["melt", "melted"],          // the kind and the spellings a model may use for it
//   fields: {item: "item", before_s: "number?"},          // "item" an item id, "items" a list of ids, "number", "string", "bool"; "?" optional
//   subject: ["item"],                                   // the fields naming the thing that must do it (default: the first item field)
//   compares?: false,                                   // a and b act on each other (repels: two carts' magnets), not a comparison: the
//                                                        // fix search may change a setting on just one of them (web/ai/fixer.js fairTest)
//   about: "melts {item, before_s?}: ...",               // one line for the prompts' list of goal kinds
//   label(g, nameOf) -> "Ice cube melts completely",     // a label for a goal without one
//   summarize(ctx, g) -> {label, ok, kind, ...} | null,  // the summary entry (ctx: web/sim/items.js GoalCtx), the same as items.py's
//   sample?(scene, pick) -> goal | null                  // a random goal of this kind for the parity fuzz (pick(list) chooses one)
//   detail?(entry) -> "yes (melted at 1 h 14 min ...)"   // the card's words for a result (ai/goals.mjs, web/ai/goals.js); default "yes (at t s)"
//   aim?(g, entry, scene) -> [{changes, cost?}]          // the make-it-work search's targeted tries for a missed goal (web/ai/fixer.js): the
//                                                        // settings that put the number right, worked out from what the run read (entry: its
//                                                        // summarize answer), as [{kind: "prop", id, key, from, to}]; tried first, checked like
//                                                        // any other, never on what the person set (measure: a stopwatch at 3.15 s for 3 s:
//                                                        // the car's speed × 3.15 / 3)
// }
// KNOBS (web/ai/fixer.js, the make-it-work search; it tries the smallest changes first and says them in words):
// {
//   type: "desk-lamp", key: "distance",                  // the item type and the prop (or link) it turns
//   how: "rel" | "m" | "deg" | "abs" | "link" | "choice" | "bool",   // relative steps (5 %…40 %), metres, degrees, `steps` of the prop's
//                                                        // unit, another item for a link (of the link's types), another choice, a flip
//   steps?: [numbers], cost?: 1 (a centimetre's worth per step unit; higher: tried later),
//   min?, max?: the knob's own range inside the prop's (a real egg's breaking force: 30-40 N of the prop's 5-200),
//   more: "move {it} further from the ice", less: "move {it} closer to the ice",   // the offer's words; {it} = the item's name
//   from_zero?: "give {it} a {to} parachute", to_zero?: "take {it}'s parachute off",  // a number from 0, or to 0: said whole ({to} = the new value)
//   why: "what turning it does, honestly",              // for the AI's prompts and the card
//   tune?: false,                                        // the build's tuners never turn it (a plan's tune knob on it is left out, and
//                                                        // said): a material or a pressure is what a lesson compares, not a dial to make a
//                                                        // guessed outcome come true (knobTunable)
//   when?(item, scene) -> bool                           // offered only when this holds (a rubber-band knob only on a car that has a band;
//                                                        // a material only on a ruler not compared with another) (knobApplies)
// }
const KEY = Symbol.for("sandbox.plugins")

/** The registry of this realm. */
export function store() {
	const g = globalThis
	if (!g[KEY]) g[KEY] = { modules: new Map(), goals: new Map(), aliases: new Map(), knobs: new Map(), goalCtx: null, version: 0 }
	return g[KEY]
}

const FIELD_KINDS = new Set(["item", "items", "number", "string", "bool"])

/** Registers a module's plug-ins (web/sim/modules/index.js calls it for each module file, in name order). */
export function registerModule(m) {
	if (!m || typeof m.name !== "string" || !m.name) throw new Error("registerModule: a module needs a name")
	const S = store()
	const mod = { title: m.name, howto: "", prompt: {}, examples: [], goals: [], knobs: [], place: {}, words: {}, ...m }
	for (const k of mod.goals) {
		if (!k || typeof k.kind !== "string" || typeof k.summarize !== "function") throw new Error(`${m.name}: a goal kind needs {kind, summarize}`)
		for (const [f, t] of Object.entries(k.fields ?? {})) if (!FIELD_KINDS.has(String(t).replace(/\?$/, ""))) throw new Error(`${m.name}: goal ${k.kind} field ${f}: unknown kind ${t}`)
		S.goals.set(k.kind, { ...k, module: m.name })
		for (const a of k.aliases ?? []) S.aliases.set(String(a).toLowerCase(), k.kind)
	}
	for (const k of mod.knobs) {
		if (!k || typeof k.type !== "string" || typeof k.key !== "string") throw new Error(`${m.name}: a knob needs {type, key}`)
		const list = S.knobs.get(k.type) ?? []
		list.push({ how: "rel", cost: 1, ...k, module: m.name })
		S.knobs.set(k.type, list)
	}
	S.modules.set(m.name, mod)
	S.version++
	return mod
}

/** Every module, in name order. */
export const modules = () => [...store().modules.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
/** A module goal kind by its kind or one of its aliases, or undefined. */
export function goalKind(kind) {
	if (typeof kind !== "string") return undefined
	const S = store()
	return S.goals.get(kind) ?? S.goals.get(S.aliases.get(kind.toLowerCase()) ?? "")
}
/** The module goal kinds' names, in module order. */
export const goalKindNames = () => modules().flatMap((m) => m.goals.map((k) => k.kind))
/** The fields of a module goal that name items (all of them, or only the subject's). */
export function goalItemFields(spec, { subject = false } = {}) {
	const fields = Object.entries(spec?.fields ?? {}).filter(([, t]) => /^items?\??$/.test(String(t)))
	if (!subject) return fields.map(([f]) => f)
	if (Array.isArray(spec.subject) && spec.subject.length) return spec.subject
	return fields.length ? [fields[0][0]] : []
}
/** What a goal of a module kind is missing or has wrong, or null (ai/schemas.mjs uses it on plans). ids: the plan's item ids (a Set). */
export function goalProblem(g, ids = null) {
	const spec = goalKind(g?.kind)
	if (!spec) return `no goal kind "${g?.kind}"`
	for (const [f, t0] of Object.entries(spec.fields ?? {})) {
		const opt = String(t0).endsWith("?")
		const t = String(t0).replace(/\?$/, "")
		const v = g[f]
		if (v === undefined || v === null) {
			if (!opt) return `${spec.kind} needs ${f}`
			continue
		}
		if (t === "item" && (typeof v !== "string" || (ids && !ids.has(v)))) return `${spec.kind}.${f} must name an item${typeof v === "string" ? ` (no item "${v}")` : ""}`
		if (t === "items" && (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== "string" || (ids && !ids.has(x))))) return `${spec.kind}.${f} must list items`
		if (t === "number" && !(typeof v === "number" && Number.isFinite(v))) return `${spec.kind}.${f} must be a number`
		if (t === "string" && typeof v !== "string") return `${spec.kind}.${f} must be text`
		if (t === "bool" && typeof v !== "boolean") return `${spec.kind}.${f} must be true or false`
	}
	return null
}
/** One line per module goal kind for the prompts ("melts {item, before_s?}: ..."), or "". */
export const goalKindLines = () =>
	modules()
		.flatMap((m) => m.goals.map((k) => `- ${k.about ?? `${k.kind} {${Object.keys(k.fields ?? {}).join(", ")}}`}`))
		.join("\n")

/** The make-it-work knobs a module gives this item type. */
export const knobsFor = (type) => store().knobs.get(type) ?? []
/** The knob of this type and key, or undefined. */
export const knobOf = (type, key) => knobsFor(type).find((k) => k.key === key)

/** The prompt lines the modules add to a step ("plan", "edit", "refine"), in module name order; "" when none. */
export function promptSnippets(step) {
	const parts = []
	for (const m of modules()) {
		const t = m.prompt?.[step]
		if (typeof t === "string" && t.trim()) parts.push(`### ${m.title}\n${t.trim()}`)
	}
	return parts.length ? `## Physics modules\n${parts.join("\n\n")}` : ""
}
/** The modules' how-to paragraphs for the catalog digest ("" when none). */
export function howtoText() {
	const parts = modules()
		.filter((m) => typeof m.howto === "string" && m.howto.trim())
		.map((m) => `### ${m.title}\n${m.howto.trim()}`)
	return parts.length ? `\n## How the physics modules work\n${parts.join("\n\n")}` : ""
}

/** Extra rich-digest lines for an item from its module (h: helpers the digest passes), or []. */
export function digestLines(item, run, h = {}) {
	const out = []
	for (const m of modules()) {
		if (typeof m.digest !== "function") continue
		try {
			const lines = m.digest(item, run, h)
			if (Array.isArray(lines)) out.push(...lines.filter((l) => typeof l === "string" && l))
		} catch {} // (a module's digest never stops the step)
	}
	return out
}

/** Placement rules for the solver: the extra container types, and which containers an item type goes inside. */
export function placeRules() {
	const containers = new Set()
	const inside = new Map()
	for (const m of modules()) {
		for (const t of m.place?.containers ?? []) containers.add(t)
		for (const [t, list] of Object.entries(m.place?.inside ?? {})) inside.set(t, [...(inside.get(t) ?? []), ...list])
	}
	return { containers, inside }
}

/** A module container's inside (place.interior): {x0, x1, floor, rim} in its own frame (m from its anchor), or null when no module knows it. */
export function containerInterior(type, props = {}) {
	for (const m of modules()) {
		if (typeof m.place?.interior !== "function") continue
		try {
			const r = m.place.interior(type, props ?? {})
			if (r && [r.x0, r.x1, r.floor, r.rim].every(Number.isFinite)) return r
		} catch {}
	}
	return null
}
/** Where a thing put inside a container starts when a module says it floats there (place.float): its anchor's y, or null. */
export function floatHeight(thing, container, riders = []) {
	for (const m of modules()) {
		if (typeof m.place?.float !== "function") continue
		try {
			const y = m.place.float(thing, container, riders)
			if (Number.isFinite(y)) return y
		} catch {}
	}
	return null
}

/** Whether a module's view holds a fixed item of this type up in a scene of these item types (place.held: a stand it draws). */
export function heldByModule(type, types) {
	for (const m of modules()) {
		if (typeof m.place?.held !== "function") continue
		try {
			if (m.place.held(type, types)) return true
		} catch {}
	}
	return false
}

/** Whether a module says a thing of this type is held in the air over others by a hand (place.hover: a pitcher over a bowl): the solver places it
 *  after the rest and raises it clear of anything it starts inside, however far (its height is the hand's, not the lesson's). */
export function hoversByModule(type) {
	for (const m of modules()) {
		if (typeof m.place?.hover !== "function") continue
		try {
			if (m.place.hover(type)) return true
		} catch {}
	}
	return false
}

/** A module's words for a prop's change ("distance 30 → 20 cm from the ice"), or null. `items` (optional): {before, after}, the item as it was and
 *  is ({type, props}), so a module can say an unset (auto) prop's own value: a sail that followed its size choice. */
export function changeWords(type, key, a, b, nameOf = (id) => id, items = null) {
	for (const m of modules()) {
		if (typeof m.words?.change !== "function") continue
		try {
			const t = m.words.change(type, key, a, b, nameOf, items)
			if (typeof t === "string" && t) return t
		} catch {}
	}
	return null
}

/** A module's one word for a setting's change on the card ("brighter", "a narrower beam"), or null: `words.how(type, key, a, b)`. */
export function howWords(type, key, a, b) {
	for (const m of modules()) {
		if (typeof m.words?.how !== "function") continue
		try {
			const t = m.words.how(type, key, a, b)
			if (typeof t === "string" && t) return t
		} catch {}
	}
	return null
}

/** A module's words for one added thing ({type, props}: "a stack of 20 pennies"), or null. */
export function addedWords(item) {
	for (const m of modules()) {
		if (typeof m.words?.added !== "function") continue
		try {
			const t = m.words.added(item)
			if (typeof t === "string" && t) return t
		} catch {}
	}
	return null
}

/** A module's words for a change of the scene's settings ("gravity: Earth → the Moon (g 9.81 → 1.62 m/s²)"), or null: `words.setting(key, a, b)`. */
export function settingWords(key, a, b) {
	for (const m of modules()) {
		if (typeof m.words?.setting !== "function") continue
		try {
			const t = m.words.setting(key, a, b)
			if (typeof t === "string" && t) return t
		} catch {}
	}
	return null
}

/** A thing's name as a module says it in a sentence, or null: `words.proper` {name: words}, the name matched without case ("Earth" or "earth" ->
 *  "the Earth", "Mars" -> "Mars": a proper noun keeps its capital and takes its own article, never "the earth" or "the mars"). */
export function properName(name) {
	const n = String(name ?? "").trim().toLowerCase()
	if (!n) return null
	for (const m of modules()) {
		const p = m.words?.proper
		if (!p || typeof p !== "object") continue
		for (const [k, v] of Object.entries(p)) if (k.toLowerCase() === n && typeof v === "string" && v) return v
	}
	return null
}

/** The words that name a module's setting in a request, as a regex alternation ("heav\\w*|weigh\\w*|mass" for a planet's mass_scale), or null:
 *  the edit's reading of what is the person's own choice (web/ai/orchestrator.js choicesOf: "make the Earth half as heavy" holds its mass_scale,
 *  so no fix offers it back). A module says them in `words.keys`: {"<type>.<key>": words} or {"<key>": words}. */
export function keyWords(type, key) {
	for (const m of modules()) {
		const k = m.words?.keys
		if (!k || typeof k !== "object") continue
		const w = k[`${type}.${key}`] ?? k[key]
		if (typeof w === "string" && w) return w
	}
	return null
}

/** The words a request states a module outcome in, as one regex alternation (longest first), or null: every module goal kind and alias ("_" a
 *  space: "pushed away", "melts first") and each module's `words.outcomes`. The edit's reading of "flip the held magnet so the boat is pushed
 *  away" (web/ai/orchestrator.js): an outcome the request asks for, so that edit may change the goals, as "so it lands in the box" may. */
export function outcomeWords() {
	const S = store()
	const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")
	const words = new Set()
	for (const w of [...S.goals.keys(), ...S.aliases.keys()]) {
		const t = String(w).toLowerCase().replace(/[_\s]+/g, " ").trim()
		if (t.length >= 3) words.add(esc(t))
	}
	for (const m of modules()) if (typeof m.words?.outcomes === "string" && m.words.outcomes) words.add(`(?:${m.words.outcomes})`)
	return words.size ? [...words].sort((a, b) => b.length - a.length).join("|") : null
}

/** Whether an edit request names a change that a module says alters what a goal must expect (words.regoals: "take the cap off the bottle"
 *  makes the matter module's mass_same on its scale untrue, as it really is): web/ai/orchestrator.js lets such an edit change the goals. */
export function moduleRegoals(text) {
	const t = String(text ?? "")
	if (!t.trim()) return false
	for (const m of modules()) {
		const w = m.words?.regoals
		if (typeof w !== "string" || !w) continue
		try {
			if (new RegExp(`\\b(?:${w})`, "i").test(t)) return true
		} catch {}
	}
	return false
}

/** Whether a module says the item still does its thing in this run though it hardly moves (words.moves: a beam that bends, a spring or ball
 *  that squashes 2 mm or more): true, or null when no module says so. */
export function moduleMoves(item, run) {
	for (const m of modules()) {
		if (typeof m.words?.moves !== "function") continue
		try {
			if (m.words.moves(item, run) === true) return true
		} catch {}
	}
	return null
}
/** Whether the card's story tells of an item's own parts striking each other (false when a module says that is no news: words.ownHits). */
export function ownHitsTold(type) {
	for (const m of modules()) {
		if (typeof m.words?.ownHits !== "function") continue
		try {
			if (m.words.ownHits(type) === false) return false
		} catch {}
	}
	return true
}
/** What one item of this type weighs by its module (words.mass: kg), or null (the engine's own figure is used). */
export function moduleMass(type, props = {}) {
	for (const m of modules()) {
		if (typeof m.words?.mass !== "function") continue
		try {
			const v = m.words.mass(type, props ?? {})
			if (Number.isFinite(v) && v > 0) return v
		} catch {}
	}
	return null
}
/** Whether a build's tuner may turn this prop (false when its module's knob says tune: false). */
export const knobTunable = (type, key) => knobOf(type, key)?.tune !== false
/** Whether a module knob is offered for this item in this scene (its `when`, if it has one). */
export function knobApplies(kb, item, scene) {
	if (typeof kb?.when !== "function") return true
	try {
		return !!kb.when(item, scene)
	} catch {
		return false
	}
}

/** The goal check's context factory (web/sim/modules/index.js sets it to web/sim/items.js GoalCtx, which ai/goals.mjs cannot import). */
export function setGoalCtx(fn) {
	store().goalCtx = fn
}
/** A goal's result on a whole run ({doc, track, scene?}) by its module kind's summarize: {ok, entry} (ok null when it cannot tell). */
export function checkModuleGoal(g, run) {
	const spec = goalKind(g?.kind)
	const S = store()
	if (!spec || !run?.doc?.solids || !run?.track?.frames?.length || typeof S.goalCtx !== "function") return { ok: null, entry: null }
	try {
		const ctx = S.goalCtx(run.scene ?? null, run.doc, run.track)
		const entry = spec.summarize(ctx, { ...g, kind: spec.kind })
		return { ok: entry ? !!entry.ok : null, entry: entry ?? null }
	} catch {
		return { ok: null, entry: null }
	}
}

/** For tests: forget everything registered. */
export function _resetPlugins() {
	const S = store()
	S.modules.clear()
	S.goals.clear()
	S.aliases.clear()
	S.knobs.clear()
	S.goalCtx = null
	S.version++
}
