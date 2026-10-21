// Goals: the outcomes a request states ("lands in the cup", "topple them", "hit the box", "push the cart along"), in a form a run can check.
// Pure functions, no imports: web/ai (the browser) may copy this file as it is, so the critic, the panel and the tuner judge a goal the same way.
//
//   kind "in"     {item, container}            the item ends between the container's walls (a box, cup, bucket or basket: web/sim inside(),
//                                              which the engine's summary already checks for the scene's own goals)
//   kind "falls"  {item | items: [id]}         every one of those things ends fallen: each rigid body of each item (each domino of a
//                                              domino row, each block of a tower, a bowling pin's six welded parts as one) ends turned past
//                                              its own tipping angle from how it started (tipAngle: atan(base / height) of its outline at the
//                                              start, + 5°, at least 20°, at most 85°: a domino of thickness h/6 tips at 9.5°, so one leaning
//                                              40° on the next, as a finished cascade leaves it, has fallen; a cube must turn 50°), or knocked
//                                              down (its middle ends at least half its smaller side, and 2 cm, lower: a cube pushed off a
//                                              tower may land flat, a quarter turn looking the same as none). Hinged parts (a pendulum's rod)
//                                              and round ones (a car's wheels) do not count when the item has other bodies, and a body on
//                                              wheels must tip over (a car that drove down a ramp has not fallen). The count is of bodies:
//                                              "5 of 7 fell" for a row of 7, "7 of 10 fell" for 10 pins.
//   kind "hits"   {item, target, before_s?}    something of item touches something of target during the run (an impact), by before_s if given
//   kind "moves"  {item, min_m}                the item ends at least min_m from where it started (the mean of its moving parts)
//   kind "off"    {item}                       the item ends off the table: the mean of its moving parts past the table top's ends, or below
//                                              its top (it fell off the edge: "blows the ping-pong ball off the edge", "knocks it onto the floor")
//
//   checkGoals(goals, {doc, track, summary})   -> [{label, kind, ok: true | false | null (cannot tell from what was given), detail, ...ids}]
//   With doc + track (a whole run, as /api/simulate answers it) every kind is exact. With only a summary ({goals, stories, events}): "in" from
//   the engine's own goal check, "falls" for a domino row from its story ("5 of 7 fall": the engine counts a domino that turned over 57°),
//   "hits" from the first hits (the summary keeps the first 16 pairs), "moves" and "off" only when the item never moved, or from the engine's
//   own check of the goal; otherwise ok is null.
//   A physics module's goal kinds (melts, floats, lights, reads, ...: web/sim/plugins.js) are checked here too, by the module's own rule, on a
//   whole run (doc + track), or from the engine's summary of the scene's own goal of that kind; allGoalKinds() lists them with these.
export const GOAL_KINDS = ["in", "falls", "hits", "moves", "off"]
// (the modules' registry, web/sim/plugins.js, kept on globalThis so this file imports nothing: filled wherever web/sim/index.js was loaded)
const plugged = () => globalThis[Symbol.for("sandbox.plugins")] ?? null
/** A module's goal kind by its kind or one of its spellings (web/sim/plugins.js goalKind), or undefined. */
export function moduleGoal(kind) {
	const S = plugged()
	if (!S || typeof kind !== "string") return undefined
	return S.goals.get(kind) ?? S.goals.get(S.aliases.get(kind.toLowerCase()) ?? "")
}
/** Every goal kind a plan may use: the five above and the loaded modules' (in their module order). */
export function allGoalKinds() {
	const S = plugged()
	if (!S) return [...GOAL_KINDS]
	const mods = [...S.modules.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
	return [...GOAL_KINDS, ...mods.flatMap((m) => (m.goals ?? []).map((k) => k.kind))]
}
const itemFields = (spec, subject) => {
	const all = Object.entries(spec?.fields ?? {}).filter(([, t]) => /^items?\??$/.test(String(t))).map(([f]) => f)
	if (!subject) return all
	return Array.isArray(spec.subject) && spec.subject.length ? spec.subject : all.slice(0, 1)
}
const idsOf = (g, fields) => fields.flatMap((f) => (Array.isArray(g?.[f]) ? g[f] : typeof g?.[f] === "string" ? [g[f]] : []))
/** The fields a module's goal kind takes: {field: "item" | "items" | "number" | "string" | "bool", with "?" when optional}. */
export const moduleGoalFields = (kind) => ({ ...(moduleGoal(kind)?.fields ?? {}) })
/** What a goal of a module kind is missing or has wrong, or null. has(id): whether the plan or scene has that item. */
export function moduleGoalProblem(g, has = () => true) {
	const mod = moduleGoal(g?.kind)
	if (!mod) return `no goal kind "${g?.kind}"`
	for (const [f, t0] of Object.entries(mod.fields ?? {})) {
		const opt = String(t0).endsWith("?")
		const t = String(t0).replace(/\?$/, "")
		const v = g[f]
		if (v === undefined || v === null) {
			if (!opt) return `a "${mod.kind}" goal needs ${f} (${t === "item" ? "an item id" : t === "items" ? "a list of item ids" : t})`
			continue
		}
		if (t === "item" && (typeof v !== "string" || !has(v))) return `${f}: "${v}" is not an item of the plan`
		if (t === "items" && (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== "string" || !has(x)))) return `${f} must list items of the plan`
		if (t === "number" && !(typeof v === "number" && Number.isFinite(v))) return `${f} must be a number`
		if (t === "string" && typeof v !== "string") return `${f} must be text`
		if (t === "bool" && typeof v !== "boolean") return `${f} must be true or false`
	}
	for (const f of Object.keys(g)) if (!["kind", "label", ...Object.keys(mod.fields ?? {})].includes(f)) return `a "${mod.kind}" goal has no ${f} (its fields: ${Object.keys(mod.fields ?? {}).join(", ")})`
	return null
}
/** The least and the most a part must turn to count as fallen, and the margin past its geometric tipping angle (degrees). */
export const FALL_MIN_DEG = 20
export const FALL_MAX_DEG = 85
export const FALL_MARGIN_DEG = 5
const R2D = 180 / Math.PI

/** A goal's kind: its own, else read from its fields (a container: "in"; a target: "hits"; min_m: "moves"; items: "falls"). */
export function goalKind(g) {
	if (g && GOAL_KINDS.includes(g.kind)) return g.kind
	const mod = moduleGoal(g?.kind)
	if (mod) return mod.kind
	if (g?.container) return "in"
	if (g?.target) return "hits"
	if (g?.min_m !== undefined) return "moves"
	if (Array.isArray(g?.items)) return "falls"
	return "in"
}
/** The item ids a goal is about (the thing that must fall, move, hit or land; not the container or the target). */
export const goalItems = (g) => {
	const mod = GOAL_KINDS.includes(g?.kind) ? undefined : moduleGoal(g?.kind)
	if (mod) return idsOf(g, itemFields(mod, true))
	return Array.isArray(g?.items) && g.items.length ? [...g.items] : g?.item ? [g.item] : []
}
/** Every item id a goal names (its items, the container, the target). */
export const goalRefs = (g) => {
	const mod = GOAL_KINDS.includes(g?.kind) ? undefined : moduleGoal(g?.kind)
	if (mod) return [...new Set(idsOf(g, itemFields(mod, false)))]
	return [...goalItems(g), ...(g?.container ? [g.container] : []), ...(g?.target ? [g.target] : [])]
}

/** A plain label for a goal that has none. names: id -> what the user calls it. A module's goal is said as its run's summary says it
 *  (summaryWords: its thresholds, deadlines and an `expect: false`, "Unheated balloon does not rise 5 cm"), else by the module's label(). */
export function goalLabel(g, names = {}) {
	const n = (id) => names[id] ?? id
	const k = goalKind(g)
	const mod = GOAL_KINDS.includes(k) ? undefined : moduleGoal(k)
	if (mod) {
		const said = summaryWords(mod, g, n)
		if (said) return said
		try {
			if (typeof mod.label === "function") return String(mod.label(g, n))
		} catch {}
		return `${n(goalItems(g)[0] ?? "?")} ${mod.kind.replace(/_/g, " ")}`
	}
	const its = goalItems(g)
	const who = its.length > 1 ? `all ${its.length} of ${its.slice(0, 3).map(n).join(", ")}${its.length > 3 ? "…" : ""}` : n(its[0] ?? "?")
	if (k === "in") return `${who} lands in ${n(g.container)}`
	if (k === "falls") return `${who} ${its.length > 1 ? "fall" : "falls"} over`
	if (k === "hits") return `${who} hits ${n(g.target)}${Number.isFinite(g.before_s) ? ` by ${g.before_s} s` : ""}`
	if (k === "off") return `${who} ends off the table`
	return `${who} moves at least ${fmtM(g.min_m)}`
}
const fmtM = (m) => (Number.isFinite(m) ? (m >= 1 ? `${+m.toFixed(2)} m` : `${+(m * 100).toFixed(1)} cm`) : "?")
/**
 * A module goal's words as the summary of its run gives them to a goal without a label: its kind's summarize on a run with nothing in it
 * (web/sim/items.js GoalCtx through the registry's goalCtx, every reading there but empty; that label is made from the goal's own fields),
 * or null when the kind says nothing without a run, or nothing whole ("nan g"): a module's label() then. A label minted from the kind alone
 * said the opposite of an `expect: false` goal ("Unheated balloon rises" for {lifts_off, expect: false}, reported "yes" while it sat on its
 * stand) and left out its numbers ("rises" for at least 50 cm).
 */
function summaryWords(mod, g, n) {
	const S = plugged()
	if (typeof S?.goalCtx !== "function" || typeof mod.summarize !== "function") return null
	try {
		const goal = { ...g, kind: mod.kind }
		delete goal.label
		const scene = { items: goalRefs(goal).map((id) => ({ id: String(id), name: String(n(id)) })), goals: [] }
		const ctx = S.goalCtx(scene, { solids: [], processes: [] }, { frames: [{ t: 0, placements: {} }] })
		ctx.state = () => []
		const entry = mod.summarize(ctx, goal)
		const said = typeof entry?.label === "string" ? entry.label.trim() : ""
		return said && !/\b(undefined|nan|null|infinity)\b/i.test(said) ? said : null
	} catch {
		return null
	}
}
const wrapDeg = (rad) => {
	let d = (rad * R2D) % 360
	if (d > 180) d -= 360
	if (d < -180) d += 360
	return Math.abs(d)
}

/** The goals' results in a run. run = {doc?, track?, summary?}: see the header. */
export function checkGoals(goals, run = {}) {
	const out = []
	const doc = run.doc ?? null
	const track = run.track ?? null
	const summary = run.summary ?? run.sim?.summary ?? null
	const exact = !!(doc?.solids && track?.frames?.length)
	let T = null
	if (exact) T = trackTools(doc, track)
	for (const g of Array.isArray(goals) ? goals : []) {
		if (!g || typeof g !== "object") continue
		const kind = goalKind(g)
		const label = typeof g.label === "string" && g.label.trim() ? g.label.trim() : goalLabel(g)
		const base = { label, kind, item: g.item ?? null, ...(g.items ? { items: g.items } : {}), ...(g.container ? { container: g.container } : {}), ...(g.target ? { target: g.target } : {}) }
		let r
		const mod = GOAL_KINDS.includes(kind) ? undefined : moduleGoal(kind)
		if (mod) {
			// (a module's goal: its own fields kept on the result, judged by its rule on the whole run, else from the engine's summary of it)
			for (const f of Object.keys(mod.fields ?? {})) if (g[f] !== undefined && !(f in base)) base[f] = g[f]
			out.push({ ...base, ...moduleResult(mod, g, run, exact, summary) })
			continue
		}
		try {
			if (!goalItems(g).length || (kind === "hits" && !g.target) || (kind === "in" && !g.container)) r = { ok: null, detail: "the goal does not name its items" }
			else r = kind === "in" ? inGoal(g, summary, exact ? run : null) : exact ? exactGoal(kind, g, T) : summaryGoal(kind, g, summary)
		} catch (e) {
			r = { ok: null, detail: `could not be checked (${e?.message ?? e})` }
		}
		out.push({ ...base, ...r })
	}
	return out
}

function moduleResult(mod, g, run, exact, summary) {
	if (!goalItems({ ...g, kind: mod.kind }).length) return { ok: null, detail: "the goal does not name its items" }
	const S = plugged()
	if (exact && typeof S?.goalCtx === "function") {
		try {
			const entry = mod.summarize(S.goalCtx(run.scene ?? null, run.doc, run.track), { ...g, kind: mod.kind })
			if (!entry) return { ok: null, detail: "the goal names an item the run does not have" }
			const t = Number.isFinite(entry.t) ? ` (at ${entry.t} s)` : ""
			// (a module's own words for its result, when it has them: lesson time, the readings compared)
			const said = typeof mod.detail === "function" ? mod.detail(entry) : null
			return { ok: !!entry.ok, detail: typeof said === "string" && said ? said : `${entry.ok ? "yes" : "no"}${t}`, ...(entry.t !== undefined ? { t: entry.t } : {}) }
		} catch (e) {
			return { ok: null, detail: `could not be checked (${e?.message ?? e})` }
		}
	}
	const own = (summary?.goals ?? []).find((x) => x?.kind === mod.kind && goalItems({ ...x, kind: mod.kind }).join() === goalItems({ ...g, kind: mod.kind }).join())
	if (own && typeof own.ok === "boolean") return { ok: own.ok, detail: own.ok ? "yes" : "no" }
	return { ok: null, detail: "cannot tell from the run's summary" }
}

function inGoal(g, summary, run = null) {
	const s = (summary?.goals ?? []).find((x) => x && x.item === g.item && x.container === g.container)
	if (!s) {
		// (a container the engine doesn't check, a plastic cup, a glass jar or a coffee mug: by its walls in the run, at the end)
		const w = run ? wallsInside(g, run) : null
		if (w !== null) return { ok: w, detail: w ? "it ends inside" : "it does not end inside" }
		return { ok: null, detail: "not checked by the engine (the container is not a box, cup, bucket or basket, or the goal was left out of the scene)" }
	}
	return { ok: !!s.ok, detail: s.ok ? "it ends inside" : "it does not end inside" }
}
/** Does the goal's thing end between a container's own walls (its "left" and "right" parts, above its "floor", below their tops)? Every moving
 *  solid of it, at the run's last frame. null when the container has no such parts. */
export function wallsInside(g, run) {
	const solids = run?.doc?.solids ?? []
	const last = run?.track?.frames?.at(-1)?.placements ?? null
	if (!last) return null
	const part = (name) => solids.find((x) => x.item === g.container && (x.part === name || String(x.id).endsWith(`/${name}`)))
	const L = part("left")
	const R = part("right")
	const F = part("floor")
	if (!L || !R || !F) return outlineInside(g, run, solids, last)
	const pose = (x) => last[x.id] ?? (x.at ? { x: x.at.x, y: x.at.y, angle: x.angle ?? 0 } : null)
	const pl = pose(L)
	const pr = pose(R)
	const pf = pose(F)
	if (!pl || !pr || !pf) return null
	// (a wall's inner face at a height: along its tilted middle line)
	const faceAt = (p, b, y, side) => p.x - (y - p.y) * Math.tan(p.angle ?? 0) + side * (b.width ?? 0) / 2
	const top = Math.min(pl.y + (L.body?.height ?? 0) / 2, pr.y + (R.body?.height ?? 0) / 2)
	const floor = pf.y + (F.body?.height ?? 0) / 2
	const mine = solids.filter((x) => x.item === g.item && x.kind === "dynamic")
	if (!mine.length) return null
	for (const m of mine) {
		const p = last[m.id]
		if (!p) return false
		const r = m.body?.radius ?? 0
		if (p.y - r < floor - 0.005 || p.y - r > top) return false
		if (p.x < faceAt(pl, L.body ?? {}, p.y, 1) || p.x > faceAt(pr, R.body ?? {}, p.y, -1)) return false
	}
	return true
}
/** The same for a container whose walls are outlines (a coffee mug: "wall-left", "wall-right" and its "body" under them): every moving solid
 *  of the thing between the walls' inner sides, above the body's top, at the run's last frame. null when it has no such parts. */
function outlineInside(g, run, solids, last) {
	const part = (re) => solids.find((x) => x.item === g.container && re.test(String(x.part ?? String(x.id).split("/").pop())))
	const L = part(/^wall-left$/)
	const R = part(/^wall-right$/)
	const F = part(/^(body|base|bottom)$/)
	if (!L || !R || !F) return null
	const at = (x) => last[x.id] ?? (x.at ? { x: x.at.x, y: x.at.y, angle: x.angle ?? 0 } : null)
	const pts = (x) => {
		const p = at(x)
		const b = x.body ?? {}
		if (!p) return []
		const loc = b.kind === "polygon" && Array.isArray(b.points) ? b.points.map((q) => [q.x, q.y]) : b.kind === "slab" ? [[-(b.width ?? 0) / 2, -(b.height ?? 0) / 2], [(b.width ?? 0) / 2, (b.height ?? 0) / 2]] : []
		const c = Math.cos(p.angle ?? 0)
		const n = Math.sin(p.angle ?? 0)
		return loc.map(([u, v]) => [p.x + u * c - v * n, p.y + u * n + v * c])
	}
	const l = pts(L)
	const r = pts(R)
	const f = pts(F)
	if (!l.length || !r.length || !f.length) return null
	const inL = Math.max(...l.map((q) => q[0]))
	const inR = Math.min(...r.map((q) => q[0]))
	const top = Math.min(Math.max(...l.map((q) => q[1])), Math.max(...r.map((q) => q[1])))
	const floor = Math.max(...f.map((q) => q[1]))
	const mine = solids.filter((x) => x.item === g.item && x.kind === "dynamic")
	if (!mine.length || !(inR > inL)) return null
	for (const m of mine) {
		const p = last[m.id]
		if (!p) return false
		const rad = m.body?.radius ?? 0
		if (p.y - rad < floor - 0.01 || p.y - rad > top || p.x < inL || p.x > inR) return false
	}
	return true
}

function exactGoal(kind, g, T) {
	if (kind === "falls") {
		let n = 0
		let down = 0
		const standing = []
		for (const id of goalItems(g)) {
			const groups = T.bodies(id)
			if (!groups.length) {
				standing.push(id)
				continue
			}
			let itemDown = true
			for (const b of groups) {
				n++
				if (T.fell(b)) down++
				else itemDown = false
			}
			if (!itemDown) standing.push(id)
		}
		if (!n) return { ok: false, detail: "nothing of it can move" }
		return { ok: down === n, detail: `${down} of ${n} fell (tipped past their balance point or knocked down)`, fallen: down, of: n, ...(standing.length && standing.length < 6 ? { standing } : {}) }
	}
	if (kind === "hits") {
		const a = new Set(T.solidsOf(g.item))
		const b = new Set(T.solidsOf(g.target))
		let first = null
		for (const h of T.impacts) {
			if ((a.has(h.a) && b.has(h.b)) || (a.has(h.b) && b.has(h.a))) {
				if (first === null || h.t < first.t) first = h
			}
		}
		const by = Number.isFinite(g.before_s) ? g.before_s : Infinity
		if (!first) return { ok: false, detail: "they never touch" }
		const t = Math.round(first.t * 100) / 100
		return { ok: first.t <= by, detail: first.t <= by ? `first touch at ${t} s${Number.isFinite(first.speed) ? ` (${Math.round(first.speed * 100) / 100} m/s)` : ""}` : `first touch at ${t} s, after ${by} s`, t }
	}
	if (kind === "moves") {
		const sids = T.moving(g.item)
		if (!sids.length) return { ok: false, detail: "nothing of it can move" }
		const c0 = mid(sids.map((s) => T.start(s)))
		const c1 = mid(sids.map((s) => T.end(s)))
		const d = c0 && c1 ? Math.hypot(c1.x - c0.x, c1.y - c0.y) : 0
		const min = Number.isFinite(g.min_m) ? g.min_m : 0.05
		return { ok: d >= min, detail: `ends ${fmtM(d)} from where it started (needs ${fmtM(min)})`, moved_m: Math.round(d * 1e4) / 1e4 }
	}
	if (kind === "off") {
		const sids = T.moving(g.item)
		if (!sids.length) return { ok: false, detail: "nothing of it can move" }
		const top = T.tableTop()
		if (!top) return { ok: null, detail: "there is no table to leave" }
		const c1 = mid(sids.map((s) => T.end(s)))
		if (!c1) return { ok: null, detail: "could not be checked" }
		const past = c1.x < top.x0 ? "past the table's left end" : c1.x > top.x1 ? "past the table's right end" : null
		const below = c1.y < top.y - 0.01
		const ok = !!past || below
		return { ok, detail: ok ? `it ends ${past ?? "below the table top"}` : `it stays over the table, ${fmtM(Math.min(c1.x - top.x0, top.x1 - c1.x))} in from its ${c1.x - top.x0 < top.x1 - c1.x ? "left" : "right"} end`, end_x: Math.round(c1.x * 1e4) / 1e4 }
	}
	return { ok: null, detail: `unknown goal kind ${kind}` }
}

function summaryGoal(kind, g, summary) {
	const stories = new Map((summary?.stories ?? []).map((s) => [s.item, s]))
	if (kind === "falls") {
		let all = true
		const parts = []
		for (const id of goalItems(g)) {
			const st = stories.get(id)
			const m = /(\d+) of (\d+) fall/.exec(st?.text ?? "")
			if (m) {
				parts.push(`${m[1]} of ${m[2]}`)
				if (m[1] !== m[2]) return { ok: false, detail: `${parts.join(", ")} fell` }
			} else if (st && st.moved_at == null) return { ok: false, detail: `${id} never moves` }
			else all = false
		}
		return all ? { ok: true, detail: `${parts.join(", ")} fell` } : { ok: null, detail: "cannot tell from the run's summary (no end angles)" }
	}
	if (kind === "hits") {
		const ev = (summary?.events ?? []).find((e) => (e.a === g.item && e.b === g.target) || (e.a === g.target && e.b === g.item))
		const by = Number.isFinite(g.before_s) ? g.before_s : Infinity
		if (ev) return { ok: ev.t <= by, detail: `first touch at ${ev.t} s`, t: ev.t }
		if ((summary?.events ?? []).length < 16) return { ok: false, detail: "they never touch" }
		return { ok: null, detail: "not among the first hits the summary keeps" }
	}
	if (kind === "moves" || kind === "off") {
		const st = stories.get(g.item)
		if (st && st.moved_at == null) return { ok: false, detail: "it never moves" }
		// (the engine's own check of it, when the scene carried the goal)
		const own = (summary?.goals ?? []).find((x) => x?.kind === kind && x.item === g.item)
		if (own && typeof own.ok === "boolean") return { ok: own.ok, detail: own.ok ? "it ends off the table" : "it ends on the table" }
		return { ok: null, detail: kind === "off" ? "cannot tell where it ends from the run's summary" : "cannot tell how far from the run's summary" }
	}
	return { ok: null, detail: `unknown goal kind ${kind}` }
}

const mid = (ps) => {
	const v = ps.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
	if (!v.length) return null
	return { x: v.reduce((s, p) => s + p.x, 0) / v.length, y: v.reduce((s, p) => s + p.y, 0) / v.length }
}

/** Lookups over a run: an item's solids, its moving ones, a solid's first and last placement, the impacts. A static solid that never moves is
 *  listed only in frames[0] (CONTRACT.md "One run"), so a missing placement falls back to the last one seen. */
function trackTools(doc, track) {
	const byItem = new Map()
	const movingBy = new Map()
	for (const s of doc.solids) {
		if (!byItem.has(s.item)) byItem.set(s.item, [])
		byItem.get(s.item).push(s.id)
		if (s.kind === "dynamic") {
			if (!movingBy.has(s.item)) movingBy.set(s.item, [])
			movingBy.get(s.item).push(s.id)
		}
	}
	const frames = track.frames
	const f0 = frames[0]?.placements ?? {}
	const end = (sid) => {
		for (let k = frames.length - 1; k >= 0; k--) {
			const p = frames[k].placements?.[sid]
			if (p) return p
		}
		return null
	}
	const solidById = new Map(doc.solids.map((s) => [s.id, s]))
	/** A solid's outline points in the world at a placement (a ball: its four extreme points). */
	const worldPts = (s, pose) => {
		const b = s.body
		if (!b || !pose) return []
		let pts
		if (b.kind === "ball") pts = [[-b.radius, 0], [b.radius, 0], [0, -b.radius], [0, b.radius]]
		else if (b.kind === "slab") {
			const hw = (b.width ?? 0) / 2
			const hh = (b.height ?? 0) / 2
			const hb = hw * (b.taper ?? 1)
			pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
		} else if (b.kind === "polygon" && Array.isArray(b.points)) pts = b.points.map((p) => [p.x, p.y])
		else return []
		const c = Math.cos(pose.angle ?? 0)
		const n = Math.sin(pose.angle ?? 0)
		return pts.map(([x, y]) => [pose.x + x * c - y * n, pose.y + x * n + y * c])
	}
	/** The weld group a solid belongs to: up its parent chain while the link is a weld (a parent and no pivot). */
	const rootOf = (s) => {
		let r = s
		for (let k = 0; k < 50 && r.parent && !r.pivot && solidById.has(r.parent); k++) r = solidById.get(r.parent)
		return r
	}
	// the solids a pin, a rope or chain, or a pulley holds: their weld groups hang or swing, they do not fall over (machines/items.py _Fall)
	const held = new Set((doc.joints ?? []).filter((j) => ["pin", "rope", "pulley"].includes(j.kind)).flatMap((j) => [j.a, j.b]).filter((x) => x != null))
	const groupsBy = new Map() // item id -> [{root, members: [solid]}]
	for (const s of doc.solids) {
		if (s.kind !== "dynamic") continue
		const r = rootOf(s)
		const list = groupsBy.get(s.item) ?? groupsBy.set(s.item, []).get(s.item)
		let gr = list.find((x) => x.root === r)
		if (!gr) list.push((gr = { root: r, members: [] }))
		gr.members.push(s)
	}
	/** An item's rigid bodies that can fall: weld groups that are not hinged (to the world or to a parent: a pendulum's rod, a lever's
	 *  plank) nor held by a pin, a rope or a pulley (a swing's seat, an Atwood machine's weights); round ones (a car's wheels) only when the item has nothing else. Each with its outline box at the start. */
	const bodiesCache = new Map()
	const bodiesOf = (id) => {
		if (bodiesCache.has(id)) return bodiesCache.get(id)
		const all = (groupsBy.get(id) ?? []).filter((gr) => !gr.root.pivot && !gr.members.some((m) => held.has(m.id)))
		const round = (gr) => gr.members.every((m) => m.body?.kind === "ball")
		const keep = all.some((gr) => !round(gr)) ? all.filter((gr) => !round(gr)) : all
		const out = keep.map((gr) => {
			const pts = gr.members.flatMap((m) => worldPts(m, f0[m.id]))
			const xs = pts.map((p) => p[0])
			const ys = pts.map((p) => p[1])
			const w = pts.length ? Math.max(...xs) - Math.min(...xs) : 0
			const h = pts.length ? Math.max(...ys) - Math.min(...ys) : 0
			// a body on wheels (its item has round parts left out: a car's wheels) rolls down slopes: only tipping over counts for it
			return { ...gr, w, h, round: round(gr), wheeled: keep.length < all.length }
		})
		bodiesCache.set(id, out)
		return out
	}
	const midY = (members, at) => {
		const ys = members.map((m) => at(m.id)?.y).filter(Number.isFinite)
		return ys.length ? ys.reduce((a, y) => a + y, 0) / ys.length : NaN
	}
	/** How far (degrees) a body must turn from its start to have fallen: past the angle at which it would tip over its base edge
	 *  (atan(base / height) of its outline at the start), plus a margin, within FALL_MIN_DEG…FALL_MAX_DEG. */
	const tipAngle = (b) => (b.w > 0 && b.h > 0 ? Math.min(FALL_MAX_DEG, Math.max(FALL_MIN_DEG, Math.atan(b.w / b.h) * R2D + FALL_MARGIN_DEG)) : 45)
	/** Has this body fallen: turned past its tipping angle (not for a round one), or knocked down at least half its smaller side and 2 cm? */
	const fell = (b) => {
		const a0 = f0[b.root.id]?.angle
		const a1 = end(b.root.id)?.angle
		const turned = !b.round && Number.isFinite(a0) && Number.isFinite(a1) ? wrapDeg(a1 - a0) : 0
		const dropped = midY(b.members, (sid) => f0[sid]) - midY(b.members, end)
		return turned > tipAngle(b) || (!b.wheeled && Number.isFinite(dropped) && dropped >= Math.max(0.02, Math.min(b.w, b.h) / 2))
	}
	/** The table top: {y (its top), x0, x1} (the solid of the item whose type is "table"), or null. */
	const tableTop = () => {
		const t = doc.solids.find((s) => s.itemType === "table" && (s.part === "top" || String(s.id).endsWith("/top"))) ?? doc.solids.find((s) => s.item === "table")
		if (!t || t.body?.kind !== "slab") return null
		const p = f0[t.id] ?? t.at
		if (!p) return null
		return { y: p.y + (t.body.height ?? 0) / 2, x0: p.x - (t.body.width ?? 0) / 2, x1: p.x + (t.body.width ?? 0) / 2 }
	}
	return { solidsOf: (id) => byItem.get(id) ?? [], moving: (id) => movingBy.get(id) ?? [], start: (sid) => f0[sid] ?? null, end, impacts: track.impacts ?? [], bodies: bodiesOf, fell, tipAngle, tableTop }
}
