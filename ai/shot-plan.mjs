// The director's shot plan: its structure (web/export/shot-plan.schema.json, the filming module's language: JSON Schema 2020-12, checked here
// without a dependency) and its resolution against the run's timeline digest (web/export/digest.js): every item, part, role, moment, contact,
// event, reading, beam stretch and bounce a plan names must be in the digest, every play window inside its run, every shot long enough to
// read. The errors are plain sentences with a path and, for a name the digest lacks, the digest's nearest ids: they go back to the director
// as its repair turn. The executor (web/export/shots.js checkPlan) then resolves the same names on the run itself, compiles and measures.
//
//   checkShotPlanSchema(value) -> [errors]                 the structure only
//   resolveShotPlan(plan, digest) -> {errors, warnings, timing: {shots: [{id, t0, t1, seconds}], seconds}}
//   validateShotPlan(value, {digest}) -> {ok, errors, warnings, value, timing}   both (the direct step's validator: ai/schemas.mjs VALIDATORS)
// Pure apart from reading the schema file once.
import { readFileSync } from "node:fs"
import { momentTime } from "../web/export/moments.js"

export const SHOT_PLAN_SCHEMA = JSON.parse(readFileSync(new URL("../web/export/shot-plan.schema.json", import.meta.url), "utf8"))
const DEFS = SHOT_PLAN_SCHEMA.$defs
export const TARGET_KINDS = ["item", "items", "role", "point", "region", "contact", "beam", "trail", "path", "through", "gap", "mark"]
const MIN_SHOT_S = 0.8 // the shortest shot a child can read (the safety net's minShot)
const OUTSIDE_S = 1 // a moment up to this far past the run's start or end holds its first or last frame (more is a mistake)

// ------------------------------------------------------------------------------------------------ JSON Schema (the 2020-12 subset the shot-plan schema uses)
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v)
const typeOk = (v, t) => (t === "number" ? typeof v === "number" && Number.isFinite(v) : t === "integer" ? Number.isInteger(v) : typeOf(v) === t)
const short = (v) => {
	const s = JSON.stringify(v)
	return s === undefined ? String(v) : s.length > 60 ? s.slice(0, 57) + "..." : s
}
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const codePoints = (s) => [...s].length
const patterns = new Map()
const regex = (p) => {
	if (!patterns.has(p)) patterns.set(p, new RegExp(p, "u"))
	return patterns.get(p)
}

/** Errors of v against a schema node ([] when it is valid). defName: the $defs entry the node came from (for plain-words messages). */
function errorsOf(schema, v, path, defName = null) {
	if (schema === true || schema === undefined) return []
	if (schema === false) return [`${path} is not allowed`]
	if (schema.$ref) {
		const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref)
		if (!m || !DEFS[m[1]]) return [`${path}: the schema's ${schema.$ref} is missing`]
		return errorsOf(DEFS[m[1]], v, path, m[1])
	}
	const errs = []
	if (schema.type !== undefined) {
		const ts = [].concat(schema.type)
		if (!ts.some((t) => typeOk(v, t))) return [`${path} must be ${ts.map((t) => (t === "object" ? "an object" : t === "array" ? "a list" : t === "integer" ? "a whole number" : `a ${t}`)).join(" or ")}, not ${v === undefined ? "missing" : short(v)}`]
	}
	if (schema.const !== undefined && !deepEqual(v, schema.const)) return [`${path} must be ${short(schema.const)}, not ${short(v)}`]
	if (schema.enum && !schema.enum.some((e) => deepEqual(e, v))) return [`${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}, not ${short(v)}`]
	if (typeof v === "string") {
		if (schema.minLength !== undefined && codePoints(v) < schema.minLength) errs.push(schema.minLength <= 1 ? `${path} must not be empty` : `${path} is ${codePoints(v)} characters long; at least ${schema.minLength}`)
		if (schema.maxLength !== undefined && codePoints(v) > schema.maxLength) errs.push(`${path} is ${codePoints(v)} characters long; at most ${schema.maxLength}`)
		if (schema.pattern !== undefined && !regex(schema.pattern).test(v)) errs.push(defName === "momentId" ? momentIdError(path, v) : defName === "id" ? `${path} ${short(v)} is not an id (letters, digits, _ . @ -; at most 64)` : `${path} ${short(v)} is not in the right form`)
	}
	if (typeof v === "number") {
		if (schema.minimum !== undefined && v < schema.minimum) errs.push(`${path} is ${v}, below the minimum ${schema.minimum}`)
		if (schema.maximum !== undefined && v > schema.maximum) errs.push(`${path} is ${v}, above the maximum ${schema.maximum}`)
	}
	if (Array.isArray(v)) {
		if (schema.minItems !== undefined && v.length < schema.minItems) errs.push(`${path} needs at least ${schema.minItems} entr${schema.minItems === 1 ? "y" : "ies"}`)
		if (schema.maxItems !== undefined && v.length > schema.maxItems) errs.push(`${path} has ${v.length} entries; at most ${schema.maxItems}`)
		if (schema.items !== undefined) v.forEach((x, i) => errs.push(...errorsOf(schema.items, x, `${path}[${i}]${labelOf(path, x)}`)))
	}
	if (isObj(v)) {
		for (const k of schema.required ?? []) if (v[k] === undefined) errs.push(`${path}.${k} is missing`)
		if (schema.minProperties !== undefined && Object.keys(v).length < schema.minProperties) errs.push(`${path} is empty`)
		const props = schema.properties ?? {}
		for (const [k, x] of Object.entries(v)) {
			if (props[k] !== undefined) errs.push(...errorsOf(props[k], x, `${path}.${k}`))
			else if (schema.additionalProperties === false) errs.push(`${path}.${k} is not a field here${nearestText(k, Object.keys(props), 1, " (did you mean ", "?)")}; the fields are ${Object.keys(props).join(", ")}`)
			else if (isObj(schema.additionalProperties)) errs.push(...errorsOf(schema.additionalProperties, x, `${path}.${k}`))
		}
	}
	for (const s of schema.allOf ?? []) errs.push(...errorsOf(s, v, path, defName))
	if (schema.anyOf) {
		const each = schema.anyOf.map((s) => errorsOf(s, v, path, defName))
		if (!each.some((e) => !e.length)) errs.push(...explainChoice(defName, schema.anyOf, each, v, path))
	}
	if (schema.oneOf) {
		const each = schema.oneOf.map((s) => errorsOf(s, v, path, defName))
		const ok = each.filter((e) => !e.length).length
		if (ok === 0) errs.push(...explainChoice(defName, schema.oneOf, each, v, path))
		else if (ok > 1) errs.push(defName === "target" ? targetKindsError(path, v) : `${path} fits more than one form: ${short(v)}`)
	}
	if (schema.not !== undefined && !errorsOf(schema.not, v, path).length) errs.push(defName === "target" ? targetKindsError(path, v) : `${path} is in a form that is not allowed here: ${short(v)}`)
	if (schema.if !== undefined) {
		const cond = !errorsOf(schema.if, v, path).length
		if (cond && schema.then !== undefined) errs.push(...errorsOf(schema.then, v, path).map((e) => thenWhy(e, schema.if)))
		if (!cond && schema.else !== undefined) errs.push(...errorsOf(schema.else, v, path))
	}
	return errs
}
const labelOf = (path, x) => (/(^|\.)(shots|story)$/.test(path) && isObj(x) && typeof x.id === "string" ? ` (${x.id})` : "")
/** A `then` requirement in plain words: why the field is needed. */
function thenWhy(e, cond) {
	const mv = cond?.properties?.move
	if (mv?.const === "travel") return `${e}: a travel shot needs travel {path, pace}`
	if (mv?.enum) return `${e}: a push, pull or arc needs end (the framing it moves to)`
	if (cond?.properties?.run) return `${e}: a rate other than 1 (slow motion, a speed-up) needs its label ("Slow motion: 4 times slower")`
	return e
}
function momentIdError(path, v) {
	return `${path} ${short(v)} is not a moment id: use one the digest lists (start, release, result, end, pause:setup, pause:result, start:<item>, stop:<item>, exit:<item>, landing:<item>, apex:<item>, turn:<item>#n, contact:<a>+<b>, event:<kind>:<item>, reading:<item>.<key>:<starts|settles|peak|min|max|crosses=v>, beam:<source>:on, cue:<n>, t=<seconds>), optionally @<lane>, or {at, plus}`
}
function targetKindsError(path, v) {
	const kinds = isObj(v) ? TARGET_KINDS.filter((k) => v[k] !== undefined) : []
	if (!kinds.length) return `${path} names nothing to look at: a target has exactly one of item (with part, reading or event), items, role (with lane), point, region, contact (with nth), beam (with segment, bounce or from/to), trail (with from and to), path, through, gap, mark (with m)`
	return `${path} names ${kinds.length} kinds of target at once (${kinds.join(", ")}): one per target (several things: {items: [...]}; a part: {item, part})`
}
/** Why none of a oneOf/anyOf's forms fits, in plain words: the form the value was trying for (the one whose required fields it has), else a
 *  list of the forms. */
function explainChoice(defName, branches, each, v, path) {
	if (defName === "target") {
		const kinds = isObj(v) ? TARGET_KINDS.filter((k) => v[k] !== undefined) : []
		if (kinds.length !== 1) return [targetKindsError(path, v)]
		const k = kinds[0]
		if (k === "trail" && (v.from === undefined || v.to === undefined)) return [`${path} is a trail: it needs from and to (the moments its path runs between)`]
		if (k === "mark" && v.m === undefined) return [`${path} is a mark: it needs m (the metre mark)`]
	}
	if (defName === "moment" && typeof v === "string") return [momentIdError(path, v)]
	if (defName === "frame" && isObj(v) && ["size", "fit", "width"].filter((k) => v[k] !== undefined).length > 1) return [`${path} gives ${["size", "fit", "width"].filter((k) => v[k] !== undefined).join(" and ")}: a frame is one of ${FORMS.frame}`]
	if (defName === "transition" || defName === "place" || defName === "view" || defName === "frame") {
		const e = best0(branches, each, v)
		return e.length ? e.map((x) => (x.includes(FORMS[defName]) ? x : `${x} (${path.split(".").at(-1)} is ${FORMS[defName]})`)) : [`${path} ${short(v)} is not one of ${FORMS[defName]}`]
	}
	if (defName === "run" && isObj(v)) {
		if (v.freeze !== undefined && (v.from !== undefined || v.to !== undefined || v.rate !== undefined)) return [`${path} is either a play {from, to, rate?, hold_after?} or a freeze {freeze, seconds?, hold_after?}, not both`]
		if (v.freeze === undefined && (v.from === undefined || v.to === undefined)) return [`${path} needs from and to (a play of the run) or freeze (one held moment)`]
	}
	const e = best0(branches, each, v)
	if (e.length) return e
	return [`${path} ${short(v)} is not one of the allowed forms${FORMS[defName] ? `: ${FORMS[defName]}` : ""}`]
}
/** The errors of the form a value was trying for: the one whose required fields it has (and whose type it is), with the fewest errors. */
function best0(branches, each, v) {
	const req = (s) => {
		const d = s.$ref ? DEFS[/^#\/\$defs\/(.+)$/.exec(s.$ref)?.[1]] ?? s : s
		return d.required ?? []
	}
	const typed = (s) => {
		const d = s.$ref ? DEFS[/^#\/\$defs\/(.+)$/.exec(s.$ref)?.[1]] ?? s : s
		if (d.type !== undefined) return [].concat(d.type).some((t) => typeOk(v, t))
		if (d.enum) return typeof v === typeof d.enum[0]
		return true
	}
	let best = null
	for (let i = 0; i < branches.length; i++) {
		const s = branches[i]
		if (!typed(s)) continue
		const r = req(s)
		const fit = isObj(v) ? r.filter((k) => v[k] !== undefined).length : 0
		const score = [fit, -each[i].length]
		if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) best = { i, score }
	}
	return best ? each[best.i] : []
}
const FORMS = {
	frame: "{size: 0.08..0.85}, {fit: tight|snug|loose} or {width: metres}",
	place: '"centre", "left-third", "right-third", "upper-third", "lower-third" or {x, y} in -0.7..0.7',
	view: '"side", "eye", "low", "high", "top-down", "three-quarter-left", "three-quarter-right", "macro" or {yaw: -60..60, pitch: -10..85}',
	transition: '"cut", "continue" or {ease: 0.3..4 seconds}',
	moment: "a moment id or {at, plus}"
}

/** The structural errors of a shot plan ([] when it is valid against web/export/shot-plan.schema.json). */
export function checkShotPlanSchema(value) {
	return errorsOf(SHOT_PLAN_SCHEMA, value, "plan")
}

// ------------------------------------------------------------------------------------------------ nearest names
function lev(a, b) {
	const m = a.length, n = b.length
	if (!m || !n) return m || n
	let prev = Array.from({ length: n + 1 }, (_, j) => j)
	for (let i = 1; i <= m; i++) {
		const cur = [i]
		for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
		prev = cur
	}
	return prev[n]
}
/** Up to k candidates nearest to name: the same kind of id first ("contact:..." for a contact), then by edit distance. */
export function nearest(name, candidates, k = 4) {
	const s = String(name)
	const kind = s.includes(":") ? s.slice(0, s.indexOf(":") + 1) : null
	return [...new Set(candidates)]
		.map((c) => ({ c, d: lev(s.toLowerCase(), c.toLowerCase()) - (kind && c.startsWith(kind) ? 100 : 0) - (c.includes(s) || s.includes(c) ? 3 : 0) }))
		.sort((a, b) => a.d - b.d || a.c.localeCompare(b.c))
		.slice(0, k)
		.map((x) => x.c)
}
function nearestText(name, candidates, k = 4, pre = ": the nearest are ", post = "") {
	const n = nearest(name, candidates, k)
	return n.length ? `${pre}${n.join(", ")}${post}` : ""
}

// ------------------------------------------------------------------------------------------------ resolution against the digest
/**
 * Every name in the plan resolved against the digest, and the shots' timing. -> {errors, warnings, timing}
 * timing.shots: [{id, t0, t1 (run seconds), seconds (its video length, null when the engine works it out: a trail or path travel)}];
 * timing.seconds: the video's length when every shot's is known.
 */
export function resolveShotPlan(plan, digest, { lanes: given = null } = {}) {
	const errors = []
	const warnings = []
	const runs = digest.runs
	const runList = Object.entries(runs)
	const perLane = !runs[""]
	const lanes = isObj(plan.lanes) && Array.isArray(plan.lanes.list) ? plan.lanes : null
	const laneIds = new Set((lanes?.list ?? []).map((l) => l.id))
	const roles = new Map()
	for (const l of lanes?.list ?? []) for (const [role, v] of Object.entries(isObj(l.cast) ? l.cast : {})) roles.set(role, [...(roles.get(role) ?? []), ...[].concat(v)])
	const allItems = new Set(runList.flatMap(([, r]) => Object.keys(r.items)))
	const runOf = (lane) => (lane && runs[lane]) || runs[""] || null
	const itemIn = (id, lane = null) => (lane && runs[lane] ? !!runs[lane].items[id] : runList.some(([, r]) => !!r.items[id]))
	const partsOf = (id) => [...new Set(runList.flatMap(([, r]) => r.items[id]?.parts ?? []))]
	const allMoments = (lane) => {
		const rs = lane && runs[lane] ? [runs[lane]] : runList.map(([, r]) => r)
		return rs.flatMap((r) => Object.keys(r.index))
	}
	const T = (m, lane = null) => momentTime(digest, m, lane, lanes)
	const shotLabel = (i) => `shots[${i}]${typeof plan.shots?.[i]?.id === "string" ? ` (${plan.shots[i].id})` : ""}`

	// lanes: a comparison filmed one run per lane must use the digest's lanes; cast ids are items of their lane's run
	if (perLane) {
		const want = Object.keys(runs)
		if (!lanes) errors.push(`plan.lanes is missing: this video compares ${want.length} runs, one per lane (${want.join(", ")}): give lanes.list with exactly those ids`)
		else {
			const have = lanes.list.map((l) => l.id)
			const missing = want.filter((id) => !have.includes(id))
			const extra = have.filter((id) => !want.includes(id))
			if (missing.length || extra.length) errors.push(`plan.lanes.list must have exactly the lanes ${want.join(", ")} (one per run)${missing.length ? `; missing ${missing.join(", ")}` : ""}${extra.length ? `; ${extra.join(", ")} has no run` : ""}`)
			for (const [i, l] of lanes.list.entries()) if (l.run !== undefined && runs[l.id] && l.run !== runs[l.id].key) errors.push(`plan.lanes.list[${i}].run is "${l.run}", but lane ${l.id} is filmed from the run ${runs[l.id].key}`)
		}
	}
	// lanes the caller fixed (the lesson compositor's, the skill's comparison): the plan keeps them, each lane's id and cast
	if (given && Array.isArray(given.list)) {
		const want = JSON.stringify(given.list.map((l) => [l.id, l.cast]))
		const have = lanes ? JSON.stringify(lanes.list.map((l) => [l.id, l.cast])) : null
		if (want !== have) errors.push(`plan.lanes must keep the caller's lanes as they are (each lane's id and cast): ${JSON.stringify(given.list.map((l) => ({ id: l.id, cast: l.cast })))}`)
	}
	if (lanes) {
		const seen = new Set()
		for (const [i, l] of lanes.list.entries()) {
			if (seen.has(l.id)) errors.push(`plan.lanes.list[${i}].id "${l.id}" is used twice`)
			seen.add(l.id)
			for (const [role, v] of Object.entries(isObj(l.cast) ? l.cast : {}))
				for (const id of [].concat(v)) if (!itemIn(id, perLane ? l.id : null)) errors.push(`plan.lanes.list[${i}] (${l.id}).cast.${role}: "${id}" is not an item of ${perLane ? `lane ${l.id}'s run` : "the scene"}${nearestText(id, perLane && runs[l.id] ? Object.keys(runs[l.id].items) : [...allItems])}`)
		}
	}

	// moments
	const checkMoment = (m, path, lane = null) => {
		if (m === undefined || m === null) return undefined
		const id = typeof m === "string" ? m : m.at
		if (typeof id !== "string") return undefined
		const at = /@([A-Za-z0-9_-]+)$/.exec(id)
		if (at && !laneIds.has(at[1]) && !runs[at[1]]) {
			errors.push(`${path} "${id}" names a lane "${at[1]}" the plan does not have${laneIds.size ? ` (its lanes: ${[...laneIds].join(", ")})` : ""}`)
			return undefined
		}
		const t = T(m, lane)
		const base = id.replace(/@[A-Za-z0-9_-]+$/, "")
		if (t === undefined) {
			const rm = /^reading:([^.]+)\.([^:]+):(.+)$/.exec(base)
			if (rm) {
				const r = runOf(at?.[1] ?? lane)
				const rs = r ? [r] : runList.map(([, x]) => x)
				const rd = rs.flatMap((x) => x.readings).filter((x) => x.item === rm[1])
				if (!rd.length) errors.push(`${path} "${id}": ${rm[1]} has no readings${nearestText(rm[1], [...new Set(rs.flatMap((x) => x.readings.map((y) => y.item)))], 4, " (the items that read: ", ")")}`)
				else if (!rd.some((x) => x.key === rm[2])) errors.push(`${path} "${id}": ${rm[1]} does not read ${rm[2]} (it reads ${[...new Set(rd.map((x) => x.key))].join(", ")})`)
				else {
					const x = rd.find((y) => y.key === rm[2])
					const c = /^crosses=(-?[0-9.]+)$/.exec(rm[3])
					errors.push(`${path} "${id}": ${x.constant ? `${rm[1]}.${rm[2]} never changes (it stays ${x.v0}), so it has no ${rm[3]}` : c ? `${rm[1]}.${rm[2]} never crosses ${c[1]} (it runs ${x.min}..${x.max})` : `${rm[1]}.${rm[2]} has no ${rm[3]}`}`)
				}
			} else errors.push(`${path} "${id}" is not a moment of ${at || lane ? `lane ${at?.[1] ?? lane}'s run` : perLane ? "any lane's run" : "this run"}${nearestText(base, allMoments(at?.[1] ?? lane))}`)
			return undefined
		}
		const dur = Math.max(...(at || lane ? [runOf(at?.[1] ?? lane)] : runList.map(([, r]) => r)).filter(Boolean).map((r) => r.seconds))
		// (a moment a little past either end holds the run's first or last frame, as the compiler films it; far outside is a mistake)
		if (t < -OUTSIDE_S || t > dur + OUTSIDE_S) {
			errors.push(`${path} ${short(m)} is at ${r3(t)} s, outside the run (0..${dur} s)`)
			return undefined
		}
		if (t < -1e-6 || t > dur + 1e-6) warnings.push(`${path} ${short(m)} is at ${r3(t)} s, past the run's ${t < 0 ? "start" : `end (${dur} s)`}: the run holds its ${t < 0 ? "first" : "last"} frame there`)
		return t
	}

	// targets
	const checkTarget = (tg, path, { lane = null, pathOnly = false } = {}) => {
		if (!isObj(tg)) return
		if (tg.when !== undefined) checkMoment(tg.when, `${path}.when`, tg.lane ?? lane)
		if (tg.lane !== undefined && !laneIds.has(tg.lane)) errors.push(`${path}.lane "${tg.lane}" is not one of the plan's lanes${laneIds.size ? ` (${[...laneIds].join(", ")})` : " (it has none)"}`)
		const l = tg.lane ?? lane
		if (tg.item !== undefined) {
			if (!itemIn(tg.item, perLane ? l : null)) return void errors.push(`${path}.item "${tg.item}" is not in ${perLane && l ? `lane ${l}'s run` : "the scene"}${nearestText(tg.item, [...allItems])}`)
			if (tg.part !== undefined && !partsOf(tg.item).includes(tg.part)) errors.push(`${path}.part "${tg.part}": ${tg.item} has ${partsOf(tg.item).length > 1 ? `the parts ${partsOf(tg.item).join(", ")}` : "no parts to name (frame the whole item)"}`)
			if (tg.reading !== undefined) {
				const keys = [...new Set(runList.flatMap(([, r]) => r.readings.filter((x) => x.item === tg.item).map((x) => x.key)))]
				if (!keys.includes(tg.reading)) errors.push(`${path}.reading "${tg.reading}": ${tg.item} ${keys.length ? `reads ${keys.join(", ")}` : "has no readings"}`)
			}
			if (tg.event !== undefined && T(`event:${tg.event}:${tg.item}`, l) === undefined) {
				const evs = [...new Set(runList.flatMap(([, r]) => r.events.filter((e) => e.item === tg.item).map((e) => e.kind)))]
				errors.push(`${path}.event "${tg.event}": ${tg.item} has ${evs.length ? `the events ${evs.join(", ")}` : "no module events"}`)
			}
		}
		if (tg.part !== undefined && tg.item === undefined && tg.trail === undefined) errors.push(`${path}.part goes with item (or trail): {item: "p", part: "bob"}`)
		if (tg.items !== undefined) for (const [i, id] of [].concat(tg.items).entries()) if (!itemIn(id)) errors.push(`${path}.items[${i}] "${id}" is not in the scene${nearestText(id, [...allItems])}`)
		if (tg.role !== undefined) {
			if (!lanes) errors.push(`${path}.role "${tg.role}" needs the plan's lanes (a role is a lanes cast name)`)
			else if (!roles.has(tg.role)) errors.push(`${path}.role "${tg.role}" is not a cast role of the lanes (roles: ${[...roles.keys()].join(", ")})`)
		}
		if (tg.region !== undefined && Array.isArray(tg.region) && (tg.region[1] <= tg.region[0] || tg.region[3] <= tg.region[2])) errors.push(`${path}.region must be [x0, x1, y0, y1] with x0 < x1 and y0 < y1`)
		if (tg.contact !== undefined && Array.isArray(tg.contact)) {
			const [a, b] = tg.contact
			const n = Math.max(...runList.map(([, r]) => r.contacts.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a))?.n ?? 0))
			if (!n) errors.push(`${path}.contact [${a}, ${b}]: they never touch${nearestText(`contact:${a}+${b}`, runList.flatMap(([, r]) => r.contacts.map((c) => c.id)), 4, " (the contacts: ", ")")}`)
			else if (tg.nth !== undefined && tg.nth > n) errors.push(`${path}.nth ${tg.nth}: ${a} and ${b} touch ${n} time${n === 1 ? "" : "s"}`)
		}
		if (tg.beam !== undefined) {
			const b = runList.map(([, r]) => r.beams.find((x) => x.source === tg.beam)).find(Boolean)
			if (!b) return void errors.push(`${path}.beam "${tg.beam}" is not a light source${nearestText(tg.beam, runList.flatMap(([, r]) => r.beams.map((x) => x.source)), 4, " (the sources: ", ")") || " (this scene has no light beams)"}`)
			const tr = b.traces[0]
			if (!tr) return void errors.push(`${path}.beam "${tg.beam}" draws no light in this run`)
			const nb = tr.bounces.length
			if (tg.bounce !== undefined && tg.bounce > nb) errors.push(`${path}.bounce ${tg.bounce}: the light from ${tg.beam} turns ${nb} time${nb === 1 ? "" : "s"}${nb ? ` (bounce 1${nb > 1 ? `..${nb}` : ""})` : ""}`)
			if (tg.segment !== undefined && tg.segment > tr.lengths.length) errors.push(`${path}.segment ${tg.segment}: the light from ${tg.beam} has ${tr.lengths.length} straight piece${tr.lengths.length === 1 ? "" : "s"}`)
			for (const k of ["from", "to"]) {
				const s = tg[k]
				if (s === undefined) continue
				if (typeof s !== "string") {
					errors.push(`${path}.${k}: with beam, from and to are "source", "bounce:<n>", "hit:<item>" or "end"`)
					continue
				}
				const mb = /^bounce:(\d+)$/.exec(s)
				const mh = /^hit:(.+)$/.exec(s)
				if (mb && Number(mb[1]) > nb) errors.push(`${path}.${k} "${s}": the light turns ${nb} time${nb === 1 ? "" : "s"}`)
				if (mh && !tr.ends.includes(mh[1])) errors.push(`${path}.${k} "${s}": the light from ${tg.beam} ends on ${tr.ends.filter(Boolean).join(", ") || "nothing (it leaves the scene)"}`)
				if (!mb && !mh && s !== "source" && s !== "end") errors.push(`${path}.${k} "${s}": with beam, from and to are "source", "bounce:<n>", "hit:<item>" or "end"`)
			}
		}
		if (tg.trail !== undefined) {
			if (!itemIn(tg.trail)) errors.push(`${path}.trail "${tg.trail}" is not in the scene${nearestText(tg.trail, [...allItems])}`)
			if (tg.part !== undefined && !partsOf(tg.trail).includes(tg.part)) errors.push(`${path}.part "${tg.part}": ${tg.trail} has the parts ${partsOf(tg.trail).join(", ") || "(none)"}`)
			const a = checkMoment(tg.from, `${path}.from`, l), z = checkMoment(tg.to, `${path}.to`, l)
			if (a !== undefined && z !== undefined && z < a) errors.push(`${path}: the trail runs backwards (from ${a} s to ${z} s)`)
		}
		if (tg.path !== undefined) errors.push(`${path}.path "${tg.path}": no module publishes its drawn routes yet (hoses, wires): travel {through: [targets]} along the items instead`)
		if (tg.through !== undefined) for (const [i, x] of [].concat(tg.through).entries()) checkTarget(x, `${path}.through[${i}]`, { lane })
		if (tg.gap !== undefined)
			for (const [i, g] of [].concat(tg.gap).entries()) if (!itemIn(g) && !roles.has(g)) errors.push(`${path}.gap[${i}] "${g}" is neither an item nor a lanes role${nearestText(g, [...allItems, ...roles.keys()])}`)
		if (tg.mark !== undefined) {
			const ids = roles.has(tg.mark) ? roles.get(tg.mark) : [tg.mark]
			const marked = runList.flatMap(([, r]) => r.marks.map((m) => m.item))
			for (const id of ids) if (!marked.includes(id)) errors.push(`${path}.mark "${tg.mark}": ${id} has no metre marks${marked.length ? ` (the marked lanes: ${[...new Set(marked)].join(", ")})` : " (no lane or ruler in this scene has marks)"}`)
		}
		if (pathOnly && tg.beam === undefined && tg.trail === undefined && tg.through === undefined && tg.path === undefined) errors.push(`${path} must be a path to travel along: a beam stretch {beam, from, to}, a trail {trail, from, to} or {through: [targets]}`)
	}
	const checkTargets = (list, path, o) => (Array.isArray(list) ? list.forEach((tg, i) => checkTarget(tg, `${path}[${i}]`, o)) : undefined)
	const isThing = (tg) => isObj(tg) && (tg.item !== undefined || tg.items !== undefined || tg.role !== undefined)

	// the story
	const beats = new Map()
	for (const [i, b] of (Array.isArray(plan.story) ? plan.story : []).entries()) {
		if (!isObj(b)) continue
		if (beats.has(b.id)) errors.push(`story[${i}].id "${b.id}" is used twice`)
		beats.set(b.id, b)
		checkTargets(b.evidence, `story[${i}] (${b.id}).evidence`)
	}

	// the shots
	const timing = []
	const ids = new Set()
	const shots = Array.isArray(plan.shots) ? plan.shots : []
	const anyRun = runList[0]?.[1]
	for (const [i, sh] of shots.entries()) {
		if (!isObj(sh)) continue
		const P = shotLabel(i)
		if (ids.has(sh.id)) errors.push(`${P}.id "${sh.id}" is used twice`)
		ids.add(sh.id)
		if (typeof sh.beat === "string" && !beats.has(sh.beat)) errors.push(`${P}.beat "${sh.beat}" is not a story beat (the beats: ${[...beats.keys()].join(", ")})`)
		const layout = sh.layout ?? (lanes ? "split" : "single")
		if ((sh.layout === "split" || sh.layout === "together") && !lanes) errors.push(`${P}.layout "${sh.layout}" needs the plan's lanes`)
		if (sh.arrange !== undefined && layout !== "split") warnings.push(`${P}.arrange only matters in a split layout`)
		if (sh.align !== undefined && !roles.has(sh.align)) errors.push(`${P}.align "${sh.align}" is not a cast role of the lanes${roles.size ? ` (roles: ${[...roles.keys()].join(", ")})` : ""}`)
		// the run window and the shot's length
		let t0, t1, seconds = null
		const run = isObj(sh.run) ? sh.run : null
		if (run && run.freeze !== undefined) {
			t0 = t1 = checkMoment(run.freeze, `${P}.run.freeze`)
			if (typeof run.seconds === "number") seconds = run.seconds
			else if (sh.move === "travel") seconds = travelSeconds(sh, digest)
			else seconds = 2 // (the compiler's default for a freeze with no seconds)
			if (seconds !== null) seconds += typeof run.hold_after === "number" ? run.hold_after : 0
			if (sh.move === "travel" && run.seconds === undefined && !sh.travel?.pace) errors.push(`${P}: a travel over a held moment needs run.seconds or travel.pace (how long the ride takes)`)
		} else if (run) {
			t0 = checkMoment(run.from, `${P}.run.from`)
			t1 = checkMoment(run.to, `${P}.run.to`)
			const rate = typeof run.rate === "number" && run.rate > 0 ? run.rate : 1
			if (t0 !== undefined && t1 !== undefined) {
				if (t1 < t0 - 1e-9) errors.push(`${P}.run plays backwards: from ${short(run.from)} (${r3(t0)} s) is after to ${short(run.to)} (${r3(t1)} s)`)
				else seconds = (t1 - t0) / rate + (typeof run.hold_after === "number" ? run.hold_after : 0)
			}
		}
		if (seconds !== null && seconds < MIN_SHOT_S - 1e-9) errors.push(`${P} lasts ${r3(seconds)} s of video: a shot must last at least ${MIN_SHOT_S} s (play a longer stretch, slow it down, or add hold_after)`)
		timing.push({ id: sh.id, t0: t0 === undefined ? null : r3(t0), t1: t1 === undefined ? null : r3(t1), seconds: seconds === null ? null : r3(seconds) })
		// what it looks at
		checkTarget(sh.subject, `${P}.subject`)
		checkTargets(sh.keep, `${P}.keep`)
		checkTargets(sh.context, `${P}.context`)
		if (sh.move === "follow" && !isThing(sh.subject)) errors.push(`${P}: a follow moves with a thing: its subject must be an item, items or a role, not ${short(sh.subject)}`)
		if (isObj(sh.follow)) {
			if (sh.move !== "follow") warnings.push(`${P}.follow is only read by a follow`)
			if (sh.follow.stop_at !== undefined) checkTarget(sh.follow.stop_at, `${P}.follow.stop_at`)
			if (sh.follow.per_lane && !(layout === "split" && isObj(sh.subject) && sh.subject.role !== undefined)) errors.push(`${P}.follow.per_lane needs a split layout and a role subject (each band follows its own lane's copy)`)
		}
		if (isObj(sh.travel)) {
			if (sh.move !== "travel") warnings.push(`${P}.travel is only read by a travel`)
			checkTarget(sh.travel.path, `${P}.travel.path`, { pathOnly: true })
			if (sh.travel.reveal && sh.travel.path?.beam === undefined) errors.push(`${P}.travel.reveal draws light as the camera travels: it needs a beam path`)
			if (sh.travel.dwell !== undefined && sh.travel.path?.through === undefined) warnings.push(`${P}.travel.dwell only rests at the points of a through path`)
		}
		if (isObj(sh.end)) {
			if (!["push", "pull", "arc"].includes(sh.move)) warnings.push(`${P}.end is only read by a push, pull or arc`)
			if (sh.end.subject !== undefined) checkTarget(sh.end.subject, `${P}.end.subject`)
			checkTargets(sh.end.keep, `${P}.end.keep`)
		}
		if (isObj(sh.inset)) checkTarget(sh.inset.subject, `${P}.inset.subject`)
		// marks
		for (const [j, a] of (Array.isArray(sh.annotate) ? sh.annotate : []).entries()) {
			if (!isObj(a)) continue
			const A = `${P}.annotate[${j}] (${a.kind})`
			checkTarget(a.on, `${A}.on`)
			for (const k of ["from", "to", "since"]) if (a[k] !== undefined) checkMoment(a[k], `${A}.${k}`)
			const on = isObj(a.on) ? a.on : {}
			if ((a.kind === "normal" || a.kind === "angle") && !(on.beam !== undefined && on.bounce !== undefined)) errors.push(`${A}: a${a.kind === "angle" ? "n angle" : " normal"} is drawn at a bounce: on must be {beam, bounce}`)
			if (a.kind === "finish-mark" && on.mark === undefined) errors.push(`${A}: a finish-mark is drawn at a metre mark: on must be {mark, m}`)
			if (a.kind === "trail" && on.trail === undefined) errors.push(`${A}: a trail mark draws a path: on must be {trail, from, to}`)
			if (a.kind === "start-mark" && on.when === undefined) errors.push(`${A}: a start-mark outlines where a thing was: give on.when (the moment it started, e.g. "start")`)
			if (a.kind === "distance" && !(on.gap !== undefined || isThing(on))) errors.push(`${A}: a distance is drawn across a gap {gap: [a, b]} or along one thing`)
			const text = typeof a.text === "string" ? a.text : ""
			if (/\{(in|out)\}/.test(text) && a.kind !== "angle") errors.push(`${A}.text uses {in}/{out}: only an angle mark has them`)
			if (/\{dt\}/.test(text) && (a.since === undefined || a.from === undefined)) errors.push(`${A}.text uses {dt}: give since and from (the seconds between them)`)
			if (/\{label\}/.test(text) && !lanes) errors.push(`${A}.text uses {label}: only lanes have labels`)
			for (const ph of text.match(/\{[a-z_]+\}/g) ?? []) if (!["{in}", "{out}", "{value}", "{m}", "{label}", "{s}", "{dt}"].includes(ph)) errors.push(`${A}.text: ${ph} is not a measured number (use {in}, {out}, {value}, {m}, {label}, {s} or {dt})`)
		}
		// the audit
		if (isObj(sh.audit)) {
			checkTargets(sh.audit.must_see, `${P}.audit.must_see`)
			checkTargets(sh.audit.details, `${P}.audit.details`)
			const key = sh.audit.key
			if (key !== undefined && !["start", "middle", "end"].includes(key)) {
				const tk = checkMoment(key, `${P}.audit.key`)
				if (tk !== undefined && t0 !== undefined && t1 !== undefined && (tk < t0 - 0.05 || tk > t1 + 0.05)) errors.push(`${P}.audit.key ${short(key)} is at ${r3(tk)} s, outside the shot's run ${r3(t0)}..${r3(t1)} s`)
			}
			if (sh.audit.min_size !== undefined && sh.audit.min_size < 0.045 && !sh.audit.small_because) warnings.push(`${P}.audit.min_size ${sh.audit.min_size} is under the floor: it is ignored without small_because`)
		}
	}
	// a lock: one frame through the lesson's last pause (web/export/shots.js lockedThrough)
	if (isObj(plan.lock) && plan.lock.until !== "end" && !(Array.isArray(plan.story) && plan.story.some((b) => isObj(b) && b.kind === "pause"))) warnings.push("lock: the story has no pause beat, so every shot is filmed from the lock's one frame")
	const known = timing.every((x) => x.seconds !== null)
	const total = known ? r3(timing.reduce((s, x) => s + x.seconds, 0)) : null
	const max = plan.output?.max_seconds
	if (typeof max === "number" && total !== null && total > max + 0.05) errors.push(`the plan lasts ${total} s of video; output.max_seconds is ${max}`)
	if (anyRun && !runList.length) errors.push("the digest has no run")
	return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], timing: { shots: timing, seconds: total } }
}
const r3 = (v) => Math.round(v * 1000) / 1000

/** A travel's video seconds from its pace, as the compiler works it out (length / (speed x 0.8), plus its dwells), when the path's length is
 *  known from the digest (a beam stretch, a through path of items); null otherwise (the engine works it out). */
function travelSeconds(sh, digest) {
	const tv = sh.travel
	if (!isObj(tv)) return null
	if (isObj(tv.pace) && typeof tv.pace.seconds === "number") return tv.pace.seconds
	const speed = isObj(tv.pace) && typeof tv.pace.speed === "number" ? tv.pace.speed : null
	if (!speed) return 2
	const path = tv.path
	let pts = null
	if (isObj(path) && typeof path.beam === "string") {
		const b = Object.values(digest.runs).map((r) => r.beams.find((x) => x.source === path.beam)).find(Boolean)
		const tr = b?.traces?.[0]
		if (!tr) return null
		const P = tr.pts
		const idx = (s, def) => (s === undefined ? def : s === "source" ? 0 : s === "end" ? P.length - 1 : /^bounce:/.test(s) ? Number(s.slice(7)) : /^hit:/.test(s) ? tr.ends.indexOf(s.slice(4)) + 1 : def)
		pts = P.slice(idx(path.from, 0), idx(path.to, P.length - 1) + 1)
	} else if (isObj(path) && Array.isArray(path.through)) {
		const centre = (tg) => {
			const id = tg?.item ?? (Array.isArray(tg?.items) && tg.items.length === 1 ? tg.items[0] : null)
			const c = id ? Object.values(digest.runs).map((r) => r.cast.find((x) => x.id === id)).find(Boolean) : null
			if (c) return [(c.box0[0] + c.box0[1]) / 2, (c.box0[2] + c.box0[3]) / 2]
			if (Array.isArray(tg?.point)) return tg.point
			return null
		}
		pts = path.through.map(centre)
		if (pts.some((p) => !p)) return null
	} else return null
	let L = 0
	for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
	const legs = Math.max(0, pts.length - 1)
	return L / (speed * 0.8) + (Array.isArray(path.through) ? (tv.dwell ?? 0) * legs : 0)
}

// ------------------------------------------------------------------------------------------------ the validator
/**
 * A shot plan the engine can film: valid against the schema and resolved against the digest. ctx.digest is required for the resolution (with
 * no digest only the structure is checked); ctx.lanes: lanes the caller fixed, which the plan must keep. -> {ok, errors, warnings, value, timing}
 */
export function validateShotPlan(value, ctx = {}) {
	const warnings = []
	if (!isObj(value)) return { ok: false, errors: ["the answer must be one JSON object: the shot plan"], warnings, value }
	const v = JSON.parse(JSON.stringify(value))
	if (v.$schema !== undefined) delete v.$schema
	if (v.version === undefined) {
		v.version = 1
		warnings.push("version was missing: set to 1")
	}
	const errors = checkShotPlanSchema(v)
	let timing = null
	if (ctx.digest) {
		// (names are resolved even when the structure has problems, so one repair turn hears about both)
		try {
			const r = resolveShotPlan(v, ctx.digest, { lanes: ctx.lanes ?? null })
			errors.push(...r.errors)
			warnings.push(...r.warnings)
			timing = r.timing
		} catch (e) {
			errors.push(`the plan could not be resolved against the run: ${e.message}`)
		}
	}
	return { ok: errors.length === 0, errors: [...new Set(errors)], warnings, value: v, timing }
}
