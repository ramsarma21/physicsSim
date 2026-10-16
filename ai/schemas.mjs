// What each AI step must answer, as JSON schemas (a small hand-written subset of JSON Schema, no dependencies) plus the checks a schema
// cannot express: every type is a real catalog type, every prop a real key of that type inside its range, ids unique, every reference
// (on, inside, left_of, right_of, lean ends, goals, tune knobs, patches) pointing at an item that exists, supports without cycles.
// Pure functions: the catalog index (ai/catalog-digest.mjs getCatalog().index) comes in through ctx.
//
//   const r = validate("plan", value, { catalog: cat.index, stage })
//   r.ok, r.errors (plain sentences with a path, for the repair prompt), r.warnings (small fixes made), r.value (the normalised copy)
//
// Steps: "observe" (observation), "plan", "refine" (critique + patches to the plan), "edit" (patches or a whole new plan).
// Patch ops (refine and edit): move, set_props, add, remove, replace_type, set_place, set_item, set_scene, set_goals, set_tune, set_stages;
// move and set_props may name several items at once with `ids` (expanded here into one patch per item, so a client applies them as single
// patches). Plans of a chain may list `stages` (2026-10-15, round 2): each stage's expectation (`does`), its own check (a goal: in, falls,
// hits, moves) and its own tune knobs, so the critic and the tuner can find and fix the first stage that fails. A stage problem never costs
// a repair turn: a check or knob that does not fit the plan is dropped with a warning. Steps also: "rate" (refine's rate-only final check:
// {score_0_10, issues}, no patches).
// applyPatches(plan, patches, catalog) applies them to a plan (a new object); planFromScene(scene) turns a scene into an exact plan.
// Goals (ai/goals.mjs): "in" {item, container}, "falls" {item | items}, "hits" {item, target, before_s?}, "moves" {item, min_m}.
// ctx extras (all optional): observation (plan: every observed object must be accounted for in plan.covers), text (the request: "make it
// work" pictures need their depicted outcome as a goal; refine may not change the material of a requested thing), goalResults (refine: the
// goals' results in the run being judged, from ai/goals.mjs checkGoals: a failing goal caps the score and keeps done false).
import { GOAL_KINDS, goalItems, goalKind, goalLabel } from "./goals.mjs"

export const RESERVED_IDS = ["table", "air"]
export const GOAL_CONTAINERS = ["box", "cup", "bucket", "basket"]
export const LIMITS = { items: 150, idLength: 40, goals: 10, tune: 12, patches: 150, missing: 30, observedObjects: 60, relations: 120, covers: 60, differences: 20, stages: 12, stageKnobs: 6 }
/** Types that count as several things (a domino row's dominoes): the prop that says how many. */
export const MULTI_UNIT = { "domino-row": "count", "newtons-cradle": "count" }
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/
const DEFAULT_STAGE = { x0: -0.559, x1: 3.191, y0: -0.156, y1: 2.344 }
const STAGE_SLACK = 0.6 // m: how far outside the stage a placement may reach before it is called a mistake

// ---------------------------------------------------------------- the schemas (structure)
const str = (maxLength, minLength = 0) => ({ type: "string", minLength, maxLength })
const num = (minimum, maximum) => ({ type: "number", minimum, maximum })
const strings = (maxItems, maxLength = 300) => ({ type: "array", maxItems, items: str(maxLength) })

const placeEnd = {
	type: "object",
	required: ["on", "x"],
	additionalProperties: false,
	properties: { on: str(40, 1), x: num(-1000, 1000), y: num(-1000, 1000) }
}
const relation = { type: "object", required: ["id"], additionalProperties: false, properties: { id: str(40, 1), gap_m: num(0, 10) } }

export const placeSchema = {
	type: "object",
	required: ["on"],
	additionalProperties: false,
	properties: {
		on: str(40, 1), // "table" | "air" | an item id
		x: num(-1000, 1000), // the item's anchor x, metres, the scene's own x (the table's top runs along it)
		left_of: relation,
		right_of: relation,
		angle_deg: num(-360, 360),
		lean: { type: "object", required: ["from", "to"], additionalProperties: false, properties: { from: placeEnd, to: placeEnd } },
		inside: str(40, 1),
		y_m: num(-1000, 1000), // "air" only: the anchor's height above the table top
		align: { enum: ["touching", "gap"] }
	}
}

const propsSchema = { type: "object", additionalProperties: { type: ["number", "integer", "boolean", "string", "null"] } }

export const planItemSchema = {
	type: "object",
	required: ["id", "type", "place"],
	additionalProperties: false,
	properties: {
		id: str(40, 1),
		type: str(60, 1),
		name: str(80),
		props: propsSchema,
		place: placeSchema,
		held: { type: "boolean" },
		fixed: { type: "boolean" },
		why: str(400)
	}
}

const goalSchema = {
	type: "object",
	required: ["label"],
	additionalProperties: false,
	properties: {
		kind: { enum: GOAL_KINDS },
		label: str(200, 1),
		item: str(40, 1),
		items: { type: "array", minItems: 1, maxItems: LIMITS.items, items: str(40, 1) }, // falls: several things that must all fall
		container: str(40, 1), // in
		target: str(40, 1), // hits
		before_s: num(0, 20), // hits: by this time (s)
		min_m: num(0.005, 20) // moves: at least this far (m)
	}
}
const tuneSchema = { type: "object", required: ["id", "param", "min", "max"], additionalProperties: false, properties: { id: str(40, 1), param: str(40, 1), min: num(-1e5, 1e5), max: num(-1e5, 1e5), why: str(300) } }
const coverSchema = {
	type: "object",
	required: ["label", "ids"],
	additionalProperties: false,
	properties: {
		label: str(60, 1), // an observed object's label, exactly
		count: { type: "integer", minimum: 1, maximum: 500 }, // how many the observation saw (filled in from it)
		size_m: { type: ["object", "null"], additionalProperties: false, properties: { w: num(0, 100), h: num(0, 100), d: num(0, 100) } }, // its size as seen (filled in)
		ids: { type: "array", maxItems: LIMITS.items, items: str(40, 1) }, // the plan items that build it ([] = not built: the note says why)
		note: str(300)
	}
}
const stageCheckSchema = { ...goalSchema, required: [] } // a stage's check: a goal (its label defaults to the stage's)
const stageSchema = {
	type: "object",
	required: ["label"],
	additionalProperties: false,
	properties: {
		label: str(120, 1), // "Pendulum knocks the ball"
		does: str(300), // the expectation: what this stage must do, with its numbers ("swings from 60° and hits the ball at about 0.5 s")
		items: { type: "array", maxItems: 40, items: str(40, 1) }, // the plan items of this stage
		check: stageCheckSchema, // a goal the run can test for this stage (in, falls, hits, moves)
		tune: { type: "array", maxItems: LIMITS.stageKnobs, items: tuneSchema } // this stage's own knobs (the tuner works on the first failing stage first)
	}
}
/** A next edit offered as a chip: a short label and the whole request it sends (ai/DESIGN.md §13.9). */
const suggestionsSchema = {
	type: "array",
	maxItems: 3,
	items: { type: "object", required: ["label", "prompt"], additionalProperties: false, properties: { label: str(60, 1), prompt: str(300, 1) } }
}
const missingSchema = {
	type: "object",
	required: ["asked", "reason", "substitute_type"],
	additionalProperties: false,
	properties: { asked: str(160, 1), reason: str(400, 1), substitute_type: { type: ["string", "null"], maxLength: 60 }, substitute_id: { type: ["string", "null"], maxLength: 40 } }
}

export const planSchema = {
	type: "object",
	required: ["title", "seconds", "items", "missing", "goals", "tune", "notes"],
	additionalProperties: false,
	properties: {
		title: str(80, 1),
		seconds: num(0.5, 20),
		release: num(0, 20),
		stage: { type: "object", required: ["x0", "x1", "y0", "y1"], additionalProperties: false, properties: { x0: num(-50, 50), x1: num(-50, 50), y0: num(-50, 50), y1: num(-50, 50) } },
		table: { type: "object", additionalProperties: false, properties: { props: propsSchema } },
		items: { type: "array", minItems: 1, maxItems: LIMITS.items, items: planItemSchema },
		missing: { type: "array", maxItems: LIMITS.missing, items: missingSchema },
		goals: { type: "array", maxItems: LIMITS.goals, items: goalSchema },
		tune: { type: "array", maxItems: LIMITS.tune, items: tuneSchema },
		notes: str(3000),
		assumptions: strings(20, 300),
		differences: strings(LIMITS.differences, 300), // what differs from the picture or the request, and why (a colour the library lacks, a raised ramp)
		covers: { type: "array", maxItems: LIMITS.covers, items: coverSchema }, // with an observation: what builds each observed object
		stages: { type: "array", maxItems: LIMITS.stages, items: stageSchema }, // a chain's stages in order (4 or more stages: the prompt asks for them)
		reply: str(400), // ≤ 2 short first-person sentences for the chat, in the user's units (ai/DESIGN.md §13.9)
		suggestions: suggestionsSchema // 2-3 next edits of THIS scene, as chips
	}
}

const idsField = { type: "array", minItems: 1, maxItems: LIMITS.items, items: str(40, 1) }
const PATCH_FIELDS = {
	// move and set_props: `id`, or `ids` for the same change to several items (checkPatches expands it into one patch per item)
	move: { required: [], properties: { ids: idsField, x: num(-1000, 1000), dx: num(-100, 100), y_m: num(-1000, 1000), dy: num(-100, 100), angle_deg: num(-360, 360) } },
	set_props: { required: ["props"], properties: { ids: idsField, props: propsSchema } },
	add: { required: ["item"], properties: { item: planItemSchema } },
	remove: { required: ["id"], properties: {} },
	replace_type: { required: ["id", "type"], properties: { type: str(60, 1), props: propsSchema } },
	set_place: { required: ["id", "place"], properties: { place: placeSchema } },
	set_item: { required: ["id"], properties: { name: str(80), held: { type: "boolean" }, fixed: { type: "boolean" } } },
	set_scene: { required: [], properties: { seconds: num(0.5, 20), release: num(0, 20), title: str(80, 1) } },
	set_goals: { required: ["goals"], properties: { goals: { type: "array", maxItems: LIMITS.goals, items: goalSchema } } },
	set_tune: { required: ["tune"], properties: { tune: { type: "array", maxItems: LIMITS.tune, items: tuneSchema } } },
	set_stages: { required: ["stages"], properties: { stages: { type: "array", maxItems: LIMITS.stages, items: stageSchema } } }
}
export const PATCH_OPS = Object.keys(PATCH_FIELDS)
export const patchSchemas = Object.fromEntries(
	Object.entries(PATCH_FIELDS).map(([op, f]) => [
		op,
		{ type: "object", required: ["op", ...f.required], additionalProperties: false, properties: { op: { const: op }, id: str(40, 1), why: str(300), ...f.properties } }
	])
)

export const observationSchema = {
	type: "object",
	required: ["objects", "relations", "motion_story", "view", "scale_hint", "uncertain"],
	additionalProperties: false,
	properties: {
		summary: str(1500),
		objects: {
			type: "array",
			maxItems: LIMITS.observedObjects,
			items: {
				type: "object",
				required: ["label", "count", "bbox", "est_size_m", "material", "color", "state", "supports"],
				additionalProperties: false,
				properties: {
					label: str(60, 1),
					count: { type: "integer", minimum: 1, maximum: 500 },
					image: { type: "integer", minimum: 0, maximum: 7 },
					bbox: { type: "array", minItems: 4, maxItems: 4, items: num(0, 1) },
					est_size_m: {
						type: ["object", "null"],
						required: ["w", "h"],
						additionalProperties: false,
						properties: { w: num(0.0005, 100), h: num(0.0005, 100), d: num(0.0005, 100) }
					},
					material: str(80),
					color: str(60),
					state: { enum: ["resting", "leaning", "held", "moving", "hanging"] },
					supports: { type: ["string", "null"], maxLength: 60 },
					notes: str(300)
				}
			}
		},
		relations: {
			type: "array",
			maxItems: LIMITS.relations,
			items: {
				type: "object",
				required: ["a", "rel", "b"],
				additionalProperties: false,
				properties: {
					a: str(60, 1),
					rel: { enum: ["left_of", "right_of", "on", "inside", "touching", "leaning_on", "hanging_from", "above", "below", "in_front_of", "behind", "attached_to", "aimed_at"] },
					b: str(60, 1)
				}
			}
		},
		motion_story: strings(20, 400),
		view: {
			type: "object",
			required: ["camera", "plane"],
			additionalProperties: false,
			properties: { camera: { enum: ["side", "front", "three-quarter", "top", "other"] }, plane: str(400, 1), notes: str(400) }
		},
		scale_hint: {
			type: ["object", "null"],
			required: ["label", "size_m", "dimension"],
			additionalProperties: false,
			properties: { label: str(60, 1), size_m: num(0.001, 100), dimension: { enum: ["width", "height", "diameter", "length", "depth"] } }
		},
		uncertain: strings(20, 300)
	}
}

export const refineSchema = {
	type: "object",
	required: ["done", "score_0_10", "issues", "patches"],
	additionalProperties: false,
	properties: {
		done: { type: "boolean" },
		score_0_10: num(0, 10),
		issues: {
			type: "array",
			maxItems: 30,
			items: { type: "object", required: ["severity", "text"], additionalProperties: false, properties: { severity: { enum: ["high", "medium", "low"] }, text: str(400, 1), ids: { type: "array", maxItems: 20, items: str(40, 1) } } }
		},
		patches: { type: "array", maxItems: LIMITS.patches, items: { type: "object" } },
		notes: str(1500)
	}
}

/** refine's rate-only final check (payload rate_only: true): a score and the issues left, nothing to apply. */
export const rateSchema = {
	type: "object",
	required: ["score_0_10", "issues"],
	additionalProperties: false,
	properties: {
		score_0_10: num(0, 10),
		issues: refineSchema.properties.issues,
		notes: str(600)
	}
}

/** What an edit answer is (ai/DESIGN.md §14): a change, a question back when the request is truly ambiguous, an answer to a question, a fix
 *  ("make it work"), an undo, or a new scene. ask, answer and undo change nothing. */
export const EDIT_KINDS = ["change", "ask", "answer", "fix", "undo", "new"]
export const EDIT_NO_CHANGE = ["ask", "answer", "undo"]
const MAX_TARGETS = 20
export const editSchema = {
	type: "object",
	required: ["mode", "reply"],
	additionalProperties: false,
	properties: {
		kind: { type: "string" }, // one of EDIT_KINDS (checked in validateEdit, with the measured error words)
		targets: { type: "array", maxItems: MAX_TARGETS, items: { type: "object" } }, // [{says, ids, because}]: what each thing the request names is
		mode: { enum: ["patch", "plan", "new"] }, // new: the user wants a different scene (the server then plans it: ai/DESIGN.md §13.8)
		reply: str(1200, 1),
		why: str(300), // one sentence: why this is a change of the scene on screen, or a new scene
		suggestions: suggestionsSchema, // 2-3 next edits of THIS scene (§13.9)
		patches: { type: "array", maxItems: LIMITS.patches, items: { type: "object" } },
		plan: { type: "object" },
		missing: { type: "array", maxItems: LIMITS.missing, items: missingSchema }, // what THIS request asked for that the library does not have
		plan_missing: { type: "array", maxItems: LIMITS.missing, items: missingSchema }, // (set by validateEdit, never by the model: the scene's own list after the change)
		notes: str(3000), // mode patch: the plan's notes, rewritten when the change made them untrue
		assumptions: strings(20, 300), // mode patch: the same for the assumptions
		undo: { type: "boolean" } // the user asked to undo or go back: no patches; the reply points at Undo (the app may undo by itself)
	}
}

export const SCHEMAS = { observation: observationSchema, plan: planSchema, refine: refineSchema, rate: rateSchema, edit: editSchema, place: placeSchema, planItem: planItemSchema, patch: patchSchemas }

// ---------------------------------------------------------------- the structural checker (JSON Schema subset)
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v)
const typeOk = (v, t) => {
	const k = typeOf(v)
	if (t === "number") return (k === "number" || k === "integer") && Number.isFinite(v)
	if (t === "integer") return k === "integer"
	return k === t
}
const short = (v) => {
	const s = JSON.stringify(v)
	return s === undefined ? String(v) : s.length > 40 ? s.slice(0, 37) + "..." : s
}

/** Structural errors of value against a schema (subset: type, enum, const, minimum, maximum, minLength, maxLength, items, minItems,
 *  maxItems, properties, required, additionalProperties). Appends plain sentences to errors. */
export function checkSchema(schema, v, path, errors) {
	if (!schema) return
	if (schema.const !== undefined && v !== schema.const) return void errors.push(`${path} must be ${short(schema.const)}, not ${short(v)}`)
	if (schema.enum && !schema.enum.includes(v)) return void errors.push(`${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}, not ${short(v)}`)
	if (schema.type) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type]
		if (!types.some((t) => typeOk(v, t))) return void errors.push(`${path} must be ${types.join(" or ")}, not ${v === undefined ? "missing" : short(v)}`)
		if (v === null) return
	}
	if (typeof v === "number") {
		if (schema.minimum !== undefined && v < schema.minimum) errors.push(`${path} is ${v}, below the minimum ${schema.minimum}`)
		if (schema.maximum !== undefined && v > schema.maximum) errors.push(`${path} is ${v}, above the maximum ${schema.maximum}`)
	}
	if (typeof v === "string") {
		if (schema.minLength !== undefined && v.trim().length < schema.minLength) errors.push(`${path} must not be empty`)
		if (schema.maxLength !== undefined && v.length > schema.maxLength) errors.push(`${path} is ${v.length} characters long; at most ${schema.maxLength}`)
	}
	if (Array.isArray(v)) {
		if (schema.minItems !== undefined && v.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} entr${schema.minItems === 1 ? "y" : "ies"}`)
		if (schema.maxItems !== undefined && v.length > schema.maxItems) errors.push(`${path} has ${v.length} entries; at most ${schema.maxItems}`)
		if (schema.items) v.forEach((x, i) => checkSchema(schema.items, x, `${path}[${i}]`, errors))
	}
	if (typeOf(v) === "object") {
		for (const k of schema.required ?? []) if (v[k] === undefined) errors.push(`${path}.${k} is missing`)
		const props = schema.properties ?? {}
		for (const [k, x] of Object.entries(v)) {
			if (props[k]) checkSchema(props[k], x, `${path}.${k}`, errors)
			else if (schema.additionalProperties === false) {
				const hint = suggest(k, Object.keys(props))
				errors.push(`${path}.${k} is not a field here${hint ? ` (did you mean "${hint}"?)` : ""}; allowed: ${Object.keys(props).join(", ")}`)
			} else if (typeof schema.additionalProperties === "object") checkSchema(schema.additionalProperties, x, `${path}.${k}`, errors)
		}
	}
}

// ---------------------------------------------------------------- helpers
function lev(a, b) {
	const m = a.length
	const n = b.length
	if (!m || !n) return m || n
	let prev = Array.from({ length: n + 1 }, (_, j) => j)
	for (let i = 1; i <= m; i++) {
		const cur = [i]
		for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
		prev = cur
	}
	return prev[n]
}
/** The candidate closest to name (by edit distance, or containing it), or null. */
export function suggest(name, candidates) {
	const s = String(name).toLowerCase()
	let best = null
	let bd = Infinity
	for (const c of candidates) {
		const d = lev(s, c.toLowerCase())
		if (d < bd) [best, bd] = [c, d]
	}
	if (best && bd <= Math.max(2, Math.floor(s.length / 3))) return best
	const sub = candidates.find((c) => c.toLowerCase().includes(s) || s.includes(c.toLowerCase()))
	return sub ?? null
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const stageOf = (ctx) => {
	const s = ctx.stage ?? ctx.plan?.stage ?? ctx.scene?.stage
	return s && [s.x0, s.x1, s.y0, s.y1].every(Number.isFinite) ? s : DEFAULT_STAGE
}
function normTypeKey(t, catalog) {
	if (typeof t !== "string" || catalog.types[t]) return t
	const k = t.trim().toLowerCase().replace(/[\s_]+/g, "-")
	return catalog.types[k] ? k : t
}

/** Check one prop value against its catalog spec; returns [value (clamped / coerced), error or null]. */
export function checkProp(spec, v, path) {
	if (v === null) return [null, null] // null = back to the default (patches)
	if (spec.kind === "bool") return typeof v === "boolean" ? [v, null] : [v, `${path} must be true or false, not ${short(v)}`]
	if (spec.kind === "choice") {
		if (typeof v === "string" && spec.choices.includes(v)) return [v, null]
		const hint = typeof v === "string" ? suggest(v, spec.choices) : null
		return [v, `${path} must be one of ${spec.choices.map((c) => JSON.stringify(c)).join(", ")}, not ${short(v)}${hint ? ` (did you mean "${hint}"?)` : ""}`]
	}
	if (typeof v !== "number" || !Number.isFinite(v)) return [v, `${path} must be a number${spec.unit ? ` (${spec.unit})` : ""}, not ${short(v)}`]
	if (spec.kind === "int" && !Number.isInteger(v)) return [v, `${path} must be a whole number, not ${v}`]
	const eps = (b) => 1e-9 * Math.max(1, Math.abs(b))
	if (spec.min !== undefined && v < spec.min - eps(spec.min)) return [v, `${path} is ${v}${spec.unit ? " " + spec.unit : ""}, below its minimum ${spec.min}`]
	if (spec.max !== undefined && v > spec.max + eps(spec.max)) return [v, `${path} is ${v}${spec.unit ? " " + spec.unit : ""}, above its maximum ${spec.max}`]
	let x = v
	if (spec.min !== undefined) x = Math.max(spec.min, x)
	if (spec.max !== undefined) x = Math.min(spec.max, x)
	return [x, null]
}

/** Check a props object against a type; returns the cleaned props (errors appended). allowNull: patches may reset a prop with null. */
function checkProps(props, typeKey, catalog, path, errors, { allowNull = false } = {}) {
	const T = catalog.types[typeKey]
	if (props === undefined) return {}
	if (!isObj(props)) {
		errors.push(`${path} must be an object of {prop: value}`)
		return {}
	}
	if (!T) return props
	const out = {}
	for (const [k, v] of Object.entries(props)) {
		const spec = T.props[k]
		if (!spec) {
			const hint = suggest(k, Object.keys(T.props))
			errors.push(`${path}.${k} is not a prop of ${typeKey}${hint ? ` (did you mean "${hint}"?)` : ""}; its props are: ${Object.keys(T.props).join(", ")}`)
			continue
		}
		if (v === null && !allowNull) continue // leave it at its default
		const [x, err] = checkProp(spec, v, `${path}.${k}`)
		if (err) errors.push(err)
		else out[k] = x
	}
	return out
}

// ---------------------------------------------------------------- free text a hair too long (bench 2026-10-15)
/** Free-text fields (reasons, notes, issue texts, labels of goals) longer than their limit are cut, with a warning: the limits keep prompts and
 *  the report small, and a repair turn spent on 438 characters instead of 400 doubled the step's latency for nothing (ai/research/benchmark.md). */
function cutStr(o, k, max, path, warnings) {
	if (o !== null && typeof o === "object" && typeof o[k] === "string" && o[k].length > max) {
		o[k] = `${o[k].slice(0, max - 1).trimEnd()}…`
		warnings.push(`${path}.${k} was cut to ${max} characters`)
	}
}
/** An edit's reply is under 40 words (edit.md); one over this many is tidied (tidyReply). */
export const EDIT_REPLY_WORDS = 45
const wordCount = (t) => String(t).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
/**
 * The chat reply as the user reads it (§13.9): whitespace collapsed, at most 2 sentences (more are cut, with a warning). With `words` (the
 * edit's reply): a two-sentence reply over that many words keeps its first sentence when that one says enough on its own (≥ 8 words: the
 * prompt puts what changed, or the answer, first); one that cannot be cut so is kept, with a warning. Never a repair.
 */
function tidyReply(o, path, warnings, max = 400, words = null) {
	if (!isObj(o) || typeof o.reply !== "string") return
	let t = o.reply.replace(/\s+/g, " ").trim()
	const sentences = t.split(/(?<=[.!?])\s+(?=["“(]?[A-ZÀ-Þ¿¡])/).map((x) => x.trim()).filter(Boolean)
	if (sentences.length > 2) {
		t = sentences.slice(0, 2).join(" ")
		warnings.push(`${path}.reply cut to its first 2 sentences`)
	}
	if (words && wordCount(t) > words) {
		const n = wordCount(t)
		if (sentences.length >= 2 && wordCount(sentences[0]) >= 8 && wordCount(sentences[0]) <= words) {
			t = sentences[0]
			warnings.push(`${path}.reply had ${n} words: cut to its first sentence`)
		} else warnings.push(`${path}.reply has ${n} words (keep it under ${words})`)
	}
	o.reply = t
	cutStr(o, "reply", max, path, warnings)
}
/**
 * The next-edit chips (§13.9), tidied, never repaired: a list of {label, prompt}; a plain string becomes both (its first 6 words the label);
 * a label longer than 6 words is cut to 6; empty, duplicate or malformed ones dropped; at most 3. Not a list: dropped.
 */
function tidySuggestions(o, path, warnings) {
	if (!isObj(o) || o.suggestions === undefined) return
	if (!Array.isArray(o.suggestions)) {
		warnings.push(`${path}.suggestions dropped: it must be a list of {label, prompt}`)
		delete o.suggestions
		return
	}
	const seen = new Set()
	const out = []
	for (const raw of o.suggestions) {
		let label
		let prompt
		if (typeof raw === "string") (prompt = raw), (label = raw)
		else if (isObj(raw)) (label = typeof raw.label === "string" ? raw.label : typeof raw.title === "string" ? raw.title : ""), (prompt = typeof raw.prompt === "string" ? raw.prompt : typeof raw.request === "string" ? raw.request : label)
		else continue
		label = String(label).replace(/\s+/g, " ").trim()
		prompt = String(prompt).replace(/\s+/g, " ").trim()
		if (!label || !prompt) continue
		const words = label.split(" ")
		if (words.length > 6) {
			// (cut to 6 words, never ending on a little word: "Make Ball 2 land in the" -> "Make Ball 2 land")
			const w = words.slice(0, 6)
			while (w.length > 2 && /^(the|a|an|in|into|on|onto|to|of|and|or|at|for|with|so|by|from|its|it|your)$/i.test(w.at(-1).replace(/[,;:.]$/, ""))) w.pop()
			label = w.join(" ").replace(/[,;:]$/, "")
		}
		if (label.length > 60) label = `${label.slice(0, 59).trimEnd()}…`
		if (prompt.length > 300) prompt = `${prompt.slice(0, 299).trimEnd()}…`
		const key = label.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push({ label, prompt })
	}
	if (out.length > 3) warnings.push(`${path}.suggestions cut to 3`)
	if (out.length !== o.suggestions.length) warnings.push(`${path}.suggestions tidied`)
	o.suggestions = out.slice(0, 3)
}
/** A goal without a label gets one from its kind and items ("ball lands in cup", "dominoes falls over"); a few spellings are read. */
function tidyGoals(goals, path, warnings) {
	if (!Array.isArray(goals)) return
	for (const [i, g] of goals.entries()) {
		if (!isObj(g)) continue
		const at = `${path}[${i}]`
		if (typeof g.kind === "string" && !GOAL_KINDS.includes(g.kind)) {
			const k = { inside: "in", into: "in", lands_in: "in", fall: "falls", topple: "falls", topples: "falls", tips: "falls", knock_over: "falls", hit: "hits", touches: "hits", reaches: "hits", move: "moves", travels: "moves" }[g.kind.toLowerCase().replace(/[\s-]+/g, "_")]
			if (k) {
				warnings.push(`${at}.kind "${g.kind}" read as "${k}"`)
				g.kind = k
			}
		}
		if (g.items === undefined && Array.isArray(g.ids)) {
			g.items = g.ids
			delete g.ids
			warnings.push(`${at}.ids read as items`)
		}
		if (Array.isArray(g.items) && g.items.length === 1 && g.item === undefined) {
			g.item = g.items[0]
			delete g.items
		}
		if ((g.label === undefined || g.label === "") && (typeof g.item === "string" || Array.isArray(g.items))) {
			g.label = goalLabel(g)
			warnings.push(`${at}.label was missing: "${g.label}"`)
		}
		cutStr(g, "label", 200, at, warnings)
	}
}
function tidyPlanText(plan, warnings, path = "plan") {
	if (!isObj(plan)) return
	tidyReply(plan, path, warnings)
	tidySuggestions(plan, path, warnings)
	cutStr(plan, "notes", 3000, path, warnings)
	if (Array.isArray(plan.items)) plan.items.forEach((it, i) => cutStr(it, "why", 400, `${path}.items[${i}]`, warnings))
	if (Array.isArray(plan.assumptions)) plan.assumptions.forEach((_, i) => cutStr(plan.assumptions, i, 300, `${path}.assumptions`, warnings))
	if (Array.isArray(plan.missing)) plan.missing.forEach((m, i) => (cutStr(m, "reason", 400, `${path}.missing[${i}]`, warnings), cutStr(m, "asked", 160, `${path}.missing[${i}]`, warnings)))
	if (Array.isArray(plan.tune)) plan.tune.forEach((k, i) => cutStr(k, "why", 300, `${path}.tune[${i}]`, warnings))
	if (Array.isArray(plan.differences)) plan.differences.forEach((_, i) => cutStr(plan.differences, i, 300, `${path}.differences`, warnings))
	if (Array.isArray(plan.covers))
		plan.covers.forEach((c, i) => {
			if (!isObj(c)) return
			if (c.ids === undefined && c.id !== undefined) {
				c.ids = c.id === null || c.id === "" ? [] : [c.id]
				delete c.id
			}
			if (typeof c.ids === "string") c.ids = [c.ids]
			if (c.ids === null) c.ids = []
			cutStr(c, "note", 300, `${path}.covers[${i}]`, warnings)
			cutStr(c, "label", 60, `${path}.covers[${i}]`, warnings)
		})
	tidyGoals(plan.goals, `${path}.goals`, warnings)
	if (plan.stages !== undefined) plan.stages = tidyStages(plan.stages, `${path}.stages`, warnings)
	if (plan.stages === undefined) delete plan.stages
}
const STAGE_FIELDS = ["label", "does", "items", "check", "tune"]
/**
 * A chain's stages, tidied so that they never cost a repair turn: not a list -> dropped; a stage that is not an object -> dropped; unknown
 * fields -> dropped; text cut to its limit; a missing label -> "Stage n"; the check's label -> the stage's; `ids` read as items; a check that
 * is not an object or knobs that are not a list -> dropped. Each with a warning. (The checks against the plan are checkStages'.)
 */
function tidyStages(stages, path, warnings) {
	if (stages === null) return undefined
	if (!Array.isArray(stages)) {
		warnings.push(`${path} dropped: it must be a list of stages`)
		return undefined
	}
	const out = []
	for (const [i, st] of stages.entries()) {
		const at = `${path}[${i}]`
		if (!isObj(st)) {
			warnings.push(`${at} dropped: a stage must be an object {label, does, items, check, tune}`)
			continue
		}
		if (st.items === undefined && Array.isArray(st.ids)) st.items = st.ids
		if (st.does === undefined && typeof st.expect === "string") st.does = st.expect
		for (const k of Object.keys(st)) if (!STAGE_FIELDS.includes(k)) {
			if (!["ids", "expect"].includes(k)) warnings.push(`${at}.${k} dropped (a stage has ${STAGE_FIELDS.join(", ")})`)
			delete st[k]
		}
		if (typeof st.label !== "string" || !st.label.trim()) st.label = typeof st.does === "string" && st.does.trim() ? st.does.trim().slice(0, 60) : `Stage ${out.length + 1}`
		cutStr(st, "label", 120, at, warnings)
		if (st.does !== undefined && typeof st.does !== "string") delete st.does
		cutStr(st, "does", 300, at, warnings)
		if (st.items !== undefined) st.items = Array.isArray(st.items) ? [...new Set(st.items.filter((x) => typeof x === "string" && x))].slice(0, 40) : []
		if (st.check !== undefined && !isObj(st.check)) {
			warnings.push(`${at}.check dropped: it must be a goal object {kind, item, ...}`)
			delete st.check
		}
		if (isObj(st.check)) {
			if (typeof st.check.label !== "string" || !st.check.label.trim()) st.check.label = `Stage ${out.length + 1}: ${st.label}`.slice(0, 200)
			const g = [st.check]
			tidyGoals(g, `${at}.check`, [])
			st.check = g[0]
			const errs = []
			checkSchema(stageCheckSchema, st.check, `${at}.check`, errs)
			if (errs.length) {
				warnings.push(`${at}.check dropped: ${errs[0]}`)
				delete st.check
			}
		}
		if (st.tune !== undefined) {
			if (!Array.isArray(st.tune)) {
				warnings.push(`${at}.tune dropped: it must be a list of knobs`)
				delete st.tune
			} else {
				st.tune = st.tune.filter(isObj)
				st.tune.forEach((k, j) => cutStr(k, "why", 300, `${at}.tune[${j}]`, warnings))
				st.tune = st.tune.filter((k, j) => {
					const errs = []
					checkSchema(tuneSchema, k, `${at}.tune[${j}]`, errs)
					if (errs.length) warnings.push(`${at}.tune[${j}] dropped: ${errs[0]}`)
					return !errs.length
				})
				if (st.tune.length > LIMITS.stageKnobs) {
					warnings.push(`${at}.tune cut to its first ${LIMITS.stageKnobs} knobs`)
					st.tune = st.tune.slice(0, LIMITS.stageKnobs)
				}
			}
		}
		out.push(st)
	}
	if (out.length > LIMITS.stages) {
		warnings.push(`${path} cut to its first ${LIMITS.stages} stages`)
		out.length = LIMITS.stages
	}
	return out
}
/**
 * A chain's stages against the plan (ids: the plan's items by id): an item id that is not in the plan is dropped from a stage's items; a
 * check that names a missing item or does not fit its kind (ai/goals.mjs; the same rules as the plan's goals) is dropped; a knob that does
 * not fit (the same rules as plan.tune) or that an earlier stage already has is dropped. Each with a warning. -> the stages kept.
 */
export function checkStages(stages, ids, catalog, warnings, path = "stages") {
	if (!Array.isArray(stages)) return stages
	const seenKnobs = new Set()
	return stages.map((st, i) => {
		if (!isObj(st)) return st
		const at = `${path}[${i}] (${st.label})`
		const out = { ...st }
		if (Array.isArray(st.items)) {
			const gone = st.items.filter((id) => !ids.has(id))
			if (gone.length) warnings.push(`${at}.items: ${gone.map((g) => `"${g}"`).join(", ")} dropped (not items of the plan)`)
			out.items = st.items.filter((id) => ids.has(id))
		}
		if (isObj(st.check)) {
			const errs = []
			const check = clone(st.check)
			checkGoals([check], `${at}.check`, ids, catalog, errs)
			if (errs.length) {
				warnings.push(`${at}.check dropped: ${errs[0].replace(/^.*?\): /, "")}`)
				delete out.check
			} else out.check = check
		}
		if (Array.isArray(st.tune)) {
			out.tune = st.tune.filter((k, j) => {
				const errs = []
				checkTune([k], `${at}.tune[${j}]`, ids, catalog, errs)
				const key = `${k.id}.${k.param}`
				if (!errs.length && seenKnobs.has(key)) errs.push(`the knob ${key} is already an earlier stage's`)
				if (errs.length) {
					warnings.push(`${at}.tune[${j}] dropped: ${errs[0].replace(/^.*?\): /, "")}`)
					return false
				}
				seenKnobs.add(key)
				return true
			})
		}
		return out
	})
}
function tidyPatchText(patches, warnings, path = "patches") {
	if (!Array.isArray(patches)) return
	for (const [i, p] of patches.entries()) {
		if (!isObj(p)) continue
		cutStr(p, "why", 300, `${path}[${i}]`, warnings)
		if (isObj(p.item)) cutStr(p.item, "why", 400, `${path}[${i}].item`, warnings)
		if (p.op === "set_goals") tidyGoals(p.goals, `${path}[${i}].goals`, warnings)
		if (p.op === "set_tune" && Array.isArray(p.tune)) p.tune.forEach((k, j) => cutStr(k, "why", 300, `${path}[${i}].tune[${j}]`, warnings))
		if (p.op === "set_stages") p.stages = tidyStages(p.stages, `${path}[${i}].stages`, warnings) ?? []
	}
}

// ---------------------------------------------------------------- plan
/** Normalise (unambiguous small fixes, each reported as a warning) and check a plan. ctx: {catalog, stage?, extraIds?} */
export function validatePlan(value, ctx = {}) {
	const errors = []
	const warnings = []
	const catalog = ctx.catalog
	if (!catalog?.types) throw new Error("validatePlan needs ctx.catalog (the catalog index)")
	if (!isObj(value)) return { ok: false, errors: ["the plan must be a JSON object"], warnings, value }
	const plan = clone(value)
	// defaults for empty lists the model may leave out
	for (const k of ["missing", "goals", "tune"]) if (plan[k] === undefined) plan[k] = []
	if (plan.notes === undefined) plan.notes = ""
	tidyPlanText(plan, warnings)
	if (Array.isArray(plan.items)) for (const [i, it] of plan.items.entries()) normaliseItem(it, `items[${i}]`, catalog, warnings)
	checkSchema(planSchema, plan, "plan", errors)
	// the semantic checks run even when the structure is off (as far as it lets them), so one repair can fix everything at once
	bestEffort(() => checkPlanSemantics(plan, ctx, errors, warnings), errors.length > 0)
	// "soft" problems: worth one repair turn, but a plan that still has them after it is used as it is (ai/core.mjs), so a check about
	// faithfulness never costs a build that works
	const soft = []
	bestEffort(() => checkCoverage(plan, ctx, soft, warnings), errors.length > 0)
	bestEffort(() => checkDepictedOutcome(plan, ctx, soft), errors.length > 0)
	return { ok: errors.length === 0, errors: dedupe(errors), soft: dedupe(soft), warnings, value: plan }
}

// ---------------------------------------------------------------- what a picture shows must be in the plan (bench 2026-10-15 review)
const normLabel = (s) => String(s ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
/** How many things an item stands for: a domino row its dominoes, a Newton's cradle its balls, anything else 1. */
export function unitsOfItem(it, catalog) {
	const k = MULTI_UNIT[it?.type]
	if (!k) return 1
	const v = it.props?.[k] ?? catalog?.types?.[it.type]?.props?.[k]?.default
	return Number.isFinite(v) ? Math.max(1, Math.round(v)) : 1
}
/**
 * With an observation (ctx.observation, a validated one): every observed object must be accounted for in plan.covers, by its exact label,
 * with the plan items that build it, or with ids [] and a note (it is in missing, part of another item, or scenery); an observed count must
 * be built (domino rows count their dominoes) unless a note says why not. The observed count and size are copied into each entry, so the
 * critic can compare them with what was built. Without an observation, covers is only tidied (ids that are no item are dropped).
 */
function checkCoverage(plan, ctx, errors, warnings) {
	const ids = new Map((Array.isArray(plan.items) ? plan.items : []).filter(isObj).map((it) => [it.id, it]))
	// the table and the solver's two safety walls are in every scene without being plan items: an observed table or end wall may name them
	const builtIn = (id) => id === "table" || id === "wall-left" || id === "wall-right"
	if (plan.covers !== undefined && !Array.isArray(plan.covers)) return
	const covers = (plan.covers ?? []).filter(isObj)
	const objs = (Array.isArray(ctx.observation?.objects) ? ctx.observation.objects : []).filter((o) => isObj(o) && typeof o.label === "string")
	if (!objs.length) {
		for (const c of covers) {
			if (!Array.isArray(c.ids)) continue
			const kept = c.ids.filter((id) => ids.has(id) || builtIn(id))
			if (kept.length !== c.ids.length) {
				warnings.push(`covers ("${c.label}"): ${c.ids.filter((id) => !ids.has(id) && !builtIn(id)).join(", ")} dropped (not items of the plan)`)
				c.ids = kept
			}
		}
		return
	}
	const byLabel = new Map()
	for (const c of covers) if (typeof c.label === "string") byLabel.set(normLabel(c.label), c)
	const missingText = (plan.missing ?? []).filter(isObj).map((m) => normLabel(`${m.asked ?? ""} ${m.reason ?? ""}`))
	const unaccounted = []
	const out = []
	for (const o of objs) {
		let c = byLabel.get(normLabel(o.label))
		if (!c) {
			// a near spelling ("launcher leg" for "launcher legs") is the same entry
			const hint = suggest(o.label, [...byLabel.keys()])
			if (hint && !objs.some((x) => normLabel(x.label) === hint)) c = byLabel.get(hint)
		}
		if (!c) {
			unaccounted.push(o)
			continue
		}
		byLabel.delete(normLabel(c.label))
		c.label = o.label
		if (Number.isInteger(o.count)) c.count = o.count
		if (isObj(o.est_size_m) && Number.isFinite(o.est_size_m.w) && Number.isFinite(o.est_size_m.h)) c.size_m = { w: o.est_size_m.w, h: o.est_size_m.h, ...(Number.isFinite(o.est_size_m.d) ? { d: o.est_size_m.d } : {}) }
		else delete c.size_m
		if (!Array.isArray(c.ids)) continue
		const at = `covers ("${o.label}")`
		for (const id of c.ids) if (!ids.has(id) && !builtIn(id)) errors.push(`${at}.ids: "${id}" is not an item of the plan${suggest(id, [...ids.keys()]) ? ` (did you mean "${suggest(id, [...ids.keys()])}"?)` : ""}`)
		const note = typeof c.note === "string" && c.note.trim() !== ""
		if (!c.ids.length && !note && !missingText.some((m) => m.includes(normLabel(o.label)) || normLabel(o.label).split(" ").filter((w) => w.length > 3).some((w) => m.includes(w))))
			errors.push(`${at}: nothing in the plan builds it. Build it from the catalog (and list its ids here), or keep ids [] and say in "note" why it is left out (it is in "missing", it is part of another item, or it is background scenery)`)
		if (c.ids.length && (o.count ?? 1) > 1) {
			const built = c.ids.filter((id) => ids.has(id)).reduce((n, id) => n + unitsOfItem(ids.get(id), ctx.catalog), 0)
			if (built !== o.count && !note) errors.push(`${at}: the pictures show ${o.count}; the plan builds ${built} (${c.ids.join(", ")}). Build all ${o.count} as separate items (or a group type of that count), or say in "note" why the number differs`)
		}
		out.push(c)
	}
	for (const c of byLabel.values()) warnings.push(`covers ("${c.label}") is not an object of the observation: left as it is`)
	plan.covers = [...out, ...byLabel.values()]
	if (unaccounted.length)
		errors.push(
			`covers: ${unaccounted.length === 1 ? "this object of the observation is" : "these objects of the observation are"} not accounted for: ${unaccounted.map((o) => `"${o.label}"${(o.count ?? 1) > 1 ? ` (×${o.count})` : ""}`).join(", ")}. For each, add {"label": <its label exactly>, "ids": [the plan items that build it]} to "covers" (and build it if it is not built yet); if it is not built, "ids": [] and a "note" saying why (in missing, part of another item, background scenery)`
		)
}

const WORK_RE = /\b(make (it|this|them|that|everything|the (machine|setup|thing|contraption)) work|(the way|as|like) (it|they|this|that)(['’]s| is| are| was| were)? (meant|supposed|intended|designed)|so (that )?(it|they) works?)\b/i
const VESSEL = "(cup|mug|glass|bucket|pail|basket|box|bin|pot|jar|bowl|container|crate|tray|tub|can|hoop|net|hole)s?"
// "drops into the cup", "lands in the bucket", "ends up inside the box": a landing whatever else the sentence says
const LANDS_RE = new RegExp(`\\b(lands?|landed|landing|drops?|dropped|dropping|falls?|fell|falling|ends? up|ended up|comes? to rest|came to rest|settles?|settled|is caught|caught|stays?|stayed)\\b[^.;]{0,60}?\\b(in|into|inside)\\b[^.;]{0,30}?\\b${VESSEL}\\b`, "i")
// "rolls into the cup", "goes in the bucket": a landing too, unless the sentence says it strikes the container ("rolls into the cup and shoves it")
const ENTERS_RE = new RegExp(`\\b(in|into|inside)\\b[^.;]{0,30}?\\b${VESSEL}\\b`, "i")
const STRIKES_RE = /\b(shoves?|shoved|push(es|ed)?|knocks?|knocked|hits?|strikes?|struck|bumps?|bumped|topples?|toppled|tips (it|over)|crash(es|ed)?|slams?|slammed|nudges?|nudged)\b/i
const LANDS_IT_RE = /\b(lands?|landed|drops?|dropped|falls?|fell|ends? up|ended up|settles?|settled|stays?|stayed)\b[^.;]{0,20}?\b(in|into|inside)\s+(it|them)\b/i
const VESSEL_RE = new RegExp(`\\b${VESSEL}\\b`, "i")
/** Does this step of a motion story end with something going into a container, as opposed to striking one ("crashes into the box", "rolls
 *  into the cup and shoves it")? "knocks the ball into the basket" and "hits the cup and falls into it" are landings. */
function intoVessel(t) {
	if (LANDS_RE.test(t) || (LANDS_IT_RE.test(t) && VESSEL_RE.test(t))) return true
	const m = ENTERS_RE.exec(t)
	if (!m || STRIKES_RE.test(t.slice(m.index + m[0].length))) return false
	return !/\b(crash(es|ed)?|slams?|slammed|bumps?|bumped|runs?|ran|smash(es|ed)?|rams?|rammed|hits?|knocks?|knocked|bangs?|banged)\s+((straight|right|hard|back|head-on|full)\s+)?$/i.test(t.slice(0, m.index))
}
/**
 * A picture asked to "make it work" (ctx.text) whose observation ends with something going into a container: that outcome must be a goal
 * ("in", with the thing and its container), so the critic and the tuner work for it (bench 2026-10-15: without it, half of these builds
 * left the ball beside the cup and were scored 8/10 "done").
 */
function checkDepictedOutcome(plan, ctx, errors) {
	const text = typeof ctx.text === "string" ? ctx.text : ""
	const story = Array.isArray(ctx.observation?.motion_story) ? ctx.observation.motion_story.filter((x) => typeof x === "string") : []
	if (!WORK_RE.test(text) || !story.length) return
	const last = story.slice(-2)
	if (!last.some(intoVessel)) return
	const end = last.join("; ")
	if ((plan.goals ?? []).some((g) => isObj(g) && goalKind(g) === "in")) return
	errors.push(
		`goals: the request says to make it work, and the pictures end with "${end.slice(0, 160)}": add that outcome as a goal ({"kind": "in", "item": the thing, "container": its box, cup, bucket or basket}) with tune knobs, make the smallest change that achieves it (raise a ramp's end, move or widen the target), and say what you changed under "differences"`
	)
}

function normaliseItem(it, path, catalog, warnings) {
	if (!isObj(it)) return
	const t = normTypeKey(it.type, catalog)
	if (t !== it.type) {
		warnings.push(`${path}.type "${it.type}" read as "${t}"`)
		it.type = t
	}
	const p = it.place
	// (bench 2026-10-15: angle_deg written on the item instead of in its place)
	if (it.angle_deg !== undefined && isObj(p) && p.angle_deg === undefined && p.lean === undefined) {
		p.angle_deg = it.angle_deg
		delete it.angle_deg
		warnings.push(`${path}.angle_deg moved into place.angle_deg`)
	}
	if (isObj(p)) {
		if (p.lean !== undefined && p.on === undefined) p.on = "air" // a leaning item is placed by its two ends
		if (p.angle !== undefined && p.angle_deg === undefined) {
			p.angle_deg = p.angle
			delete p.angle
			warnings.push(`${path}.place.angle read as angle_deg`)
		}
		for (const rel of ["left_of", "right_of"]) {
			const r = p[rel]
			if (typeof r === "string") {
				p[rel] = { id: r, gap_m: 0 }
				warnings.push(`${path}.place.${rel} "${r}" read as {id: "${r}", gap_m: 0}`)
			} else if (isObj(r) && r.align !== undefined) {
				if (p.align === undefined) p.align = r.align
				delete r.align
				warnings.push(`${path}.place.${rel}.align moved to place.align`)
			}
		}
		if (p.inside !== undefined && p.on === undefined) {
			p.on = p.inside
			warnings.push(`${path}.place.on set to its container "${p.inside}"`)
		}
		// (bench 2026-10-15: "y" for an item in the air, where y_m is meant; the lean ends' own "y" is a different field and stays)
		if (p.on === "air" && p.lean === undefined && p.y !== undefined && p.y_m === undefined) {
			p.y_m = p.y
			delete p.y
			warnings.push(`${path}.place.y read as y_m`)
		}
		if (typeof p.x === "string" && p.x.trim() !== "" && Number.isFinite(Number(p.x))) p.x = Number(p.x)
		if (typeof p.y_m === "string" && p.y_m.trim() !== "" && Number.isFinite(Number(p.y_m))) p.y_m = Number(p.y_m)
	}
	if (isObj(it.props)) {
		const T = catalog.types[it.type]
		for (const [k, v] of Object.entries(it.props)) {
			const spec = T?.props[k]
			if (spec && (spec.kind === "number" || spec.kind === "int") && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
				it.props[k] = Number(v)
				warnings.push(`${path}.props.${k} "${v}" read as a number`)
			}
			if (spec?.kind === "bool" && (v === "true" || v === "false")) it.props[k] = v === "true"
		}
	}
}

/** Run semantic checks; when the structure already failed, skip whatever they cannot read instead of failing. */
function bestEffort(fn, structureFailed) {
	try {
		fn()
	} catch (e) {
		if (!structureFailed) throw e
	}
}
const dedupe = (list) => [...new Set(list)]

function checkPlanSemantics(plan, ctx, errors, warnings) {
	const catalog = ctx.catalog
	const stage = isObj(plan.stage) && [plan.stage.x0, plan.stage.x1, plan.stage.y0, plan.stage.y1].every(Number.isFinite) ? plan.stage : stageOf(ctx)
	if (!Array.isArray(plan.items)) return
	plan.items = plan.items.filter(isObj)
	for (const k of ["missing", "goals", "tune"]) if (!Array.isArray(plan[k])) plan[k] = []
	plan.missing = plan.missing.filter(isObj)
	plan.goals = plan.goals.filter(isObj)
	plan.tune = plan.tune.filter(isObj)
	const ids = new Map()
	// ids and types
	for (const [i, it] of plan.items.entries()) {
		const path = `items[${i}] (${it.id})`
		if (typeof it.id !== "string" || typeof it.type !== "string") continue
		if (!ID_RE.test(it.id)) errors.push(`${path}: id must be 1 to 40 letters, digits, "-" or "_", starting with a letter or digit`)
		if (RESERVED_IDS.includes(it.id)) errors.push(`${path}: "${it.id}" is reserved (it names the table top / mid-air); choose another id`)
		if (ids.has(it.id)) errors.push(`${path}: the id "${it.id}" is used twice; ids must be unique`)
		ids.set(it.id, it)
		if (!catalog.types[it.type]) {
			const hint = suggest(it.type, Object.keys(catalog.types))
			errors.push(`${path}: type "${it.type}" is not in the catalog${hint ? ` (did you mean "${hint}"?)` : ""}; use a catalog key, and list anything the library lacks under "missing"`)
		} else if (it.type === "table") errors.push(`${path}: the table is already in every scene (id "table"); remove this item (use plan.table.props to change the table)`)
	}
	if (plan.table?.props) plan.table.props = checkProps(plan.table.props, "table", catalog, "plan.table.props", errors)
	const known = new Set([...ids.keys(), ...(ctx.extraIds ?? [])])
	// props, flags, placement
	for (const [i, it] of plan.items.entries()) {
		const path = `items[${i}] (${it.id})`
		const T = catalog.types[it.type]
		if (!T) continue
		it.props = checkProps(it.props, it.type, catalog, `${path}.props`, errors)
		if (!isObj(it.place)) continue
		if (it.held && it.fixed) errors.push(`${path}: held and fixed are both true; held lets go at the release, fixed never moves: choose one`)
		if (!T.dynamic) {
			for (const f of ["held", "fixed"])
				if (it[f]) {
					delete it[f]
					warnings.push(`${path}: ${f} dropped (a ${it.type} is static: it never moves anyway)`)
				}
		}
		checkPlace(it.place, `${path}.place`, it, ids, known, catalog, stage, errors)
	}
	// support graph: each item is placed after what it rests on, leans on or is spaced from
	const deps = new Map(plan.items.map((it) => [it.id, placeRefs(it.place).filter((r) => ids.has(r))]))
	const state = new Map()
	const cycle = []
	const visit = (id, trail) => {
		if (state.get(id) === 2) return
		if (state.get(id) === 1) {
			cycle.push([...trail.slice(trail.indexOf(id)), id].join(" → "))
			return
		}
		state.set(id, 1)
		for (const d of deps.get(id) ?? []) visit(d, [...trail, id])
		state.set(id, 2)
	}
	for (const id of deps.keys()) visit(id, [])
	for (const c of cycle.slice(0, 3)) errors.push(`placement references go round in a circle (${c}); each item may only refer to items placed before it`)
	// missing
	for (const [i, m] of plan.missing.entries()) {
		if (typeof m.substitute_type === "string" && !catalog.types[m.substitute_type]) {
			const hint = suggest(m.substitute_type, Object.keys(catalog.types))
			errors.push(`missing[${i}] (${m.asked}): substitute_type "${m.substitute_type}" is not in the catalog${hint ? ` (did you mean "${hint}"?)` : ""}; use a catalog key or null`)
		}
		if (m.substitute_id != null) {
			const s = ids.get(m.substitute_id)
			if (!s) errors.push(`missing[${i}] (${m.asked}): substitute_id "${m.substitute_id}" is not an item of the plan`)
			else if (m.substitute_type && s.type !== m.substitute_type) errors.push(`missing[${i}] (${m.asked}): item "${m.substitute_id}" is a ${s.type}, not the substitute_type ${m.substitute_type}`)
		}
	}
	checkGoals(plan.goals, "goals", ids, catalog, errors)
	checkTune(plan.tune, "tune", ids, catalog, errors)
	if (Array.isArray(plan.stages)) {
		plan.stages = checkStages(plan.stages, ids, catalog, warnings)
		// every stage knob is also one of the plan's knobs, so a tuner that does not know stages tunes it too (stages[].tune says whose it is)
		const have = new Set(plan.tune.map((k) => `${k.id}.${k.param}`))
		for (const st of plan.stages)
			for (const k of isObj(st) && Array.isArray(st.tune) ? st.tune : [])
				if (!have.has(`${k.id}.${k.param}`) && plan.tune.length < LIMITS.tune) {
					have.add(`${k.id}.${k.param}`)
					plan.tune.push(clone(k))
				}
	}
	if (plan.release !== undefined && plan.release > plan.seconds) errors.push(`release (${plan.release} s) is after the end of the run (seconds ${plan.seconds}); held items would never let go`)
	if (plan.stage && (plan.stage.x1 - plan.stage.x0 < 0.5 || plan.stage.y1 - plan.stage.y0 < 0.5)) errors.push("stage must be at least 0.5 m wide and tall (x1 > x0, y1 > y0)")
	if (plan.items.length > 0 && plan.items.every((it) => catalog.types[it.type] && !catalog.types[it.type].dynamic))
		warnings.push("nothing in the plan can move (every item is static)")
}

/** Ids an item's place refers to. */
export function placeRefs(p) {
	if (!isObj(p)) return []
	const r = []
	if (typeof p.on === "string") r.push(p.on)
	if (p.inside) r.push(p.inside)
	if (p.left_of?.id) r.push(p.left_of.id)
	if (p.right_of?.id) r.push(p.right_of.id)
	if (p.lean) for (const e of [p.lean.from, p.lean.to]) if (e?.on) r.push(e.on)
	return r.filter((x) => !RESERVED_IDS.includes(x))
}

function checkPlace(p, path, it, ids, known, catalog, stage, errors) {
	const ref = (id, what) => {
		if (id === it.id) return void errors.push(`${path}.${what} refers to the item itself`)
		if (!RESERVED_IDS.includes(id) && !known.has(id)) {
			const hint = suggest(id, [...known])
			errors.push(`${path}.${what} "${id}" is not an item of the plan${hint ? ` (did you mean "${hint}"?)` : ""}`)
		}
	}
	const xr = [stage.x0 - STAGE_SLACK, stage.x1 + STAGE_SLACK]
	const yr = [stage.y0 - STAGE_SLACK, stage.y1 + STAGE_SLACK]
	const inX = (x, what) => {
		if (x < xr[0] || x > xr[1]) errors.push(`${path}.${what} = ${x} m is outside the stage (x ${stage.x0}…${stage.x1}); keep things on the stage`)
	}
	const inY = (y, what) => {
		if (y < yr[0] || y > yr[1]) errors.push(`${path}.${what} = ${y} m is outside the stage (y ${stage.y0}…${stage.y1}; the table top is y = 0)`)
	}
	if (p.on !== "table" && p.on !== "air") ref(p.on, "on")
	if (p.x !== undefined) inX(p.x, "x")
	if (p.left_of && p.right_of) errors.push(`${path}: give left_of or right_of, not both`)
	for (const rel of ["left_of", "right_of"]) if (p[rel]) ref(p[rel].id, `${rel}.id`)
	if (p.x !== undefined && (p.left_of || p.right_of)) errors.push(`${path}: give either x or ${p.left_of ? "left_of" : "right_of"}, not both (one horizontal position)`)
	if (p.on === "air") {
		if (p.y_m === undefined && !p.lean) errors.push(`${path}: an item in the air needs y_m (its anchor's height above the table top, m)`)
	} else if (p.y_m !== undefined) errors.push(`${path}.y_m is only for items placed on "air" (this one rests on "${p.on}": the solver works out its height)`)
	if (p.y_m !== undefined) inY(p.y_m, "y_m")
	if (p.inside !== undefined) {
		ref(p.inside, "inside")
		const c = ids.get(p.inside)
		if (c && catalog.types[c.type] && !catalog.types[c.type].container) errors.push(`${path}.inside "${p.inside}" is a ${c.type}, not a container`)
		if (p.on !== p.inside) errors.push(`${path}: an item inside "${p.inside}" rests on it: set on to "${p.inside}" too`)
	}
	if (p.lean && (!isObj(p.lean.from) || !isObj(p.lean.to))) return
	if (p.lean) {
		if (p.x !== undefined || p.left_of || p.right_of || p.angle_deg !== undefined)
			errors.push(`${path}: lean sets the position and angle from its two ends; leave out x, left_of, right_of and angle_deg`)
		for (const end of ["from", "to"]) {
			const e = p.lean[end]
			if (e.on !== "table" && e.on !== "air") ref(e.on, `lean.${end}.on`)
			inX(e.x, `lean.${end}.x`)
			if (e.on === "air" && e.y === undefined) errors.push(`${path}.lean.${end}: an end in the air needs y (its height, m)`)
			if (e.on !== "air" && e.y !== undefined) errors.push(`${path}.lean.${end}.y is only for an end in the air (this end rests on "${e.on}")`)
			if (e.y !== undefined) inY(e.y, `lean.${end}.y`)
		}
		if (Math.abs(p.lean.from.x - p.lean.to.x) < 0.01) errors.push(`${path}.lean: the two ends are at the same x; a lean needs them apart`)
	} else if ((p.on === "table" || p.on === "air") && p.x === undefined && !p.left_of && !p.right_of)
		errors.push(`${path}: say where along the table it goes: x, left_of or right_of`)
	if (p.align && !p.left_of && !p.right_of) delete p.align // nothing to align with: harmless
}

/**
 * Goals, by kind (ai/goals.mjs): "in" {item, container: a box, cup, bucket or basket}, "falls" {item | items: things that can tip over},
 * "hits" {item, target, before_s?}, "moves" {item, min_m}. The kind is read from the fields when it is left out (a container: "in").
 */
function checkGoals(goals, path, ids, catalog, errors) {
	const ref = (at, id, what) => {
		if (ids.has(id)) return ids.get(id)
		const hint = typeof id === "string" ? suggest(id, [...ids.keys()]) : null
		errors.push(`${at}: ${what} "${id}" is not an item of the plan${hint ? ` (did you mean "${hint}"?)` : ""}`)
		return null
	}
	const mover = (at, it, id) => {
		const T = it && catalog.types[it.type]
		if (T && !T.dynamic) errors.push(`${at}: "${id}" is a ${it.type}, which never moves`)
		if (it?.fixed) errors.push(`${at}: "${id}" is fixed, so it never moves`)
		return T
	}
	for (const [i, g] of goals.entries()) {
		const at = `${path}[${i}] (${g.label})`
		const named = g.kind !== undefined || g.container !== undefined || g.target !== undefined || g.min_m !== undefined || g.items !== undefined
		if (!named) {
			errors.push(`${at}: say what kind of goal it is: "in" (with a container), "falls", "hits" (with a target) or "moves" (with min_m)`)
			continue
		}
		const kind = goalKind(g)
		g.kind = kind
		const fieldsOf = { in: ["item", "container"], falls: ["item", "items"], hits: ["item", "target", "before_s"], moves: ["item", "min_m"] }[kind]
		for (const f of ["item", "items", "container", "target", "before_s", "min_m"]) if (g[f] !== undefined && !fieldsOf.includes(f)) errors.push(`${at}: a "${kind}" goal has no ${f} (its fields: ${fieldsOf.join(", ")})`)
		if (kind === "in") {
			if (g.item === undefined || g.container === undefined) {
				errors.push(`${at}: an "in" goal needs item and container`)
				continue
			}
			const item = ref(at, g.item, "item")
			const cont = ref(at, g.container, "container")
			if (g.item === g.container) errors.push(`${at}: an item cannot land in itself`)
			if (cont && !GOAL_CONTAINERS.includes(cont.type))
				errors.push(`${at}: "${g.container}" is a ${cont.type}; an "in" goal can only be checked for a ${GOAL_CONTAINERS.join(", ")} (use one of those types as the target)`)
			mover(at, item, g.item)
		} else if (kind === "falls") {
			const list = goalItems(g)
			if (!list.length) errors.push(`${at}: a "falls" goal needs item (one thing) or items (all of them must fall)`)
			if (g.item !== undefined && g.items !== undefined) errors.push(`${at}: give item or items, not both`)
			if (new Set(list).size !== list.length) errors.push(`${at}: items lists the same id twice`)
			for (const id of list) {
				const it = ref(at, id, "item")
				const T = mover(at, it, id)
				if (!T) continue
				if (T.category === "Balls") errors.push(`${at}: "${id}" is a ball: it rolls rather than tips over; use a "moves" or "hits" goal for it`)
				else if (T.pinned) errors.push(`${at}: "${id}" (${it.type}) turns on a fixed pivot or hangs, so it cannot fall over; use a "hits" or "moves" goal`)
			}
		} else if (kind === "hits") {
			if (g.item === undefined || g.target === undefined) {
				errors.push(`${at}: a "hits" goal needs item (what moves) and target (what it must touch)`)
				continue
			}
			mover(at, ref(at, g.item, "item"), g.item)
			ref(at, g.target, "target")
			if (g.item === g.target) errors.push(`${at}: an item cannot hit itself`)
		} else if (kind === "moves") {
			if (g.item === undefined || g.min_m === undefined) {
				errors.push(`${at}: a "moves" goal needs item and min_m (how far it must end from where it starts, m)`)
				continue
			}
			mover(at, ref(at, g.item, "item"), g.item)
		}
	}
}

const PLACE_PARAMS = ["x", "y", "angle"]
function checkTune(tune, path, ids, catalog, errors) {
	const seen = new Set()
	for (const [i, k] of tune.entries()) {
		const at = `${path}[${i}] (${k.id}.${k.param})`
		const it = ids.get(k.id)
		if (!it) {
			errors.push(`${at}: "${k.id}" is not an item of the plan`)
			continue
		}
		if (seen.has(`${k.id}.${k.param}`)) errors.push(`${at}: the same knob is listed twice`)
		seen.add(`${k.id}.${k.param}`)
		if (!(k.min < k.max)) errors.push(`${at}: min (${k.min}) must be below max (${k.max})`)
		if (PLACE_PARAMS.includes(k.param)) continue
		const spec = catalog.types[it.type]?.props[k.param]
		if (!spec) {
			const T = catalog.types[it.type]
			const hint = T ? suggest(k.param, [...PLACE_PARAMS, ...Object.keys(T.props)]) : null
			errors.push(`${at}: param must be x, y, angle or a number prop of ${it.type}${hint ? ` (did you mean "${hint}"?)` : ""}`)
			continue
		}
		if (spec.kind !== "number" && spec.kind !== "int") {
			errors.push(`${at}: ${k.param} is a ${spec.kind} prop; only number props can be tuned`)
			continue
		}
		if (spec.min !== undefined && k.min < spec.min - 1e-9) errors.push(`${at}: min ${k.min} is below the prop's minimum ${spec.min}`)
		if (spec.max !== undefined && k.max > spec.max + 1e-9) errors.push(`${at}: max ${k.max} is above the prop's maximum ${spec.max}`)
	}
}

// ---------------------------------------------------------------- patches
/** Check patches against a plan by applying them in order; ctx: {catalog, stage?}. Returns {errors, warnings, patches (normalised), plan (the result)} */
export function checkPatches(patches, basePlan, ctx, path = "patches") {
	const errors = []
	const warnings = []
	const catalog = ctx.catalog
	if (!Array.isArray(patches)) return { errors: [`${path} must be a list`], warnings, patches, plan: basePlan }
	const out = []
	let plan = clone(basePlan) ?? { title: "Scene", seconds: 4.5, items: [], missing: [], goals: [], tune: [], notes: "" }
	for (const k of ["missing", "goals", "tune"]) if (!Array.isArray(plan[k])) plan[k] = []
	const before = errors.length
	for (const [i, raw] of patches.entries()) {
		const at = `${path}[${i}]`
		if (!isObj(raw) || typeof raw.op !== "string") {
			errors.push(`${at} must be an object with an "op" (one of ${PATCH_OPS.join(", ")})`)
			continue
		}
		const p = clone(raw)
		if (!PATCH_FIELDS[p.op]) {
			const hint = suggest(p.op, PATCH_OPS)
			errors.push(`${at}.op "${p.op}" is not a patch op${hint ? ` (did you mean "${hint}"?)` : ""}; ops: ${PATCH_OPS.join(", ")}`)
			continue
		}
		if (p.op === "add" && isObj(p.item)) normaliseItem(p.item, `${at}.item`, catalog, warnings)
		if (p.op === "set_place" && isObj(p.place)) normaliseItem({ place: p.place }, at, catalog, warnings)
		if (p.op === "replace_type") p.type = normTypeKey(p.type, catalog)
		if (p.op === "set_goals") tidyGoals(p.goals, `${at}.goals`, warnings)
		const errs = []
		checkSchema(patchSchemas[p.op], p, at, errs)
		if (errs.length) {
			errors.push(...errs)
			continue
		}
		if (p.op === "move" || p.op === "set_props") {
			// one change for several items: `ids` (expanded into one patch per item, each checked as if it had been sent alone)
			if (p.id !== undefined && p.ids !== undefined) {
				errors.push(`${at}: give id (one item) or ids (several), not both`)
				continue
			}
			if (p.id === undefined && p.ids === undefined) {
				errors.push(`${at} (${p.op}): needs id (or ids for the same change to several items)`)
				continue
			}
			if (p.ids !== undefined) {
				if (new Set(p.ids).size !== p.ids.length) warnings.push(`${at}.ids lists an id twice: once is enough`)
				const one = [...new Set(p.ids)].map((id) => ({ ...Object.fromEntries(Object.entries(clone(p)).filter(([k]) => k !== "ids")), id }))
				const r = checkPatches(one, plan, { ...ctx, _inner: true }, `${at}.ids`)
				if (r.errors.length) {
					errors.push(...r.errors)
					continue
				}
				warnings.push(...r.warnings)
				plan = r.plan
				out.push(...r.patches)
				continue
			}
		}
		const ids = new Map(plan.items.map((it) => [it.id, it]))
		const target = p.id !== undefined ? ids.get(p.id) : undefined
		if (p.op === "set_stages") p.stages = checkStages(p.stages, ids, catalog, warnings, `${at}.stages`)
		if (p.op !== "add" && p.op !== "set_scene" && p.op !== "set_goals" && p.op !== "set_tune" && p.op !== "set_stages" && !target) {
			const hint = suggest(p.id, [...ids.keys()])
			errors.push(`${at} (${p.op}): "${p.id}" is not an item of the scene${hint ? ` (did you mean "${hint}"?)` : ""}`)
			continue
		}
		const n = errors.length
		switch (p.op) {
			case "move": {
				if (p.x !== undefined && p.dx !== undefined) errors.push(`${at}: give x or dx, not both`)
				if (p.y_m !== undefined && p.dy !== undefined) errors.push(`${at}: give y_m or dy, not both`)
				if ([p.x, p.dx, p.y_m, p.dy, p.angle_deg].every((v) => v === undefined)) errors.push(`${at}: a move needs x, dx, y_m, dy or angle_deg`)
				const pl = target.place ?? {}
				if ((p.y_m !== undefined || p.dy !== undefined) && pl.on !== "air")
					errors.push(`${at}: "${p.id}" rests on "${pl.on}"; only an item in the air moves up or down (use set_place to put it on something else, or on "air" with y_m)`)
				if ((p.x !== undefined || p.dx !== undefined) && pl.lean) errors.push(`${at}: "${p.id}" is placed by lean; change its ends with set_place`)
				if (p.dx !== undefined && pl.x === undefined && !pl.left_of && !pl.right_of && !pl.lean)
					errors.push(`${at}: "${p.id}" has no x of its own (it sits in the middle of "${pl.on}"): give x (where its anchor goes) instead of dx`)
				break
			}
			case "set_props":
				p.props = checkProps(p.props, target.type, catalog, `${at}.props`, errors, { allowNull: true })
				break
			case "replace_type":
				if (!catalog.types[p.type]) {
					const hint = suggest(p.type, Object.keys(catalog.types))
					errors.push(`${at}: type "${p.type}" is not in the catalog${hint ? ` (did you mean "${hint}"?)` : ""}`)
				} else if (p.type === "table") errors.push(`${at}: the table cannot be added`)
				else {
					p.props = checkProps(p.props, p.type, catalog, `${at}.props`, errors)
					// a prop the old kind had and the new one shares, at a value outside the new kind's range (a 10 cm toy car's length for a
					// truck), would make the swap invalid and cost a repair turn: the patch sets it to the new kind's default instead, so every
					// client's applyPatches (which keeps shared props) gets a value the new kind takes
					const T = catalog.types[p.type]
					for (const [k, v] of Object.entries(isObj(target.props) ? target.props : {})) {
						const spec = T.props[k]
						if (!spec || p.props[k] !== undefined || v === null || !checkProp(spec, v, k)[1]) continue
						// (its default; without one, a number is clamped into the range)
						const clamp = (n) => Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, spec.kind === "int" ? Math.round(n) : n))
						const x = spec.default !== undefined && !checkProp(spec, spec.default, k)[1] ? spec.default : typeof v === "number" && Number.isFinite(v) ? clamp(v) : undefined
						if (x === undefined || checkProp(spec, x, k)[1]) continue
						p.props[k] = x
						warnings.push(`${at}: the ${target.type}'s ${k} ${short(v)} is outside a ${p.type}'s range, so it is set to ${short(x)}`)
					}
				}
				break
			case "add":
				if (ids.has(p.item.id)) errors.push(`${at}: an item "${p.item.id}" already exists; give the new one another id`)
				break
			case "set_item":
				if (p.held && p.fixed) errors.push(`${at}: held and fixed cannot both be true`)
				break
		}
		if (errors.length > n) continue
		plan = applyPatch(plan, p, catalog)
		out.push(p)
	}
	if (errors.length === before && !ctx._inner) {
		// the result must be a sound plan: references, props, goals, knobs. Problems the plan already had before the patches are not the
		// patches' fault (a hand-made scene may hold an item off the stage): only new ones count.
		const norm = (e) => e.replace(/items\[\d+\] /g, "")
		const had = new Set(validatePlan(basePlan ?? plan, { ...ctx, extraIds: [] }).errors.map(norm))
		const r = validatePlan(plan, { ...ctx, extraIds: [] })
		for (const e of r.errors) if (!had.has(norm(e))) errors.push(`after the patches, ${e}`)
		warnings.push(...r.warnings.filter((w) => !/dropped|read as/.test(w)))
		if (r.ok) plan = r.value
	}
	return { errors, warnings, patches: out, plan }
}

/** One patch applied to a plan (returns a new plan; the patch is assumed checked). */
export function applyPatch(plan, p, catalog) {
	const P = clone(plan)
	const it = p.id !== undefined ? P.items.find((x) => x.id === p.id) : undefined
	switch (p.op) {
		case "move": {
			const pl = (it.place ??= { on: "air" })
			if (p.x !== undefined) {
				pl.x = p.x
				delete pl.left_of
				delete pl.right_of
			}
			if (p.dx !== undefined) {
				if (pl.x !== undefined) pl.x += p.dx
				else if (pl.left_of) pl.left_of.gap_m = Math.max(0, (pl.left_of.gap_m ?? 0) - p.dx)
				else if (pl.right_of) pl.right_of.gap_m = Math.max(0, (pl.right_of.gap_m ?? 0) + p.dx)
			}
			if (p.y_m !== undefined) pl.y_m = p.y_m
			if (p.dy !== undefined) pl.y_m = (pl.y_m ?? 0) + p.dy
			if (p.angle_deg !== undefined) pl.angle_deg = p.angle_deg
			break
		}
		case "set_props": {
			const props = { ...(it.props ?? {}) }
			for (const [k, v] of Object.entries(p.props)) {
				if (v === null) delete props[k]
				else props[k] = v
			}
			it.props = props
			break
		}
		case "add":
			P.items.push(clone(p.item))
			break
		case "remove":
			P.items = P.items.filter((x) => x.id !== p.id)
			P.goals = (P.goals ?? [])
				.map((g) => (Array.isArray(g.items) && g.items.includes(p.id) ? { ...g, items: g.items.filter((x) => x !== p.id) } : g))
				.filter((g) => g.item !== p.id && g.container !== p.id && g.target !== p.id && !(Array.isArray(g.items) && !g.items.length))
			P.tune = (P.tune ?? []).filter((k) => k.id !== p.id)
			if (Array.isArray(P.covers)) for (const c of P.covers) if (Array.isArray(c?.ids)) c.ids = c.ids.filter((x) => x !== p.id)
			if (Array.isArray(P.stages))
				P.stages = P.stages.map((st) => {
					if (!isObj(st)) return st
					const o = { ...st }
					if (Array.isArray(o.items)) o.items = o.items.filter((x) => x !== p.id)
					if (Array.isArray(o.tune)) o.tune = o.tune.filter((k) => k.id !== p.id)
					if (isObj(o.check)) {
						const g = o.check
						const its = Array.isArray(g.items) ? g.items.filter((x) => x !== p.id) : null
						if (g.item === p.id || g.container === p.id || g.target === p.id || (its && !its.length)) delete o.check
						else if (its) o.check = { ...g, items: its }
					}
					return o
				})
			break
		case "replace_type": {
			it.type = p.type
			const T = catalog?.types[p.type]
			// (props the new kind shares, at values it takes: one outside its range is left at its default)
			const kept = Object.fromEntries(Object.entries(it.props ?? {}).filter(([k, v]) => T?.props[k] && (v === null || !checkProp(T.props[k], v, k)[1])))
			it.props = { ...kept, ...(p.props ?? {}) }
			if (T && !T.dynamic) {
				delete it.held
				delete it.fixed
			}
			// (its knobs on a prop the new kind shares are cut to the new kind's range; one with nothing left of its range goes)
			const fit = (k) => {
				const spec = k.id === p.id ? T?.props[k.param] : null
				if (!spec || !isObj(k) || typeof k.min !== "number" || typeof k.max !== "number") return k
				const lo = Math.max(k.min, spec.min ?? -Infinity)
				const hi = Math.min(k.max, spec.max ?? Infinity)
				return lo === k.min && hi === k.max ? k : lo < hi ? { ...k, min: lo, max: hi } : null
			}
			const keeps = (k) => k.id !== p.id || ["x", "y", "angle"].includes(k.param) || T?.props[k.param]
			const knobs = (ks) => ks.filter(keeps).map(fit).filter(Boolean)
			P.tune = knobs(P.tune ?? [])
			if (Array.isArray(P.stages)) P.stages = P.stages.map((st) => (isObj(st) && Array.isArray(st.tune) ? { ...st, tune: knobs(st.tune) } : st))
			break
		}
		case "set_place":
			it.place = clone(p.place)
			break
		case "set_item":
			for (const k of ["name", "held", "fixed"]) if (p[k] !== undefined) it[k] = p[k]
			if (it.held === false) delete it.held
			if (it.fixed === false) delete it.fixed
			break
		case "set_scene":
			for (const k of ["seconds", "release", "title"]) if (p[k] !== undefined) P[k] = p[k]
			break
		case "set_goals":
			P.goals = clone(p.goals)
			break
		case "set_tune":
			P.tune = clone(p.tune)
			break
		case "set_stages":
			if (Array.isArray(p.stages) && p.stages.length) P.stages = clone(p.stages)
			else delete P.stages
			break
	}
	return P
}

/** A move or set_props with `ids` as one patch per item (any other patch as it is). */
export const expandIds = (p) => (isObj(p) && Array.isArray(p.ids) && (p.op === "move" || p.op === "set_props") ? p.ids.map((id) => ({ ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== "ids")), id })) : [p])

/** Patches applied in order to a plan (a new plan). */
export function applyPatches(plan, patches, catalog) {
	return patches.flatMap(expandIds).reduce((P, p) => applyPatch(P, p, catalog), clone(plan))
}

/** A scene as an exact plan: every item stays where it is (place on "air" at its anchor's x, y and angle), for edits of a scene that has no plan. */
export function planFromScene(scene, catalog = null) {
	const items = (scene?.items ?? [])
		.filter((i) => i && i.type !== "table" && typeof i.id === "string" && (!catalog || catalog.types[i.type]))
		.map((i) => {
			const it = { id: i.id, type: i.type, place: { on: "air", x: Number(i.x) || 0, y_m: Number(i.y) || 0, angle_deg: Number(i.angle) || 0 } }
			if (i.name) it.name = String(i.name).slice(0, 80)
			let props = isObj(i.props) ? clone(i.props) : {}
			if (catalog) props = Object.fromEntries(Object.entries(props).filter(([k, v]) => catalog.types[i.type].props[k] && v !== null)) // a prop the type reads but does not list (a ball's colour) is the scene's business
			if (Object.keys(props).length) it.props = props
			if (i.held) it.held = true
			if (i.fixed) it.fixed = true
			return it
		})
	const plan = {
		title: String(scene?.name || "Scene").slice(0, 80),
		seconds: Number(scene?.seconds) || 4.5,
		release: Number.isFinite(Number(scene?.release)) ? Number(scene.release) : 0.5,
		items,
		missing: [],
		goals: (scene?.goals ?? [])
			.filter((g) => g && (g.item || Array.isArray(g.items)) && (goalKind(g) !== "in" || g.container))
			.map((g) => {
				const o = { kind: goalKind(g), label: String(g.label || goalLabel(g)).slice(0, 200) }
				for (const f of ["item", "items", "container", "target", "before_s", "min_m"]) if (g[f] !== undefined && g[f] !== null) o[f] = clone(g[f])
				return o
			}),
		tune: [],
		notes: ""
	}
	if (scene?.stage) plan.stage = clone(scene.stage)
	const table = scene?.items?.find((i) => i?.type === "table")
	if (table?.props && Object.keys(table.props).length) plan.table = { props: clone(table.props) }
	return plan
}

// ---------------------------------------------------------------- observation
const ENVIRONMENT = ["table", "floor", "ground", "desk", "shelf", "wall", "ceiling", "hand", "counter", "air"]
/** Soft problems (ai/core.mjs: one repair turn, then accepted with them as warnings) of a validation, [] when it has none. */
export const softOf = (r) => (Array.isArray(r?.soft) ? r.soft : [])
export function validateObservation(value, ctx = {}) {
	const errors = []
	const warnings = []
	if (!isObj(value)) return { ok: false, errors: ["the observation must be a JSON object"], warnings, value }
	const v = clone(value)
	for (const k of ["relations", "motion_story", "uncertain"]) if (v[k] === undefined) v[k] = []
	if (v.scale_hint === undefined) v.scale_hint = null
	tidyObservation(v, warnings)
	checkSchema(observationSchema, v, "observation", errors)
	bestEffort(() => checkObservationSemantics(v, ctx, errors), errors.length > 0)
	return { ok: errors.length === 0, errors: dedupe(errors), warnings, value: v }
}

/**
 * Small, unambiguous slips in an observation, fixed in place with a warning instead of costing a repair turn (measured by ai/bench on
 * 2026-10-15: 15-30 % of observations needed the repair for these alone, and 3 of 320 failed outright on a colour 62 characters long):
 * free text longer than its limit is cut; a size with an unknown side is no size (null); a few state and relation words are read as the
 * listed ones; a box a hair outside the picture is clamped. Anything else (a box on another scale or with its corners swapped, which may
 * be [x, y, w, h], an unknown relation, missing fields) stays an error for the repair.
 */
const STATE_WORDS = { attached_to: "resting", attached: "resting", fixed: "resting", mounted: "resting", standing: "resting", lying: "resting", static: "resting", stationary: "resting", upright: "resting", propped: "leaning", tilted: "leaning", suspended: "hanging", swinging: "moving", rolling: "moving", falling: "moving", waiting: "held" }
const REL_WORDS = { on_top_of: "on", resting_on: "on", supported_by: "on", sits_on: "on", in: "inside", within: "inside", hangs_from: "hanging_from", leans_on: "leaning_on", next_to: "touching", against: "touching", points_at: "aimed_at", aimed_toward: "aimed_at" }
function tidyObservation(v, warnings) {
	const cut = (o, k, max, path) => {
		if (typeof o?.[k] === "string" && o[k].length > max) {
			o[k] = `${o[k].slice(0, max - 1).trimEnd()}…`
			warnings.push(`${path}.${k} was cut to ${max} characters`)
		}
	}
	const cutList = (k, maxItems, maxLen) => {
		if (!Array.isArray(v[k])) return
		if (v[k].length > maxItems) {
			v[k] = v[k].slice(0, maxItems)
			warnings.push(`observation.${k} was cut to ${maxItems} entries`)
		}
		v[k].forEach((_, i) => cut(v[k], i, maxLen, `observation.${k}`))
	}
	// an object with no box (bbox null) is one the request names but the picture does not show (2 of 120 observations of AI concept
	// pictures: a cat and water the picture left out, ai/research/round3-plan.md §3): it is not an observed object but a doubt, so it moves
	// to `uncertain` with a warning, and the relations and supports that name it go too (a missing box stays an error for the repair)
	if (Array.isArray(v.objects) && v.objects.some((o) => isObj(o) && o.bbox === null)) {
		const gone = []
		v.objects = v.objects.filter((o, i) => {
			if (!isObj(o) || o.bbox !== null) return true
			const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : `object ${i + 1}`
			gone.push(label)
			warnings.push(`observation.objects[${i}] (${label}) has no box (bbox null): moved to "uncertain" as not seen in the picture`)
			return false
		})
		if (Array.isArray(v.uncertain)) for (const l of gone) v.uncertain.push(`"${l}" is not seen in the picture`)
		const kept = new Set(v.objects.filter(isObj).map((o) => String(o.label ?? "").toLowerCase()))
		const lost = new Set(gone.map((l) => l.toLowerCase()).filter((l) => !kept.has(l)))
		const named = (s) => typeof s === "string" && lost.has(s.trim().toLowerCase())
		if (Array.isArray(v.relations))
			v.relations = v.relations.filter((r, i) => {
				if (!isObj(r) || !(named(r.a) || named(r.b))) return true
				warnings.push(`observation.relations[${i}] names an object that is not seen: dropped`)
				return false
			})
		for (const o of v.objects)
			if (isObj(o) && named(o.supports)) {
				warnings.push(`observation.objects (${o.label}).supports named an object that is not seen: read as null`)
				o.supports = null
			}
	}
	cut(v, "summary", 1500, "observation")
	cutList("motion_story", 20, 400)
	cutList("uncertain", 20, 300)
	if (isObj(v.view)) {
		cut(v.view, "plane", 400, "observation.view")
		cut(v.view, "notes", 400, "observation.view")
	}
	if (Array.isArray(v.objects))
		for (const [i, o] of v.objects.entries()) {
			if (!isObj(o)) continue
			const at = `observation.objects[${i}]`
			for (const [k, max] of [["material", 80], ["color", 60], ["notes", 300]]) cut(o, k, max, at)
			for (const k of ["material", "color"])
				if (o[k] === null) {
					o[k] = ""
					warnings.push(`${at}.${k} null read as "" (not known)`)
				}
			if (isObj(o.est_size_m) && o.est_size_m.d === null) delete o.est_size_m.d
			const e = o.est_size_m
			if (isObj(e) && !(typeof e.w === "number" && typeof e.h === "number" && e.w > 0 && e.h > 0)) {
				o.est_size_m = null
				warnings.push(`${at}.est_size_m had no width or height: read as unknown (null)`)
			}
			if (typeof o.state === "string" && !["resting", "leaning", "held", "moving", "hanging"].includes(o.state)) {
				const w = STATE_WORDS[o.state.toLowerCase().replace(/[\s-]+/g, "_")]
				if (w) {
					warnings.push(`${at}.state "${o.state}" read as "${w}"`)
					o.state = w
				}
			}
			const b = o.bbox
			if (Array.isArray(b) && b.length === 4 && b.every((x) => typeof x === "number" && Number.isFinite(x))) {
				if (b.every((x) => x >= -0.02 && x <= 1.02) && b.some((x) => x < 0 || x > 1)) {
					o.bbox = b.map((x) => Math.min(1, Math.max(0, x)))
					warnings.push(`${at}.bbox clamped into the picture`)
				}
			}
		}
	if (Array.isArray(v.relations)) {
		const ok = new Set(["left_of", "right_of", "on", "inside", "touching", "leaning_on", "hanging_from", "above", "below", "in_front_of", "behind", "attached_to", "aimed_at"])
		v.relations.forEach((r, i) => {
			if (!isObj(r) || typeof r.rel !== "string" || ok.has(r.rel)) return
			const w = REL_WORDS[r.rel.toLowerCase().replace(/[\s-]+/g, "_")]
			if (w) {
				warnings.push(`observation.relations[${i}].rel "${r.rel}" read as "${w}"`)
				r.rel = w
			} // (an unknown kind stays an error: the repair names the listed ones)
		})
	}
}

function checkObservationSemantics(v, ctx, errors) {
	if (!Array.isArray(v.objects)) return
	v.objects = v.objects.filter((o) => isObj(o) && typeof o.label === "string")
	if (!Array.isArray(v.relations)) v.relations = []
	v.relations = v.relations.filter((r) => isObj(r) && typeof r.a === "string" && typeof r.b === "string")
	const labels = new Set()
	const nImages = ctx.images ?? 8
	for (const [i, o] of v.objects.entries()) {
		const at = `objects[${i}] (${o.label})`
		if (labels.has(o.label)) errors.push(`${at}: the label "${o.label}" is used twice; labels must be unique (use count for several alike, or number them)`)
		labels.add(o.label)
		const [x0, y0, x1, y1] = Array.isArray(o.bbox) ? o.bbox : [0, 0, 1, 1]
		if (!(x0 < x1 && y0 < y1)) errors.push(`${at}.bbox must be [x0, y0, x1, y1] with x0 < x1 and y0 < y1 (0..1 of the image, from its top-left)`)
		if (o.image !== undefined && o.image >= nImages) errors.push(`${at}.image ${o.image} is not one of the ${nImages} image(s) (0-based)`)
	}
	const lower = new Map([...labels].map((l) => [l.toLowerCase(), l]))
	for (const [i, o] of v.objects.entries()) {
		if (typeof o.supports !== "string") continue
		if (o.supports === o.label) errors.push(`objects[${i}] (${o.label}).supports refers to itself`)
		else if (!labels.has(o.supports)) {
			const exact = lower.get(o.supports.toLowerCase())
			if (exact) o.supports = exact
			else if (!ENVIRONMENT.includes(o.supports.toLowerCase()))
				errors.push(`objects[${i}] (${o.label}).supports "${o.supports}" is not an object label (or one of ${ENVIRONMENT.join(", ")}); add it as an object or use null`)
		}
	}
	for (const [i, r] of v.relations.entries()) {
		for (const end of ["a", "b"]) {
			if (labels.has(r[end])) continue
			const exact = lower.get(r[end].toLowerCase())
			if (exact) r[end] = exact
			else if (!(end === "b" && ENVIRONMENT.includes(r[end].toLowerCase()))) errors.push(`relations[${i}].${end} "${r[end]}" is not an object label`)
		}
		if (r.a === r.b) errors.push(`relations[${i}]: "${r.a}" cannot relate to itself`)
	}
}

// ---------------------------------------------------------------- names and materials the patches must respect (bench 2026-10-15 review)
const NAME_STOP = new Set("the a an of and or with on in at to for from by its it big small large little tiny huge long short tall low high upper lower left right middle top bottom first second third last red blue green yellow white black orange purple pink brown grey gray silver gold dark light new old one two three four five six seven eight nine ten el la los las un una de del y con le les des du et der die das ein eine und".split(" "))
const words = (t) => normLabel(t).split(" ").filter((w) => w.length >= 3 && !NAME_STOP.has(w) && !/^\d/.test(w))
/** Does the request name this item (its name's words, or its type's)? */
function requested(it, text) {
	if (!it || typeof text !== "string" || !text.trim()) return false
	const req = new Set(normLabel(text).split(" "))
	const plural = (w) => req.has(w) || req.has(`${w}s`) || req.has(`${w}es`) || (w.endsWith("s") && req.has(w.slice(0, -1)))
	return [...words(it.name ?? ""), ...words(String(it.type ?? "").replace(/-/g, " "))].some(plural)
}
/**
 * The material of a thing the request names stays as it is (bench 2026-10-15: a refine round turned the requested coffee mug's stand-in into
 * cardboard to keep a marble in it, so it looked like a paper cup): change friction, bounce or the setup around it instead. Allowed when the
 * request itself names the new material.
 */
function checkProtectedMaterial(patches, plan, ctx, errors, path = "patches") {
	const text = typeof ctx.text === "string" ? ctx.text : ""
	if (!text || !Array.isArray(patches)) return
	const items = new Map((plan?.items ?? []).filter(isObj).map((it) => [it.id, it]))
	for (const [i, p] of patches.entries()) {
		if (!isObj(p) || !isObj(p.props) || typeof p.props.material !== "string") continue
		if (p.op !== "set_props" && p.op !== "replace_type") continue
		for (const id of Array.isArray(p.ids) ? p.ids : [p.id]) {
			const it = items.get(id)
			if (!it || !requested(it, text)) continue
			const was = it.props?.material ?? ctx.catalog?.types?.[it.type]?.props?.material?.default
			if (was === p.props.material) continue
			if (words(p.props.material).some((w) => normLabel(text).split(" ").includes(w))) continue
			errors.push(`${path}[${i}]: "${it.name ?? id}" is a thing the request asks for: keep its material${was ? ` (${was})` : ""}, which is how it looks. Change its friction or bounce (surface props every type has), or the setup around it, instead`)
		}
	}
}

/** A number as it may be written in a name: 12, 0.5, 10 cm... -> [pattern, replacement] pairs for a prop changing from a to b. */
function nameForms(spec, a, b) {
	const t = (v, d = 2) => String(Number(v.toFixed(d)))
	const out = []
	if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return out
	if (spec.kind === "int") {
		if (spec.key !== "number") out.push([String(a), String(b), ""]) // counts (dominoes, steps, balls, rows, links); a billiard ball's number is a label
	}
	else if (spec.unit === "m") {
		out.push([t(a * 100, 1), t(b * 100, 1), "\\s?-?cm"], [t(a * 1000, 0), t(b * 1000, 0), "\\s?-?mm"])
		if (a >= 1 || b >= 1) out.push([t(a), t(b), "\\s?-?m(?:etre|eter)?s?"])
	} else if (spec.unit === "kg") out.push([t(a, 2), t(b, 2), "\\s?-?kg"], [t(a * 1000, 0), t(b * 1000, 0), "\\s?-?g"])
	else if (spec.unit === "°") out.push([t(a, 0), t(b, 0), "\\s?°"])
	return out
}
/**
 * Names that state a number a patch changed ("Row of 12 dominoes" after count 12 -> 15, "10 cm ball" after diameter 0.1 -> 0.15) follow the
 * change: a set_item {name} patch is added, unless the patches rename the item themselves. -> the extra patches.
 */
function renamesFor(base, after, patches, catalog, warnings) {
	const extra = []
	if (!base || !after) return extra
	const renamed = new Set(patches.filter((p) => p?.op === "set_item" && typeof p.name === "string").map((p) => p.id))
	const before = new Map((base.items ?? []).filter(isObj).map((it) => [it.id, it]))
	for (const it of after.items ?? []) {
		const old = before.get(it?.id)
		if (!old || renamed.has(it.id) || typeof it.name !== "string" || it.name !== old.name) continue
		const T = catalog?.types?.[it.type]
		if (!T) continue
		let name = it.name
		if (it.type !== old.type) {
			// a type swap: a name that says the old kind ("Superball", "the red superball") says the new one ("Basketball")
			const was = catalog?.types?.[old.type]?.name
			if (typeof was === "string" && was && typeof T.name === "string") {
				const re = new RegExp(`\\b${was.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
				if (re.test(name)) name = name.replace(re, (m) => (m[0] === m[0].toUpperCase() ? T.name : T.name.toLowerCase()))
			}
			if (name !== it.name) {
				extra.push({ op: "set_item", id: it.id, name: name.slice(0, 80), why: "its name followed the new type" })
				warnings.push(`"${it.name}" renamed "${name}" (it named the old type)`)
			}
			continue
		}
		for (const [k, spec] of Object.entries(T.props)) {
			if (spec.kind !== "int" && spec.kind !== "number") continue
			const a = old.props?.[k] ?? spec.default
			const b = it.props?.[k] ?? spec.default
			for (const [from, to, unit] of nameForms({ ...spec, key: k }, a, b)) {
				const re = new RegExp(`(^|[^\\d.,])${from.replace(".", "\\.")}(${unit})(?![\\d.,]*\\d)`, "i")
				if (re.test(name)) {
					name = name.replace(re, (_, pre, u) => `${pre}${to}${u}`)
					break
				}
			}
		}
		if (name !== it.name) {
			extra.push({ op: "set_item", id: it.id, name: name.slice(0, 80), why: "its name followed the change" })
			warnings.push(`"${it.name}" renamed "${name}" (its name stated a number the patches changed)`)
		}
	}
	return extra
}

/** Is an item placed in mid-air (on "air", or leaning with an end on "air"), so that its legs are what holds it up? */
function inTheAir(it) {
	const pl = it?.place
	if (!isObj(pl)) return false
	if (isObj(pl.lean)) return [pl.lean.from, pl.lean.to].some((e) => isObj(e) && e.on === "air")
	return pl.on === "air" && !(Number.isFinite(pl.y_m) && pl.y_m <= 0.002)
}
/**
 * The critic may not take away what holds a static thing up in mid-air (live builds 2026-10-15: a refine round switched a feed ramp's legs
 * off, leaving it floating, and called it cosmetic): a patch that switches `legs` off on an item that ends up in the air loses that change
 * (the rest of the patch stays), with a warning. -> the patches kept.
 */
function keepLegs(patches, basePlan, catalog, warnings, path = "patches") {
	let plan = clone(basePlan) ?? { items: [] }
	const out = []
	for (const [i, p0] of patches.entries()) {
		const p = clone(p0)
		const props = p.op === "add" ? p.item?.props : p.props
		const id = p.op === "add" ? p.item?.id : p.id
		if (isObj(props) && props.legs === false) {
			const after = applyPatch(plan, p, catalog)
			const it = after.items.find((x) => x.id === id)
			const T = catalog?.types?.[it?.type]
			if (it && T?.props?.legs && !T.dynamic && inTheAir(it)) {
				delete props.legs
				warnings.push(`${path}[${i}]: legs stay on for "${it.name ?? id}": it is in mid-air, and without legs it would float (rest its ends on supports instead)`)
				if (p.op === "set_props" && !Object.keys(props).length) continue // nothing else in it: the patch goes
			}
		}
		plan = applyPatch(plan, p, catalog)
		out.push(p)
	}
	return out
}

// ---------------------------------------------------------------- refine
/** ctx: {catalog, plan (the plan being refined), stage?, text? (the request), goalResults? (ai/goals.mjs checkGoals on the run judged)} */
export function validateRefine(value, ctx = {}) {
	const errors = []
	const warnings = []
	if (!isObj(value)) return { ok: false, errors: ["the answer must be a JSON object"], warnings, value }
	const v = clone(value)
	if (v.issues === undefined) v.issues = []
	if (v.patches === undefined) v.patches = []
	cutStr(v, "notes", 1500, "refine", warnings)
	if (Array.isArray(v.issues)) v.issues.forEach((is, i) => cutStr(is, "text", 400, `refine.issues[${i}]`, warnings))
	tidyPatchText(v.patches, warnings)
	checkSchema(refineSchema, v, "refine", errors)
	if (!Array.isArray(v.patches) || !Array.isArray(v.issues)) return { ok: false, errors, warnings, value: v }
	if (v.done && v.patches.length) errors.push("done is true but patches were given: set done false to have them applied, or leave patches empty")
	const ids = new Set((ctx.plan?.items ?? []).map((it) => it.id))
	for (const [i, is] of v.issues.entries()) for (const id of Array.isArray(is?.ids) ? is.ids : []) if (!ids.has(id) && id !== "table") warnings.push(`issues[${i}] mentions "${id}", which is not in the plan`)
	// a stated outcome the run does not show: the score stays below 8 and the critique is not "done", unless the tuner can still make it
	// happen ("in" goals with tune knobs: the app's tuner works on those)
	const soft = []
	const failing = (Array.isArray(ctx.goalResults) ? ctx.goalResults : []).filter((g) => g && g.ok === false)
	const tunable = (g) => g.kind === "in" && (ctx.plan?.tune ?? []).length > 0
	const hard = failing.filter((g) => !tunable(g))
	if (hard.length) {
		if (typeof v.score_0_10 === "number" && v.score_0_10 > 7) {
			warnings.push(`score ${v.score_0_10} capped at 7: the run fails ${hard.map((g) => `"${g.label}"`).join(", ")}`)
			v.score_0_10 = 7
		}
		if (v.done === true)
			soft.push(
				`done is true, but the run fails ${hard.map((g) => `"${g.label}" (${g.detail ?? "not met"})`).join("; ")}: set done false and fix it with patches; if it truly cannot be fixed, set done false with no patches and say why in notes`
			)
	}
	if (v.patches.length) {
		checkProtectedMaterial(v.patches, ctx.plan, ctx, soft)
		const r = checkPatches(v.patches, ctx.plan, ctx)
		errors.push(...r.errors)
		warnings.push(...r.warnings)
		if (!r.errors.length) {
			const kept = keepLegs(r.patches, ctx.plan, ctx.catalog, warnings)
			v.patches = [...kept, ...renamesFor(ctx.plan, applyPatches(ctx.plan ?? { items: [] }, kept, ctx.catalog), kept, ctx.catalog, warnings)]
		}
	}
	return { ok: errors.length === 0, errors: dedupe(errors), soft: dedupe(soft), warnings, value: v }
}

/**
 * refine's rate-only final check (payload rate_only: true): {score_0_10, issues, notes?}. Fields of a full critique (done, patches) are
 * dropped with a warning (nothing is applied after this check). While a stated goal fails in the run, the score is at most 7, whatever
 * the kind (the tuner has had its turn). ctx: {plan, goalResults?}
 */
export function validateRate(value, ctx = {}) {
	const errors = []
	const warnings = []
	if (!isObj(value)) return { ok: false, errors: ["the answer must be a JSON object"], warnings, value }
	const v = clone(value)
	for (const k of ["done", "patches"]) if (v[k] !== undefined) {
		if (k === "patches" ? Array.isArray(v[k]) && v[k].length : true) warnings.push(`${k} dropped: this check only rates the scene`)
		delete v[k]
	}
	if (v.issues === undefined) v.issues = []
	if (v.score === undefined || v.score_0_10 !== undefined) delete v.score
	else {
		v.score_0_10 = v.score
		delete v.score
		warnings.push("score read as score_0_10")
	}
	cutStr(v, "notes", 600, "rate", warnings)
	if (Array.isArray(v.issues)) v.issues.forEach((is, i) => cutStr(is, "text", 400, `rate.issues[${i}]`, warnings))
	checkSchema(rateSchema, v, "rate", errors)
	const failing = (Array.isArray(ctx.goalResults) ? ctx.goalResults : []).filter((g) => g && g.ok === false)
	if (failing.length && typeof v.score_0_10 === "number" && v.score_0_10 > 7) {
		warnings.push(`score ${v.score_0_10} capped at 7: the run fails ${failing.map((g) => `"${g.label}"`).join(", ")}`)
		v.score_0_10 = 7
	}
	return { ok: errors.length === 0, errors: dedupe(errors), warnings, value: v }
}

/** ctx.intent "edit" (the user pressed "Edit with AI": the scene on screen is changed, never replaced): an answer that is not mode "patch"
 *  gets the one repair turn (soft: kept, with a warning, when it stays; the client then offers to build it as a new scene). */
/** A request to throw the scene away and build another ("start over: …", "clear it and build …", "from scratch"): kind "new" even under Edit. */
export const START_OVER = /\b(start(ing)? (over|again|afresh|fresh|from scratch)|from scratch|scrap (it|this|that|everything|the (scene|machine|whole thing))|(clear|wipe|empty) (it|this|everything|the (table|scene|stage)|it all)( out)?( and| then|,|:)|throw (it|this|everything) (away|out)|a (whole )?(different|new) (scene|setup|machine) (instead|altogether))\b/i
function editIntentSoft(v, ctx) {
	if (ctx?.intent !== "edit" || v?.mode === "patch") return []
	// (§14.2 (2): a real start-over is kind "new"; the app offers to build it as a new scene, with the planner and the tuner)
	if (START_OVER.test(String(ctx.text ?? ""))) return []
	return [`mode is "${v?.mode}", but the user pressed Edit: change the scene on screen with mode "patch" (remove, add and change items with patches, even when the words say "new" or "build"); keep every item the request does not name. Only a request to start over with a different scene is kind "new"`]
}

// ---------------------------------------------------------------- edit
/**
 * The answer's `kind` and `targets` (ai/DESIGN.md §14, measured in ai/experiments/edit as arm n7): a kind outside EDIT_KINDS, targets that are
 * not a list, and a kind that changes nothing (ask, answer, undo) with patches get the repair turn, with the words the experiment used; the
 * rest is tidied with a warning, never repaired: each target kept as {says, ids, because} (ids from a string or `id`), at most 20; mode "new"
 * (or a legacy whole plan) is kind "new"; kind "new" with patches is a change, without them mode "new"; undo and kind "undo" go together.
 */
function checkEditKind(v, errors, warnings) {
	if (!Array.isArray(v.targets)) errors.push("targets must be a list ([] when the request names nothing)")
	else {
		const kept = []
		for (const [i, t] of v.targets.entries()) {
			if (!isObj(t)) {
				warnings.push(`edit.targets[${i}] dropped: a target is {says, ids, because}`)
				continue
			}
			const raw = Array.isArray(t.ids) ? t.ids : typeof t.ids === "string" ? [t.ids] : typeof t.id === "string" ? [t.id] : []
			const ids = [...new Set(raw.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, LIMITS.idLength)))].slice(0, LIMITS.items)
			kept.push({ says: String(t.says ?? "").slice(0, 200), ids, ...(t.because !== undefined && t.because !== null ? { because: String(t.because).slice(0, 300) } : {}) })
		}
		if (kept.length > MAX_TARGETS) warnings.push(`edit.targets cut to the first ${MAX_TARGETS}`)
		v.targets = kept.slice(0, MAX_TARGETS)
	}
	if (!EDIT_KINDS.includes(v.kind)) {
		errors.push(`kind must be one of ${EDIT_KINDS.join(", ")}`)
		return
	}
	const patches = Array.isArray(v.patches) ? v.patches : []
	if ((v.mode === "new" || v.mode === "plan") && v.kind !== "new") {
		warnings.push(`edit.kind "${v.kind}" read as "new": mode "${v.mode}" is a different scene`)
		v.kind = "new"
	} else if (v.kind === "new" && v.mode === "patch") {
		if (patches.length) {
			warnings.push('edit.kind "new" read as "change": the answer patches the scene on screen')
			v.kind = "change"
		} else {
			warnings.push('edit.mode "patch" read as "new": kind "new" is a different scene')
			v.mode = "new"
		}
	}
	if (v.undo === true && v.kind !== "undo" && !patches.length) {
		warnings.push(`edit.kind "${v.kind}" read as "undo": undo is true`)
		v.kind = "undo"
	}
	if (v.kind === "undo" && v.undo !== true && !patches.length) v.undo = true
	if (EDIT_NO_CHANGE.includes(v.kind) && patches.length) errors.push(`kind "${v.kind}" changes nothing: "patches": []`)
}

/** ctx: {catalog, plan? (the scene's plan), scene? (the current scene; used as an exact plan when no plan is given), stage?} */
export function validateEdit(value, ctx = {}) {
	const errors = []
	const warnings = []
	if (!isObj(value)) return { ok: false, errors: ["the answer must be a JSON object"], warnings, value }
	const v = clone(value)
	if (v.missing === undefined) v.missing = []
	delete v.plan_missing // (the validator's, below)
	checkEditKind(v, errors, warnings)
	tidyReply(v, "edit", warnings, 1200, EDIT_REPLY_WORDS)
	tidySuggestions(v, "edit", warnings)
	cutStr(v, "notes", 3000, "edit", warnings)
	if (Array.isArray(v.assumptions)) v.assumptions.forEach((_, i) => cutStr(v.assumptions, i, 300, "edit.assumptions", warnings))
	if (v.undo === false) delete v.undo
	tidyPatchText(v.patches, warnings)
	if (Array.isArray(v.missing)) v.missing.forEach((m, i) => (cutStr(m, "reason", 400, `edit.missing[${i}]`, warnings), cutStr(m, "asked", 160, `edit.missing[${i}]`, warnings)))
	checkSchema(editSchema, v, "edit", errors)
	if (!["patch", "plan", "new"].includes(v.mode)) return { ok: false, errors, warnings, value: v }
	cutStr(v, "why", 300, "edit", warnings)
	if (v.mode === "new") {
		// a different scene: no patches and no plan here (the plan step builds it, at its own effort)
		for (const k of ["patches", "plan", "notes", "assumptions"]) if (v[k] !== undefined) {
			if (!(k === "patches" && Array.isArray(v.patches) && !v.patches.length)) warnings.push(`edit.${k} dropped: mode "new" leaves the new scene to the planner`)
			delete v[k]
		}
		if (v.undo === true) errors.push('undo is true: answer mode "patch" with "patches": [] for an undo request')
		return { ok: errors.length === 0, errors: dedupe(errors), soft: editIntentSoft(v, ctx), warnings, value: v }
	}
	if (!Array.isArray(v.missing)) v.missing = []
	if (v.undo === true && (v.mode !== "patch" || (Array.isArray(v.patches) && v.patches.length)))
		errors.push('undo is true: the app goes back to the earlier scene itself, so answer mode "patch" with "patches": [] (and a reply that says so)')
	if (v.mode !== "patch" && (v.notes !== undefined || v.assumptions !== undefined)) errors.push('notes and assumptions go inside the plan in mode "plan"')
	if (v.mode === "patch") {
		if (v.plan !== undefined) errors.push('mode "patch" takes patches, not a plan (use mode "plan" for a whole new scene)')
		if (!Array.isArray(v.patches)) errors.push('mode "patch" needs patches (an empty list when nothing should change)')
		else if (v.patches.length) {
			const base = ctx.plan ?? planFromScene(ctx.scene, ctx.catalog)
			const r = checkPatches(v.patches, base, ctx)
			errors.push(...r.errors)
			warnings.push(...r.warnings)
			if (!r.errors.length) {
				v.patches = [...r.patches, ...renamesFor(base, r.plan, r.patches, ctx.catalog, warnings)]
				// `missing` is what THIS request asked for that the library does not have (the card tells the user); the scene's own list
				// stays with the scene as `plan_missing`: what the plan reported before, unless its stand-in was removed, then this change's
				if (Array.isArray(base?.missing) && base.missing.length && Array.isArray(v.missing)) {
					const left = new Set(r.plan.items.map((it) => it.id))
					const seen = new Set(v.missing.filter(isObj).map((m) => normLabel(m.asked)))
					const kept = base.missing.filter((m) => isObj(m) && !seen.has(normLabel(m.asked)) && (m.substitute_id == null || left.has(m.substitute_id)))
					v.plan_missing = [...clone(kept), ...clone(v.missing)].slice(0, LIMITS.missing)
				}
			}
		}
		// (an entry the plan already had is the scene's, not this request's: the model copied it from the plan)
		if (Array.isArray(ctx.plan?.missing) && ctx.plan.missing.length && Array.isArray(v.missing) && v.missing.length) {
			const had = new Set(ctx.plan.missing.filter(isObj).map((m) => normLabel(m.asked)))
			// (unless the request itself asks for it again: "make the cup crumple" may report "a crumpled paper cup" once more)
			const req = ` ${normLabel(ctx.text ?? "")} `
			const stop = new Set(["the", "and", "with", "for", "its", "not", "off", "out", "one", "all", "being", "along", "from", "into", "onto"])
			const asksAgain = (m) => normLabel(m.asked).split(" ").some((w) => w.length >= 3 && !stop.has(w) && req.includes(` ${w.replace(/(ed|s)$/, "")}`))
			const own = v.missing.filter((m) => !(isObj(m) && had.has(normLabel(m.asked)) && !asksAgain(m)))
			if (own.length < v.missing.length) {
				warnings.push(`edit.missing: ${v.missing.length - own.length} entr${v.missing.length - own.length > 1 ? "ies" : "y"} the plan already had dropped (missing is this request's)`)
				v.missing = own
			}
		}
	} else {
		if (v.patches !== undefined && v.patches.length) errors.push('mode "plan" takes a whole plan, not patches')
		delete v.patches
		if (!isObj(v.plan)) errors.push('mode "plan" needs plan: the whole new scene plan')
		else {
			const r = validatePlan(v.plan, ctx)
			errors.push(...r.errors.map((e) => `edit.${e}`))
			warnings.push(...r.warnings, ...softOf(r).map((e) => `edit.${e}`))
			v.plan = r.value
		}
	}
	for (const [i, m] of v.missing.entries())
		if (typeof m?.substitute_type === "string" && !ctx.catalog.types[m.substitute_type]) errors.push(`missing[${i}]: substitute_type "${m.substitute_type}" is not in the catalog; use a catalog key or null`)
	return { ok: errors.length === 0, errors: dedupe(errors), soft: editIntentSoft(v, ctx), warnings, value: v }
}

// ---------------------------------------------------------------- per step
export const VALIDATORS = { observe: validateObservation, plan: validatePlan, refine: validateRefine, rate: validateRate, edit: validateEdit }
export function validate(step, value, ctx) {
	const f = VALIDATORS[step]
	if (!f) throw new Error(`no validator for step ${step}`)
	return f(value, ctx)
}
