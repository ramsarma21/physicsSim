// After an edit stops a goal from happening: a fast, deterministic search in the real engine for the SMALLEST change that makes every goal
// happen again, never undoing what the person just changed and preferring the things they did not touch. Only fixes that were run in the engine
// and worked are offered (the panel offers the found one as a one-click chip: its scene is the one that was run, so applying it is instant).
//   import { findFix, fixTargets, outcomeWords, fixWords } from "./fixer.js"
//   const r = await findFix({ scene, sim, goals, before: {scene, sim}, touched, swapped, outcome }, { simulate, signal, parallel, onProgress })
//   r.status: "ok" (nothing fails) | "found" (r.fix: {scene, sim, changes, cost, words}) | "none" (r.near: the closest miss, or null)
// Where the candidates come from, cheapest and most natural first:
//   1. intercept (an "in" goal whose thing flies but misses): its flight is read from the run's track (up to where it struck the container, then
//      continued as a free fall) and the container is moved and/or raised to catch it;
//   2. follow: what the person (or the solver, to make room) moved, the things it works with follow by the same amount ("shift the dominoes,
//      the seesaw and Ball 2 8 cm left to line up with the box");
//   3. one knob at a time over the obvious knobs of the things in the run's chain (the container's place, a ramp's angle, a launcher's or a row's
//      place, a seesaw's tilt, a row's spacing, a swapped thing's weight), smallest changes first.
// Every candidate is checked for new overlaps (geometry) before it is run, and a fix must not add start-up warnings. Pure (no DOM): node tests
// run it with the real engine.
import { inspect, typeName, propSpec, isStaticItem, itemGeometry, shapesAt } from "./solver.js"
import { checkGoals, goalItems, goalKind } from "./goals.js"
import { kindNoun, aKindOf, weightOf, fmtMass, clipLabel, solidMass } from "./words.js"
import { catalog as simCatalog } from "../sim/index.js"

export const FIX_MS = 12000 // the search's time budget
export const FIX_RUNS = 320 // and its most engine runs (the page runs about 30 a second on four workers)
export const FIX_EXTRA_MS = 2500 // once a fix is found: how much longer it looks for a smaller one
// a slower machine running the tests (a CI runner) stretches every search's time budget by AI_FIX_TIME_SCALE, so it gets as many runs as
// the budgets were measured with (node only: a page has no process.env, so there it is always 1)
export const TIME_SCALE = Math.max(1, Number(globalThis.process?.env?.AI_FIX_TIME_SCALE) || 1)
const G = 9.81

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
const r5 = (v) => Math.round(v * 1e5) / 1e5
const lc = (s) => (/^[A-Z][a-z]+['’]s\b/.test(String(s)) ? String(s) : String(s).replace(/^./, (c) => c.toLowerCase())) // ("Rubik's cube" keeps its capital)
const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase())
const andList = (l) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l.at(-1)}`)
const trimNum = (v, d) => String(Number(Number(v).toFixed(d)))
const CONTAINERS = ["box", "cup", "bucket", "basket"]

/** "6.5 → 5.2 cm", "8 mm → 3 cm" (one unit when both are in it). */
const lenPair = (a, b) => {
	const fa = fmtLen(a)
	const fb = fmtLen(b)
	return fa.split(" ")[1] === fb.split(" ")[1] ? `${fa.split(" ")[0]} → ${fb}` : `${fa} → ${fb}`
}
/** A length in words: "8 mm", "4.5 cm", "35 cm", "1.25 m". */
export function fmtLen(v) {
	const a = Math.abs(v)
	// (by the figure it shows: 9.99 mm is "1 cm", never "10 mm"; 99.96 cm is "1 m")
	if (Number(trimNum(a * 1000, 1)) < 10) return `${trimNum(a * 1000, 1)} mm`
	if (Number(trimNum(a * 100, 1)) < 10) return `${trimNum(a * 100, 1)} cm`
	if (Number(trimNum(a * 100, 0)) < 100) return `${trimNum(a * 100, 0)} cm`
	return `${trimNum(a, 2)} m`
}
const nameOf = (it) => it?.name ?? typeName(it?.type) ?? it?.id
/** "Ball 2", "the box", "the tennis ball" (a name with a number, or two capitalised words, is a proper name). */
export const theName = (it) => {
	const n = nameOf(it) ?? "it"
	// (a number of its own, "Ball 2", or two capitalised words make a proper name; a number that is part of a word, "the 8-ball", does not)
	// ("Newton's cradle" keeps its capital: "the Newton's cradle")
	if (/^[A-Z][a-z]+['’]s\b/.test(n)) return `the ${n}`
	return /(^|\s)\d+(\s|$)/.test(n) || /^[A-Z][a-z]+ [A-Z]/.test(n) ? n : `the ${lc(n)}`
}
const propValue = (it, k) => (it?.props?.[k] !== undefined ? it.props[k] : propSpec(it?.type, k)?.default)
const ordinal = (k) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][k % 10] ?? "th"}`
/**
 * One of several things of a kind, whose name is only its kind's with a number ("Book 1", "Soda can 6", "Trampoline 3"), by its place among
 * them: "the first paperback book", "the 6th soda can", "the last trampoline", "the 2nd tissue box from the bottom" (V8820 n4 / x1 / c09: the
 * offer said "move Book 1" while the fix card said "the 1st paperback book"). Any other name as theName says it ("Ball 2", the yellow ball,
 * is the only one of its kind: its name stays).
 */
export function placeName(it, scene) {
	if (!it || !scene?.items) return theName(it)
	const nm = String(it.name ?? "")
	if (!/\s\d+$/.test(nm)) return theName(it)
	const same = scene.items.filter((i) => i.type === it.type)
	if (same.length < 2 || !same.some((i) => i.id === it.id)) return theName(it)
	const kind = String(kindNoun(it.type, 1, { short: true }))
	const head = nm.replace(/\s+\d+$/, "").toLowerCase().split(/\s+/).at(-1)
	if (!head || !kind.toLowerCase().includes(head)) return theName(it)
	const xs = same.map((i) => Number(i.x) || 0)
	const ys = same.map((i) => Number(i.y) || 0)
	const stacked = Math.max(...xs) - Math.min(...xs) < 0.05 && Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs)
	const sorted = [...same].sort((p, q) => (stacked ? (Number(p.y) || 0) - (Number(q.y) || 0) : (Number(p.x) || 0) - (Number(q.x) || 0)))
	const k = sorted.findIndex((i) => i.id === it.id) + 1
	const n = sorted.length
	if (stacked) return k === 1 ? `the bottom ${kind}` : k === n ? `the top ${kind}` : `the ${ordinal(k)} ${kind} from the bottom`
	return k === 1 ? `the first ${kind}` : k === n ? `the last ${kind}` : `the ${ordinal(k)} ${kind}`
}

// ================================================================ the run, read: paths, contacts, the chain of who set off whom
/** An item's path in a run: the mean of its moving parts each frame -> [{t, x, y}] (empty when nothing of it moves). */
export function pathOf(sim, id) {
	const sids = (sim?.doc?.solids ?? []).filter((s) => s.item === id && s.kind === "dynamic").map((s) => s.id)
	const frames = sim?.track?.frames ?? []
	if (!sids.length || !frames.length) return []
	const last = new Map()
	const out = []
	for (const f of frames) {
		let x = 0
		let y = 0
		let n = 0
		for (const sid of sids) {
			const p = f.placements?.[sid] ?? last.get(sid)
			if (!p) continue
			last.set(sid, p)
			x += p.x
			y += p.y
			n++
		}
		if (n) out.push({ t: f.t, x: x / n, y: y / n })
	}
	return out
}
/** How far an item reaches from its middle (a ball: its radius; else half the larger side of its moving parts' outline). */
function reachOf(sim, id) {
	let r = 0
	for (const s of sim?.doc?.solids ?? []) {
		if (s.item !== id || s.kind !== "dynamic") continue
		const b = s.body ?? {}
		if (b.kind === "ball") r = Math.max(r, b.radius ?? 0)
		else if (b.kind === "slab") r = Math.max(r, Math.max(b.width ?? 0, b.height ?? 0) / 2)
		else if (b.kind === "polygon" && Array.isArray(b.points)) r = Math.max(r, ...b.points.map((p) => Math.hypot(p.x, p.y)))
	}
	return r
}
/** Every impact of an item's solids with anything else's: [{t, speed, other (the other item's id)}], in time order. */
function impactsOf(sim, id) {
	const of = new Map((sim?.doc?.solids ?? []).map((s) => [s.id, s.item]))
	const out = []
	for (const h of sim?.track?.impacts ?? []) {
		const A = of.get(h.a)
		const B = of.get(h.b)
		if (A === id && B !== id) out.push({ t: h.t, speed: h.speed, other: B })
		else if (B === id && A !== id) out.push({ t: h.t, speed: h.speed, other: A })
	}
	return out.sort((p, q) => p.t - q.t)
}
/** The run's impacts between two items' solids: [{t, speed, a, b}] (a: a solid of `ia`). */
function contactsBetween(sim, ia, ib) {
	const of = new Map((sim?.doc?.solids ?? []).map((s) => [s.id, s.item]))
	const out = []
	for (const h of sim?.track?.impacts ?? []) {
		const A = of.get(h.a)
		const B = of.get(h.b)
		if (A === ia && B === ib) out.push({ t: h.t, speed: h.speed, a: h.a, b: h.b })
		else if (A === ib && B === ia) out.push({ t: h.t, speed: h.speed, a: h.b, b: h.a })
	}
	return out.sort((p, q) => p.t - q.t)
}
/**
 * When each item first takes part in the run (it starts to move, or something strikes it): Map id -> t. The table and the walls are left out.
 * Ordered by that time it is the run's chain (a ball, the ramp it rolls down, the dominoes it knocks, the seesaw they hit, the ball it flings, the box).
 */
export function involvement(sim, scene) {
	const out = new Map()
	const typeOf = new Map((scene?.items ?? []).map((i) => [i.id, i.type]))
	const skip = (id) => id === undefined || id === null || ["table", "wall"].includes(typeOf.get(id)) || id === "table"
	const put = (id, t) => {
		if (skip(id) || !Number.isFinite(t)) return
		if (!out.has(id) || t < out.get(id)) out.set(id, t)
	}
	for (const st of sim?.summary?.stories ?? []) if (st.moved_at !== null && st.moved_at !== undefined) put(st.item, Number(st.moved_at))
	const of = new Map((sim?.doc?.solids ?? []).map((s) => [s.id, s.item]))
	for (const h of sim?.track?.impacts ?? []) {
		const a = of.get(h.a)
		const b = of.get(h.b)
		if (a === b || skip(a) || skip(b)) continue
		put(a, h.t)
		put(b, h.t)
	}
	return out
}

// ================================================================ the goals to win back
const labelOf = (g) => (typeof g?.label === "string" && g.label.trim() ? g.label.trim() : null)
/**
 * The goals a fix must make happen: the plan's goals (as solved; else the scene's own), and every row that all fell before the change and is
 * still there ("All 7 dominoes fall": implicit, never shown as the person's goal). -> [{goal, label, implicit}]
 */
export function fixTargets({ goals = null, scene, before = null, sim = null }) {
	const list = (Array.isArray(goals) ? goals : (scene?.goals ?? []).map((g) => ({ kind: "in", ...g }))).filter(isObj)
	const out = list.map((g) => ({ goal: g, label: labelOf(g) ?? "the goal", implicit: false }))
	const bsim = before?.sim
	if (bsim?.doc && bsim?.track?.frames?.length) {
		for (const st of bsim.summary?.stories ?? []) {
			if (!/^\d+ of \d+ fall$/.test(st?.text ?? "")) continue
			const it = scene?.items?.find((i) => i.id === st.item)
			// (a row swapped for another kind of thing, its id kept, is not that row any more)
			const was = before?.scene?.items?.find((i) => i.id === st.item)
			if (!it || (was && was.type !== it.type) || out.some((t) => goalKind(t.goal) === "falls" && goalItems(t.goal).includes(st.item))) continue
			let r
			try {
				;[r] = checkGoals([{ kind: "falls", items: [st.item], label: "x" }], bsim)
			} catch {}
			if (r?.ok !== true || !(r.of > 1)) continue
			// (counted in the run as it is now: a row made longer is all of it)
			let n = r.of
			if (sim?.doc && sim?.track?.frames?.length)
				try {
					n = checkGoals([{ kind: "falls", items: [st.item], label: "x" }], sim)[0]?.of || n
				} catch {}
			const label = it.type === "domino-row" ? `All ${n} dominoes fall` : `All of ${theName(it)} falls`
			out.push({ goal: { kind: "falls", items: [st.item], label }, label, implicit: true })
		}
	}
	return out
}
/** The targets' results in a run (as ./goals.js checks them): [{label, ok, detail, kind, implicit, ...}] */
export function judge(targets, sim) {
	let rs
	try {
		rs = checkGoals(targets.map((t) => ({ ...t.goal, label: t.label })), sim)
	} catch {
		rs = targets.map((t) => ({ label: t.label, ok: null }))
	}
	return rs.map((r, i) => ({ ...r, implicit: targets[i].implicit }))
}

// ================================================================ a container's opening, and what a thing did instead of landing in it
/** A container's opening in the world at the start: {cx, inL, inR, floor (its inside bottom), rim, x0, x1, y0, angle}. */
export function containerGeo(scene, sim, id) {
	const it = scene?.items?.find((i) => i.id === id)
	if (!it) return null
	const P = { ...(isObj(sim?.resolved?.[id]) ? sim.resolved[id] : {}), ...(it.props ?? {}) }
	const w = num(P.width) ?? 0.2
	const wall = num(P.wall) ?? num(P.height) ?? 0.1
	const t = num(P.thickness) ?? 0.012
	const x = Number(it.x) || 0
	const y = Number(it.y) || 0
	return { cx: x, inL: x - w / 2 + t, inR: x + w / 2 - t, floor: y, rim: y + wall, x0: x - w / 2, x1: x + w / 2, y0: y - t, wall, w, t, angle: Number(it.angle) || 0 }
}
/**
 * What an "in" goal's thing did instead, in a few plain words ("the tennis ball hits the side of the box and drops outside", "Ball 2 lands
 * 12 cm short of the box", "Ball 2 is never launched: only 4 of 7 dominoes fall"). null when it can't be told.
 */
/**
 * The first firm hit in a run that the run before the change didn't have (between any two things, not the table or the walls), before the
 * goal's thing should have moved: "the dominoes now hit the box". null when there is none.
 */
/** Pairs "a|b" (both ways) of a thing and what it rests on or in at the start (riderMap's), whose touches are its settling. */
function settledPairs(scene) {
	const out = new Set()
	try {
		for (const [sup, rs] of riderMap(scene)) for (const r of rs) (out.add(`${r}|${sup}`), out.add(`${sup}|${r}`))
	} catch {}
	return out
}
export function newHit(before, sim, scene, by = Infinity) {
	return firstNewHit(before, sim, scene, by)?.words ?? null
}
function firstNewHit(before, sim, scene, by = Infinity) {
	const theName = (it) => placeName(it, scene) // (one of a row by its place: "the 6th soda can", never "Soda can 6")
	if (!before?.sim?.track || !sim?.track) return null
	const pairs = (run, sc) => {
		const of = new Map((run.doc?.solids ?? []).map((x) => [x.id, x.item]))
		const typeOf = new Map((sc?.items ?? []).map((i) => [i.id, i.type]))
		// (a thing settling on or in what it rests on, before the machine starts, is no hit of the chain: a rubber duck dropped into the box,
		// "the rubber duck hits the box, so the egg never moves": V8814 s2)
		const rest = settledPairs(sc)
		const t0 = Number(sc?.release) || 0
		const out = new Map()
		for (const h of run.track.impacts ?? []) {
			const a = of.get(h.a)
			const b = of.get(h.b)
			if (!a || !b || a === b || ["table", "wall"].includes(typeOf.get(a)) || ["table", "wall"].includes(typeOf.get(b)) || (h.speed ?? 0) < 0.3) continue
			if (rest.has(`${a}|${b}`) && h.t <= t0 + 0.3) continue
			const k = a < b ? `${a}|${b}` : `${b}|${a}`
			if (!out.has(k) || h.t < out.get(k).t) out.set(k, { a, b, t: h.t })
		}
		return out
	}
	const A = pairs(before.sim, before.scene)
	const B = pairs(sim, scene)
	const fresh = [...B].filter(([k, e]) => !A.has(k) && e.t <= by).sort((p, q) => p[1].t - q[1].t)
	if (!fresh.length) return null
	const { a, b } = fresh[0][1]
	// (said the way it happens: what was moving first strikes the other)
	const moved = new Map((sim.summary?.stories ?? []).map((st) => [st.item, st.moved_at ?? Infinity]))
	const [x, y] = (moved.get(b) ?? Infinity) < (moved.get(a) ?? Infinity) ? [b, a] : [a, b]
	const X = scene.items.find((i) => i.id === x)
	const Y = scene.items.find((i) => i.id === y)
	if (!X || !Y) return null
	const n = theName(X)
	const plural = /s$/i.test(n) && !/\d/.test(n)
	// (fresh: one of the two is new or swapped by the edit: the caller may say where the chain stops instead)
	const was = new Map((before.scene?.items ?? []).map((i) => [i.id, i.type]))
	return { words: `${n} ${plural ? "hit" : "hits"} ${theName(Y)}`, a: X.id, b: Y.id, fresh: [X, Y].some((it) => was.get(it.id) !== it.type) }
}
/**
 * Where the chain stops now, when the edit put new or swapped things into it (D1, 16 Oct: "the orange hits Soda can 1" named the first new
 * hit, not the break): the things of one kind the edit added or swapped in are one link ("the 6 soda cans"), and the first link that does less
 * than it should is said with what struck it: "the orange only shoves the first soda can 4 cm (each weighs 370 g)", "only 2 of the 6 soda cans
 * fall", "the last soda can hits the seesaw at 1.4 m/s, but it only turns 1° (27° before)". -> {words, ids} or null (it can't be told, or
 * nothing new is in the chain: then the first new hit says it, newHit)
 */
export function chainStop(sim, scene, before, goalIds = []) {
	const theName = (it) => placeName(it, scene) // (one of a row by its place: "the 6th soda can", never "Soda can 6")
	if (!before?.sim?.summary || !before?.scene?.items || !sim?.summary || !scene?.items) return null
	const A = new Map(before.scene.items.map((i) => [i.id, i]))
	const B = new Map(scene.items.map((i) => [i.id, i]))
	const fresh = (id) => !A.has(id) || A.get(id).type !== B.get(id)?.type
	const of = new Map((sim.doc?.solids ?? []).map((s) => [s.id, s.item]))
	// (a thing settling in or on what it rests on is no part of the chain: the duck in the box)
	const rest = settledPairs(scene)
	const hitsOn = (id) =>
		(sim.track?.impacts ?? [])
			.map((h) => ({ t: h.t, speed: h.speed ?? 0, a: of.get(h.a), b: of.get(h.b) }))
			.filter((h) => h.a !== h.b && (h.a === id || h.b === id) && !["table", "wall"].includes(B.get(h.a === id ? h.b : h.a)?.type) && !(rest.has(`${h.a}|${h.b}`) && h.t <= (Number(scene.release) || 0) + 0.3))
			.map((h) => ({ ...h, other: h.a === id ? h.b : h.a }))
			.sort((p, q) => p.t - q.t)
	const story = (run, id) => (run?.summary?.stories ?? []).find((st) => st.item === id) ?? null
	const turned = (st) => Number(/^turns (\d+(?:\.\d+)?)°/.exec(st?.text ?? "")?.[1] ?? NaN)
	const goals = new Set(goalIds)
	// (moved as the run's own story says: a bottle rocked by the next one, 0.18 m/s, "doesn't move")
	const moving = (id) => {
		const st = story(sim, id)
		return !!st && st.moved_at !== null && st.moved_at !== undefined
	}
	// the links of several things of one kind (a row of soda cans): the edit's new ones, or any that take part in the run now
	const groups = new Map()
	for (const it of scene.items) {
		if (goals.has(it.id) || ["table", "wall"].includes(it.type) || isStaticItem(it.type, it.fixed === true) || it.held) continue
		groups.set(it.type, [...(groups.get(it.type) ?? []), it])
	}
	for (const [type, list] of groups) {
		if (list.length < 2 || !(list.some((i) => fresh(i.id)) || list.some((i) => moving(i.id)))) continue
		// (a link only when something struck one of them: three pins set down to watch by the bucket are no link)
		if (!list.some((i) => hitsOn(i.id).some((h) => !list.some((x) => x.id === h.other) && h.speed >= 0.05))) continue
		let r
		try {
			;[r] = checkGoals([{ kind: "falls", items: list.map((i) => i.id), label: "x" }], sim)
		} catch {
			continue
		}
		if (!r || !Number.isFinite(r.fallen) || r.fallen >= r.of) continue
		const n = list.length
		const noun = kindNoun(type, 1, { short: true })
		const nouns = kindNoun(type, n, { short: true })
		const ids = list.map((i) => i.id)
		// (the first one struck, and the one furthest from it: a row shoved through to its last one passes its push on, whether or not they tip)
		const first = [...list].sort((p, q) => (hitsOn(p.id)[0]?.t ?? Infinity) - (hitsOn(q.id)[0]?.t ?? Infinity))[0]
		const lastOne = [...list].sort((p, q) => Math.abs((Number(q.x) || 0) - (Number(first.x) || 0)) - Math.abs((Number(p.x) || 0) - (Number(first.x) || 0)))[0]
		if (moving(lastOne.id)) continue
		if (r.fallen > 0) return { words: `only ${r.fallen} of the ${n} ${nouns} ${r.fallen === 1 ? "falls" : "fall"}`, ids }
		// (none fall: what struck the first one, and how far it went)
		const h = hitsOn(first.id).find((x) => !ids.includes(x.other))
		const P = pathOf(sim, first.id)
		const d = P.length ? Math.hypot(P.at(-1).x - P[0].x, P.at(-1).y - P[0].y) : 0
		const w = weightOf(type, first.props ?? {})
		const each = w && list.every((i) => Math.abs((weightOf(i.type, i.props ?? {}) ?? 0) - w) < 1e-4) ? ` (each weighs ${fmtMass(w)})` : ""
		const by = h && B.get(h.other) ? theName(B.get(h.other)) : null
		// ("the growing dominoes only shove …")
		const many = by && /s$/i.test(by) && !/\d/.test(by)
		if (by) return { words: `${by} only ${d >= 0.005 ? `${many ? "shove" : "shoves"} the first ${noun} ${fmtLen(d)}` : `${many ? "touch" : "touches"} the first ${noun}`}${each}`, ids }
		return { words: `none of the ${n} ${nouns} fall${each}`, ids }
	}
	// a new thing of its own that should pass the push on and stays where it is (a laptop stood on its edge that never tips over)
	for (const it of scene.items) {
		if (!fresh(it.id) || goals.has(it.id) || ["table", "wall"].includes(it.type) || isStaticItem(it.type, it.fixed === true) || it.held || (groups.get(it.type)?.length ?? 0) > 1) continue
		if (moving(it.id)) continue
		// (only one that something struck: a thing standing by to watch, a duck in the box, is no link)
		const h = hitsOn(it.id).filter((x) => x.speed >= 0.05).at(-1)
		const H = h ? B.get(h.other) : null
		if (!H) continue
		const g = groups.get(H.type)
		const hn = g && g.length > 1 ? `the last ${kindNoun(H.type, 1, { short: true })}` : theName(H)
		// (said without "but": the lead goes on "Done, but now …")
		return { words: `${hn} ${/s$/i.test(hn) && !/\d/.test(hn) ? "hit" : "hits"} ${theName(it)} and it doesn't tip over`, ids: [it.id] }
	}
	// the first thing that worked before and does far less now, upstream of the goal (by when it took part before), with what strikes it now
	const inv0 = involvement(before.sim, before.scene)
	const tGoal = Math.min(...[...goals].map((id) => inv0.get(id) ?? Infinity))
	const cands = [...A.values()].filter((a) => B.has(a.id) && !fresh(a.id) && !goals.has(a.id) && inv0.has(a.id) && inv0.get(a.id) < tGoal).sort((p, q) => inv0.get(p.id) - inv0.get(q.id))
	for (const a of cands) {
		const s0 = story(before.sim, a.id)
		const s1 = story(sim, a.id)
		if (!s0 || !s1) continue
		const t0 = turned(s0)
		const t1 = turned(s1)
		// (a row that all fell before and doesn't now: "only 3 of the 7 dominoes fall")
		const f0 = /^(\d+) of (\d+) fall$/.exec(s0.text ?? "")
		const f1 = /^(\d+) of (\d+) fall$/.exec(s1.text ?? "")
		if (f0 && f1 && f0[1] === f0[2] && Number(f1[1]) < Number(f1[2])) {
			const n = Number(f1[2])
			const k = Number(f1[1])
			const noun = a.type === "domino-row" ? (n === 1 ? "domino" : "dominoes") : kindNoun(a.type, n, { short: true })
			return { words: k === 0 ? `none of the ${n} ${noun} fall` : `only ${k} of the ${n} ${noun} ${k === 1 ? "falls" : "fall"}`, ids: [a.id] }
		}
		let does = null
		if (Number.isFinite(t0) && t0 >= 5 && (!Number.isFinite(t1) || t1 < 0.5 * t0)) does = Number.isFinite(t1) && t1 >= 0.5 ? `it only turns ${Math.round(t1)}° (${Math.round(t0)}° before)` : "it doesn't turn"
		else if (s0.moved_at !== null && s0.moved_at !== undefined && (s1.moved_at === null || s1.moved_at === undefined) && !Number.isFinite(t0)) does = "it doesn't move"
		if (!does) continue
		const B1 = B.get(a.id)
		const h = hitsOn(a.id).filter((x) => x.speed >= 0.05 && !goals.has(x.other)).at(-1)
		const H = h ? B.get(h.other) : null
		if (!H) return { words: `nothing reaches ${theName(B1)}`, ids: [a.id] }
		// (a thing of a new link is "the last soda can")
		const g = groups.get(H.type)
		const hn = g && g.length >= 2 && fresh(H.id) ? `the ${[...g].sort((p, q) => (Number(q.x) || 0) - (Number(p.x) || 0))[0].id === H.id ? "last" : "first"} ${kindNoun(H.type, 1, { short: true })}` : theName(H)
		const plural = /s$/i.test(hn) && !/\d/.test(hn)
		return { words: `${hn} ${plural ? "hit" : "hits"} ${theName(B1)}${h.speed >= 0.1 ? ` at ${trimNum(h.speed, 1)} m/s` : ""} and ${does}`, ids: [a.id] }
	}
	return null
}
function inWords(g, sim, scene, before = null) {
	const theName = (it) => placeName(it, scene) // (one of a row by its place: "the 6th soda can", never "Soda can 6")
	const it = scene.items.find((i) => i.id === g.item)
	const box = scene.items.find((i) => i.id === g.container)
	if (!it || !box) return null
	const who = theName(it)
	const where = theName(box)
	const P = pathOf(sim, g.item)
	const moved = P.length > 1 && P.some((p) => Math.hypot(p.x - P[0].x, p.y - P[0].y) > 0.01)
	// (rolled a little along what it stands on, but never thrown or dropped: "never launched")
	const ys = P.map((p) => p.y)
	const flew = P.length > 1 && (P.some((p) => p.y - P[0].y > 0.02) || Math.max(...ys) - Math.min(...ys) > 0.05 || P.some((p) => Math.abs(p.x - P[0].x) > 0.25))
	if (!moved || !flew) {
		// (what launched it before is gone, or swapped for something that doesn't: said as the reason, "Ball 2 is never launched: nothing
		// launches it now that the seesaw is a pillow" (V8832 x3), never a fix that lets it roll off on its own)
		try {
			const L = before?.sim && before?.scene ? chainOf(before.sim, before.scene).get(g.item)?.by ?? null : null
			const L0 = L ? before.scene.items.find((i) => i.id === L) : null
			const L1 = L ? scene.items.find((i) => i.id === L) : null
			if (L0 && (!L1 || L1.type !== L0.type) && chainOf(sim, scene).get(g.item)?.by !== L) {
				const was = placeName(L0, before.scene)
				return `${who} ${moved ? "is never launched" : "never moves"}: nothing launches ${/s$/i.test(who) && !/\d/.test(who) ? "them" : "it"} now that ${was} ${L1 ? `is ${aKindOf(L1.type)}` : "is gone"}`
			}
		} catch {}
		// the chain stopped before it: a hit the run before didn't have says why ("the dominoes now hit the box"), else the first row that
		// didn't all fall
		const inv0 = before?.sim ? involvement(before.sim, before.scene) : null
		const by = inv0 ? Math.max(inv0.get(g.item) ?? -Infinity, inv0.get(g.container) ?? -Infinity) : Infinity
		const hit = firstNewHit(before, sim, scene, Number.isFinite(by) ? by + 0.05 : Infinity)
		// (a first new hit that is a new or swapped thing's, or one of a row striking the next, is the new chain going, not where it breaks:
		// where it stops is said instead)
		const kindOf = (id) => scene.items.find((i) => i.id === id)?.type
		// (and with no new hit at all, where the chain now does less: "the last domino hits the seesaw at 0.4 m/s and it only turns 1° (27° before)")
		const stop = !hit || hit.fresh || kindOf(hit.a) === kindOf(hit.b) ? chainStop(sim, scene, before, [g.item, g.container]) : null
		if (stop) return `${stop.words}, so ${who} ${moved ? "is never launched" : "never moves"}`
		if (hit) return `${hit.words}, so ${who} ${moved ? "is never launched" : "never moves"}`
		for (const st of sim?.summary?.stories ?? []) {
			let r = null
			if (/^\d+ of \d+ fall$/.test(st?.text ?? ""))
				try {
					;[r] = checkGoals([{ kind: "falls", items: [st.item], label: "x" }], sim)
				} catch {}
			if (r && r.of > 0 && r.fallen < r.of) {
				const row = st.item && scene.items.find((i) => i.id === st.item)?.type === "domino-row"
				// (none: "none of the dominoes fall", never "only 0 of 7")
				return `${who} ${moved ? "is never launched" : "never moves"}: ${r.fallen === 0 ? `none of ${row ? "the dominoes" : "its parts"} fall` : `only ${r.fallen} of ${r.of} ${row ? (r.fallen === 1 ? "dominoes falls" : "dominoes fall") : r.fallen === 1 ? "of its parts falls" : "of its parts fall"}`}`
			}
		}
		return moved ? `${who} is never launched` : `${who} never moves`
	}
	const C = containerGeo(scene, sim, g.container)
	const r = reachOf(sim, g.item)
	// (a thing wider than the opening can never get in: said as such, never "gets in but bounces out": V8814 s6, a 6 cm ball and a 5 cm box)
	if (r > 0 && 2 * r >= C.inR - C.inL - 0.001) return `${who} (${fmtLen(2 * r)} across) is wider than ${where}’s ${fmtLen(Math.max(0, C.inR - C.inL))} opening, so it can’t get in`
	const insideAt = (p) => p.x > C.inL && p.x < C.inR && p.y - r < C.rim && p.y - r > C.floor - 0.01
	const end = P.at(-1)
	if (P.some(insideAt) && !insideAt(end)) return `${who} gets into ${where} but bounces out`
	const hit = contactsBetween(sim, g.item, g.container)
	// (a touch of the container counts only when it is how the flight ended: nothing else struck between coming down to the rim's level and
	// that touch. A ball that flew past, bounced off the end wall and rolled back into the cup's side "flies N past", never "hits the side")
	let tDown = null
	for (let i = 1; i < P.length && tDown === null; i++) if (P[i - 1].y > C.rim + r && P[i].y <= C.rim + r) tDown = P[i - 1].t
	const firstOther = hit.length && tDown !== null ? impactsOf(sim, g.item).find((h) => h.other !== g.container && h.t > tDown + 1e-6 && h.t < hit[0].t - 1e-6) : null
	if (hit.length && !firstOther) {
		const part = String(hit[0].b).split("/").pop()
		if (/left|right|wall|side/.test(part)) return `${who} hits the side of ${where} and drops outside`
		if (/rim|lip/.test(part)) return `${who} hits the rim of ${where} and bounces off`
		return `${who} hits ${where} and doesn’t stay in`
	}
	// no touch: where it came down past the rim's height, or how high it got
	const level = C.rim + r
	const top = P.reduce((m, p) => Math.max(m, p.y), -Infinity)
	for (let i = 1; i < P.length; i++) {
		const a = P[i - 1]
		const b = P[i]
		if (a.y > level && b.y <= level) {
			const xc = a.x + ((level - a.y) / (b.y - a.y)) * (b.x - a.x)
			const vx = (b.x - a.x) / Math.max(1e-6, b.t - a.t)
			const gap = xc < C.inL ? C.inL + r - xc : xc > C.inR ? xc - (C.inR - r) : 0
			if (gap <= 0.003) break
			if (Math.abs(vx) < 0.1) return `${who} comes down ${fmtLen(gap)} ${xc < C.inL ? "left" : "right"} of ${where}`
			const short = (xc < C.inL && vx > 0) || (xc > C.inR && vx < 0)
			return short ? `${who} comes down ${fmtLen(gap)} short of ${where}` : `${who} flies ${fmtLen(gap)} past ${where}`
		}
	}
	if (top < level && P.some((p) => p.x > C.x0 - 0.3 && p.x < C.x1 + 0.3)) return `${who} doesn't fly high enough to get into ${where} (it tops out ${fmtLen(level - top)} too low)`
	const d = end.x < C.cx ? C.inL - end.x : end.x - C.inR
	return `${who} ends ${fmtLen(Math.max(0, d))} ${end.x < C.cx ? "left" : "right"} of ${where}`
}
/** What happens instead of a failed goal, in plain words: "only 4 of 7 dominoes fall", "Ball 2 flies 6 cm past the box". */
export function outcomeWords(result, goal, sim, scene, before = null) {
	const theName = (it) => placeName(it, scene) // (one of a row by its place: "the 6th soda can", never "Soda can 6")
	const k = goalKind(goal)
	if (result?.ok === true) return null
	if (k === "in") return inWords(goal, sim, scene, before)
	const items = goalItems(goal).map((id) => scene.items.find((i) => i.id === id)).filter(Boolean)
	const who = items.length === 1 ? theName(items[0]) : "they"
	if (k === "falls" && Number.isFinite(result?.fallen) && result.of > 0) {
		// (several things of one kind: by their kind, "none of the 10 water bottles fall"; with what stopped them when the change put them there:
		// "the orange only shoves the first water bottle 3 cm (each weighs 512 g), and none of the 10 fall")
		const one = items.length > 1 && items.every((i) => i.type === items[0].type) ? items[0].type : null
		if (one) {
			const n = items.length
			let stop = null
			try {
				stop = result.fallen === 0 && before ? chainStop(sim, scene, before, []) : null
			} catch {}
			if (stop && stop.ids.length === n && stop.ids.every((id) => items.some((i) => i.id === id)) && /\b(shoves?|touch(es)?)\b/.test(stop.words)) return `${stop.words}, and none of the ${n} fall`
			return result.fallen === 0 ? `none of the ${n} ${kindNoun(one, n, { short: true })} fall` : `only ${result.fallen} of the ${n} ${kindNoun(one, n, { short: true })} ${result.fallen === 1 ? "falls" : "fall"}`
		}
		return result.fallen === 0 ? `none of ${items.length === 1 && items[0].type === "domino-row" ? "the dominoes" : "them"} fall` : `only ${result.fallen} of ${result.of} ${items.length === 1 && items[0].type === "domino-row" ? "dominoes" : "of them"} ${result.fallen === 1 ? "falls" : "fall"}`
	}
	if (k === "hits") {
		const tgt = scene.items.find((i) => i.id === goal.target)
		return Number.isFinite(result?.t) ? `${who} touches ${theName(tgt)} only at ${result.t} s` : `${who} never touches ${theName(tgt)}`
	}
	if (k === "moves" && Number.isFinite(result?.moved_m)) return `${who} moves only ${fmtLen(result.moved_m)}`
	// ("the ping-pong ball stays over the table, 7.8 cm in from its right end")
	if (k === "off" && result?.detail) return `${who} ${String(result.detail).replace(/^it /, "")}`
	return result?.detail ? `${labelOf(goal) ?? "the goal"}: ${result.detail}` : null
}

// ================================================================ how far a run is from the goals (lower is better; 0 = all met)
function farness(targets, results, sim, scene) {
	let f = 0
	results.forEach((r, i) => {
		if (r.ok === true) return
		const g = targets[i].goal
		const k = goalKind(g)
		f += 1
		if (k === "falls" && r.of > 0) f += 0.9 * (1 - (r.fallen ?? 0) / r.of)
		else if (k === "moves" && Number.isFinite(r.moved_m)) f += 0.9 * Math.max(0, Math.min(1, 1 - r.moved_m / (num(g.min_m) ?? 0.05)))
		else if (k === "in") {
			const C = containerGeo(scene, sim, g.container)
			const P = pathOf(sim, g.item)
			if (!C || !P.length) f += 0.9
			else {
				const ty = C.floor + Math.min(0.05, C.wall / 2)
				const d = (p) => Math.hypot(p.x - C.cx, Math.max(0, p.y - ty) * 0.7 + Math.max(0, ty - p.y))
				let dmin = Infinity
				for (const p of P) dmin = Math.min(dmin, d(p))
				f += 0.9 * Math.min(1, 0.5 * d(P.at(-1)) + 0.5 * dmin)
			}
		} else if (k === "hits") {
			const A = pathOf(sim, goalItems(g)[0])
			const B = pathOf(sim, g.target)
			const tgt = scene.items.find((i) => i.id === g.target)
			let dmin = Infinity
			for (let j = 0; j < A.length; j++) {
				const b = B[Math.min(j, B.length - 1)] ?? (tgt ? { x: tgt.x, y: tgt.y } : null)
				if (b) dmin = Math.min(dmin, Math.hypot(A[j].x - b.x, A[j].y - b.y))
			}
			f += 0.9 * Math.min(1, Number.isFinite(dmin) ? dmin : 1)
		} else f += 0.9
	})
	return f
}

// ================================================================ changes to the scene: knobs, carried riders, geometry checks
/** The things resting on an item (and on those), which go where it goes: Map id -> [ids]. */
export function riderMap(scene) {
	let ins
	try {
		ins = inspect(scene)
	} catch {
		return new Map()
	}
	const items = scene.items.filter((i) => i.type !== "table" && i.type !== "wall")
	const on = new Map() // rider -> support
	for (const a of items) {
		let best = null
		let bestTop = -Infinity
		for (const b of items) {
			if (a === b) continue
			let g
			try {
				g = ins.gap(a.id, b.id)
			} catch {
				g = null
			}
			// (resting on it, or sitting inside it: a ball in a launcher's guides, a ball in a cup, goes where that goes)
			if (g === null || g > 0.004) continue
			if (g < -0.003) {
				const A = ins.box(a.id)
				const Bb = ins.box(b.id)
				if (!A || !Bb || A.x0 < Bb.x0 - 0.001 || A.x1 > Bb.x1 + 0.001 || A.y0 < Bb.y0 - 0.001 || A.y1 > Bb.y1 + 0.02) continue
			}
			const top = ins.box(b.id)?.y1 ?? -Infinity
			if (top > bestTop) ((bestTop = top), (best = b.id))
		}
		// (only something that can move is carried: a box hung near a ramp is not "on" it)
		if (best && !isStaticItem(a.type, a.fixed === true)) on.set(a.id, best)
	}
	const out = new Map()
	const ridersOf = (id, seen = new Set()) => {
		const list = []
		for (const [r, s] of on) if (s === id && !seen.has(r)) (seen.add(r), list.push(r, ...ridersOf(r, seen)))
		return list
	}
	for (const it of items) out.set(it.id, ridersOf(it.id))
	return out
}
/** Overlaps deeper than half a millimetre: Map "a|b" -> depth. */
function overlapsOf(scene) {
	const out = new Map()
	try {
		for (const o of inspect(scene).overlaps) if (o.depth > 0.0005) out.set(o.a < o.b ? `${o.a}|${o.b}` : `${o.b}|${o.a}`, o.depth)
	} catch {}
	return out
}
/**
 * A candidate's scene: `changes` applied to a copy of the scene. A change is {kind: "move", ids, dx, dy} (every id, and what rides on it,
 * shifted), {kind: "turn", id, d} (angle +d degrees), or {kind: "prop", id, key, to}.
 */
/** The table's width (its own, or its kind's default). */
const tableWidth = (sc) => {
	const t = sc?.items?.find((i) => i.type === "table")
	return t ? num(t.props?.width) ?? num(propSpec("table", "width")?.default) ?? 3.7 : null
}
/**
 * A change that takes something past the table's end widens the table (about its middle, as an edit does, by whole 5 cm steps and at most
 * 40 cm a side), and the invisible end walls go with it. (s: the changed copy; base: the scene it was changed from)
 */
function widenTable(s, base) {
	const table = s.items.find((i) => i.type === "table")
	const w = tableWidth(s)
	if (!table || !w) return
	let ins
	try {
		ins = inspect(s)
	} catch {
		return
	}
	const L = Number(table.x) - w / 2
	const R = Number(table.x) + w / 2
	const was = new Map(base.items.map((i) => [i.id, JSON.stringify(i)]))
	let over = 0
	for (const it of s.items) {
		if (it.type === "table" || it.type === "wall" || was.get(it.id) === JSON.stringify(it)) continue
		const b = ins.box(it.id)
		if (b) over = Math.max(over, L - b.x0, b.x1 - R)
	}
	if (over <= 0.002) return
	const grow = Math.ceil((over + 0.03) / 0.05) * 0.05
	// (up to 60 cm a side: a chain made longer, "twice as long", carries what comes after it along, past the old end)
	if (grow > 0.6) return
	table.props = { ...(table.props ?? {}), width: r5(w + 2 * grow) }
	for (const it of s.items) if (it.type === "wall" && it.props?.invisible_in_3d === true) it.x = r5(Number(it.x) + Math.sign(Number(it.x) - Number(table.x)) * grow)
	// (and the stage, the view's frame, still shows all of the table)
	if (isObj(s.stage) && num(s.stage.x0) !== null && num(s.stage.x1) !== null) {
		const L2 = Number(table.x) - (w + 2 * grow) / 2
		const R2 = Number(table.x) + (w + 2 * grow) / 2
		s.stage = { ...s.stage, x0: r5(Math.min(s.stage.x0, L2 - 0.01)), x1: r5(Math.max(s.stage.x1, R2 + 0.04)) }
	}
}
export function applyChanges(scene, changes, riders = null) {
	const s = clone(scene)
	const R = riders ?? riderMap(scene)
	const byId = new Map(s.items.map((i) => [i.id, i]))
	for (const c of changes) {
		if (c.kind === "move") {
			const ids = new Set()
			for (const id of c.ids) (ids.add(id), (R.get(id) ?? []).forEach((r) => ids.add(r)))
			for (const id of ids) {
				const it = byId.get(id)
				if (!it) continue
				if (c.dx) it.x = r5((Number(it.x) || 0) + c.dx)
				if (c.dy) it.y = r5((Number(it.y) || 0) + c.dy)
			}
		} else if (c.kind === "turn") {
			const it = byId.get(c.id)
			if (it) it.angle = r5((Number(it.angle) || 0) + c.d)
		} else if (c.kind === "slide") {
			// along the ramp it rests on: moved along, then put back on it at the same resting distance (what rides on it comes too)
			const it = byId.get(c.id)
			if (it) {
				const ids = [c.id, ...(R.get(c.id) ?? [])]
				try {
					const g0 = inspect(scene).gap(c.id, c.on)
					for (const id of ids) {
						const o = byId.get(id)
						if (o) o.x = r5((Number(o.x) || 0) + c.dx)
					}
					const g1 = inspect(s).gap(c.id, c.on)
					if (g0 !== null && g1 !== null) for (const id of ids) {
						const o = byId.get(id)
						if (o) o.y = r5((Number(o.y) || 0) - (g1 - g0))
					}
				} catch {}
			}
		} else if (c.kind === "prop") {
			const it = byId.get(c.id)
			if (it) it.props = { ...(it.props ?? {}), [c.key]: c.to }
		} else if (c.kind === "scale") {
			// (things made bigger or smaller, each by the same factor of its own size settings, and stood where they stood: their bottoms stay put)
			for (const id of c.ids) {
				const it = byId.get(id)
				if (!it) continue
				const low0 = lowAt(it)
				const P = { ...(it.props ?? {}) }
				for (const k of c.keys) {
					const v = num(propValue(it, k))
					const sp = propSpec(it.type, k)
					if (v === null) continue
					P[k] = r5(Math.min(num(sp?.max) ?? Infinity, Math.max(num(sp?.min) ?? 0, v * c.k)))
				}
				it.props = P
				const low1 = lowAt(it)
				if (low0 !== null && low1 !== null && Math.abs(low1 - low0) > 1e-6 && !it.held) it.y = r5((Number(it.y) || 0) + (low0 - low1))
			}
		} else if (c.kind === "props") {
			// (one setting on several things of a kind: "empty the 6 soda cans")
			for (const id of c.ids) {
				const it = byId.get(id)
				if (it) it.props = { ...(it.props ?? {}), [c.key]: c.to }
			}
		} else if (c.kind === "remove") {
			// (an invisible safety wall at a table's end taken away, so a thing can go off that end: an "off" goal)
			s.items = s.items.filter((i) => !c.ids.includes(i.id))
			for (const id of c.ids) byId.delete(id)
		} else if (c.kind === "add") {
			if (!byId.has(c.item.id)) {
				const it = clone(c.item)
				s.items.push(it)
				byId.set(it.id, it)
			}
		} else if (c.kind === "layout") {
			// (a row put at these x's, what rides on each with it)
			c.ids.forEach((id, i) => {
				const it = byId.get(id)
				if (!it) return
				const dx = r5(c.xs[i] - (Number(it.x) || 0))
				for (const m of [id, ...(R.get(id) ?? [])]) {
					const o = byId.get(m)
					if (o) o.x = r5((Number(o.x) || 0) + dx)
				}
			})
		} else if (c.kind === "spread") {
			// (a row's gaps scaled about its first thing: "space the soda cans closer together"; what rides on each goes with it)
			const x0 = Number(byId.get(c.about)?.x) || 0
			for (const id of c.ids) {
				const it = byId.get(id)
				if (!it || id === c.about) continue
				const dx = r5(((Number(it.x) || 0) - x0) * (c.k - 1))
				for (const m of [id, ...(R.get(id) ?? [])]) {
					const o = byId.get(m)
					if (o) o.x = r5((Number(o.x) || 0) + dx)
				}
			}
		}
		// what rests on a thing whose shape or slope changed is put back on it, at the same resting distance as before
		for (const cid of c.kind === "prop" || c.kind === "turn" ? [c.id] : c.kind === "scale" ? c.ids : []) {
			if (!(R.get(cid) ?? []).length) continue
			try {
				const ins0 = inspect(scene)
				for (const rid of R.get(cid)) {
					const it = byId.get(rid)
					if (!it || (c.ids ?? []).includes(rid)) continue
					const g0 = ins0.gap(rid, cid)
					const g1 = inspect(s).gap(rid, cid)
					if (g0 !== null && g1 !== null && Math.abs(g1 - g0) > 1e-5) it.y = r5((Number(it.y) || 0) - (g1 - g0))
				}
			} catch {}
		}
		// (what comes after it along the table keeps its gap to it: a row made longer pushes the rest of the chain along by as much, c.follow)
		if (Array.isArray(c.follow) && c.follow.length && (c.kind === "prop" || c.kind === "scale")) {
			try {
				const id = c.id ?? c.ids[0]
				const b0 = inspect(scene).box(id)
				const b1 = inspect(s).box(id)
				const d = r5(c.side < 0 ? b1.x0 - b0.x0 : b1.x1 - b0.x1)
				if (Math.abs(d) > 1e-4) {
					const ids = new Set()
					for (const f of c.follow) (ids.add(f), (R.get(f) ?? []).forEach((r) => ids.add(r)))
					for (const f of ids) {
						const o = byId.get(f)
						if (o) o.x = r5((Number(o.x) || 0) + d)
					}
					c.shift = d
				}
			} catch {}
		}
	}
	widenTable(s, scene)
	return s
}
/** A thing's lowest point at its pose (m), or null. */
function lowAt(it) {
	try {
		return Math.min(...shapesAt(itemGeometry(it.type, it.props ?? {}, it.fixed === true), Number(it.x) || 0, Number(it.y) || 0, Number(it.angle) || 0).map((q) => q.y0))
	} catch {
		return null
	}
}
/** A kind's size settings, from the catalog's own resize handles: {all: [keys], h: the height key or null} ("water-bottle": diameter and
 *  height; a ball: its diameter; a plank: its length). */
const SIZE_KEYS = new Map()
export function sizeKeys(type) {
	if (SIZE_KEYS.has(type)) return SIZE_KEYS.get(type)
	const out = { all: [], h: null, w: null }
	try {
		const t = simCatalog().types.find((x) => x.key === type)
		for (const e of t?.edit ?? []) {
			if (e.kind === "size") {
				if (e.w) (out.all.push(e.w), (out.w = e.w))
				if (e.h) (out.all.push(e.h), (out.h = e.h))
			} else if ((e.kind === "radius" || e.kind === "length") && e.prop) out.all.push(e.prop)
		}
	} catch {}
	out.all = [...new Set(out.all)].filter((k) => num(propSpec(type, k)?.default) !== null || propSpec(type, k))
	SIZE_KEYS.set(type, out)
	return out
}
// ================================================================ what the person chose stays what they chose: its size, its weight, its words
const CAT_TYPES = new Map()
const catType = (type) => {
	if (!CAT_TYPES.size)
		try {
			for (const t of simCatalog().types) CAT_TYPES.set(t.key, t)
		} catch {}
	return CAT_TYPES.get(type) ?? null
}
/** Kinds with a real everyday size (a ball, an orange, an egg, a soda can, a book): a fix keeps them within STD_SIZE of the catalog's own. */
export function standardSized(type) {
	const c = catType(type)?.category
	return (c === "Balls" && type !== "clay-ball") || c === "Everyday objects"
}
const sameNum = (x, y) => (typeof x === "number" && typeof y === "number" ? Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y)) : x === y)
export const STD_SIZE = 0.2 // (±20 % of the catalog's size: a ping-pong ball is 4 cm, never 10)
export const CHAR_MIN = 0.6 // (a thing of the person's keeps at least 0.6× the size and the weight it had, and at most 1/0.6 of them)
/** The ways the person's words gave things without an amount, from the hard choices ("mass:up:heavy"): Map id -> Map key -> {way: 1 | -1, word}. */
export function waysOf(hard) {
	const out = new Map()
	for (const [id, keys] of hard instanceof Map ? hard : Array.isArray(hard) ? hard : []) {
		if (keys === "all") continue
		for (const k of keys ?? []) {
			const m = /^(\w+):(up|down)(?::(\w+))?$/.exec(String(k))
			if (!m) continue
			;(out.get(id) ?? out.set(id, new Map()).get(id)).set(m[1], { way: m[2] === "up" ? 1 : -1, word: m[3] ?? (m[2] === "up" ? "bigger" : "smaller") })
		}
	}
	return out
}
/**
 * Is a thing still what the person chose after a change to it (a: as it was, b: as changed)? Never the other way from a word they gave it
 * ("a heavy steel weight" made 100 g: V8820 x5); and a thing of theirs (mine: swapped in or added) keeps its kind's real size (within STD_SIZE of
 * the catalog's, for a kind that has one: a 4 cm ping-pong ball made 10 cm, c01) and at least CHAR_MIN of the size and weight it had (a 7.3 kg
 * bowling ball made a 151 g one, VERIFY plainswap2). -> null, or why not in words.
 */
/** A kind's settings that are a length of it (unit m, more than nothing by default: a box's depth, a bob's diameter, a wall's height; never an
 *  offset that may go either side) and its weights (unit kg, a bob's weight left to follow its size included): {len, kg}. */
const DIM_KEYS = new Map()
export function dimKeys(type) {
	if (DIM_KEYS.has(type)) return DIM_KEYS.get(type)
	const out = { len: [], kg: [] }
	try {
		for (const p of catType(type)?.props ?? []) {
			if (p.unit === "m" && (num(p.default) ?? 0) > 0 && !/offset|shift|_x$|_y$/.test(p.key)) out.len.push(p.key)
			else if (p.unit === "kg") out.kg.push(p.key)
		}
	} catch {}
	DIM_KEYS.set(type, out)
	return out
}
/** A setting's word for a person: "depth" for "front to back", "across" for a diameter. */
const dimWord = (type, k) => (/diam|radius/.test(k) ? "across" : /^front to back$/i.test(propSpec(type, k)?.label ?? "") ? "depth" : String(propSpec(type, k)?.label ?? k.replace(/_/g, " ")).toLowerCase())
/** "10 cm → 1 m", "5 → 8 cm": each value in its own unit, one unit when both are in it. */
const lenTo = (a, b) => {
	const fa = fmtLen(a)
	const fb = fmtLen(b)
	return fa.split(" ")[1] === fb.split(" ")[1] ? `${fa.split(" ")[0]} → ${fb}` : `${fa} → ${fb}`
}
export function keepsCharacter(a, b, { mine = true, ways = null } = {}) {
	if (!a || !b || a.type !== b.type) return null
	const nm = theName(b).replace(/ \([^)]*\)/g, "")
	const w = ways ?? new Map()
	// (every length of it, not only the ones a handle on screen resizes: a cardboard box made 1 m deep front to back, a pendulum's bob made
	// bigger, were offered as checked fixes: V8832 y5 / y14 / y15)
	const dims = dimKeys(b.type)
	const keys = new Set([...sizeKeys(b.type).all, ...dims.len, ...[...w.keys()].filter((k) => k !== "mass")])
	for (const k of keys) {
		const v0 = num(propValue(a, k))
		const v1 = num(propValue(b, k))
		if (v0 === null || v1 === null || Math.abs(v1 - v0) <= 1e-9 * Math.max(1, Math.abs(v0))) continue
		const sp = propSpec(b.type, k)
		const what = dimWord(b.type, k)
		const way = w.get(k)
		if (way && Math.sign(v1 - v0) === -way.way) return `it made ${nm} ${way.way > 0 ? "smaller" : "bigger"} (${what} ${lenTo(v0, v1)}), and you asked for ${/^[aeiou]/.test(way.word) ? "an" : "a"} ${way.word} one`
		if (!mine || !(sizeKeys(b.type).all.includes(k) || dims.len.includes(k))) continue
		const d = num(sp?.default)
		if (sizeKeys(b.type).all.includes(k) && standardSized(b.type) && d && (v1 < (1 - STD_SIZE) * d - 1e-9 || v1 > (1 + STD_SIZE) * d + 1e-9)) return `it made ${nm} ${fmtLen(v1)} ${/across/.test(what) ? "across" : what}, far from a real one’s ${fmtLen(d)}`
		if (v0 > 0 && (v1 < CHAR_MIN * v0 - 1e-9 || v1 > v0 / CHAR_MIN + 1e-9)) return `it made ${nm} far ${v1 < v0 ? "smaller" : "bigger"} (${what} ${lenTo(v0, v1)})`
	}
	// (its weight as the engine builds it, a weight left to follow its size included (a pendulum's bob))
	const m0 = weightOf(a.type, a.props ?? {})
	const m1 = weightOf(b.type, b.props ?? {})
	if (m0 && m1 && Math.abs(m1 - m0) > 1e-6 * m0) {
		const way = w.get("mass")
		if (way && Math.sign(m1 - m0) === -way.way) return `it made ${nm} ${way.way > 0 ? "lighter" : "heavier"} (${fmtMass(m0)} → ${fmtMass(m1)}), and you asked for ${/^[aeiou]/.test(way.word) ? "an" : "a"} ${way.word} one`
		// (its weight bounded where any length or weight of it was changed: a can emptied or filled is the AI's own way of doing it (§16), never a
		// thing made a different thing; a box made deeper or a bob bigger is: V8832 y5, 34 g → 335 g, 514 g → 2.1 kg)
		const sized = [...new Set([...sizeKeys(b.type).all, ...dims.len])].some((k) => !sameNum(propValue(a, k), propValue(b, k)))
		const weighed = [...new Set(["mass", ...dims.kg])].some((k) => !sameNum(a.props?.[k], b.props?.[k]))
		if (mine && (sized || weighed) && (m1 < CHAR_MIN * m0 * (1 - 1e-6) || m1 > (m0 / CHAR_MIN) * (1 + 1e-6))) return `it made ${nm} far ${m1 < m0 ? "lighter" : "heavier"} (${fmtMass(m0)} → ${fmtMass(m1)})`
	}
	return null
}
/** The first thing a changed scene (b) no longer keeps as the person chose it, compared with a (the scene the fix starts from), or null: their
 *  things (added or swapped in since `before`) by keepsCharacter, and any thing their words gave a way (ctx.hard's "mass:up:heavy"). */
export function characterBreak(a, b, before = null, hard = null) {
	const ways = waysOf(hard)
	const A = new Map((a?.items ?? []).map((i) => [i.id, i]))
	const was = before?.items ? new Map(before.items.map((i) => [i.id, i.type])) : null
	for (const it of b?.items ?? []) {
		const o = A.get(it.id)
		if (!o || o.type !== it.type || it.type === "table" || it.type === "wall") continue
		if (JSON.stringify(o.props ?? {}) === JSON.stringify(it.props ?? {})) continue
		const mine = !!was && was.get(it.id) !== it.type
		if (!mine && !ways.has(it.id)) continue
		const why = keepsCharacter(o, it, { mine, ways: ways.get(it.id) ?? null })
		if (why) return why
	}
	return null
}
/** Does a candidate keep to the table and add no overlap (a thing moved into another, off the table's end, into a safety wall)? */
function fits(cand, base, baseOverlaps) {
	const o = overlapsOf(cand)
	// (the engine itself says what starts inside what: here only clear overlaps are turned away before a run)
	for (const [k, d] of o) if (d > (baseOverlaps.get(k) ?? 0) + 0.0025) return false
	const table = cand.items.find((i) => i.type === "table")
	if (table) {
		const w = Number(table.props?.width ?? 3.7)
		const L = Number(table.x) - w / 2
		const Rr = Number(table.x) + w / 2
		let ins
		try {
			ins = inspect(cand)
		} catch {
			return false
		}
		const was = new Map(base.items.map((i) => [i.id, JSON.stringify(i)]))
		for (const it of cand.items) {
			if (it.type === "table" || it.type === "wall" || was.get(it.id) === JSON.stringify(it)) continue
			const b = ins.box(it.id)
			if (b && (b.x0 < L - 0.002 || b.x1 > Rr + 0.002)) return false
		}
	}
	return true
}

// ================================================================ the candidates
/** What of a thing's place the person set, which the search leaves as it is: {x, y, angle}. touched: "place" is all of it; "place-x",
 *  "place-y", "place-angle" one way only ("raise the box 12 cm" set its height: it may still slide along). */
export function lockOf(touched, id) {
	const s = touched?.get?.(id)
	const all = s === "all" || !!s?.has?.("place")
	return { x: all || !!s?.has?.("place-x"), y: all || !!s?.has?.("place-y"), angle: all || !!s?.has?.("place-angle") }
}
const MOVE_STEPS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2]
const TURN_STEPS = [0.5, 1, 1.5, 2, 3, 4, 5, 6]
const DEG_STEPS = [1, 2, 3, 4, 5, 6, 8]
const REL_STEPS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4]
/** How a person would weigh a change: a centimetre, a degree, or a 5% change of a setting is 1; what the person touched counts double. */
const moveCost = (dx, dy) => (Math.abs(dx) + Math.abs(dy)) / 0.01 + (Math.abs(dx) > 1e-9 && Math.abs(dy) > 1e-9 ? 1 : 0) // (one direction is simpler to say and to do)

/**
 * The obvious knobs of the things in the run's chain (nearest the goal first). -> [{id, label, gen: () => [{changes, cost}]}]
 * touched: Map id -> Set of what the edit set ("place" and prop keys) or "all"; swapped: Set of ids whose kind the edit changed.
 */
function knobCandidates({ scene, order, containers, touched, swapped, inAir, riders, restsOn, resolved = null, flex = false, before = null, locks = null, soft = null }) {
	const out = []
	const setBy = (id) => touched?.get?.(id) ?? null
	// (flex: a request that only states an outcome, "make it land in cup 3": what the edit set on the way may be adjusted further, never more
	// than a quarter of the way back)
	// (locks: what is the person's own choice, when it is known apart from what the edit set (the search after a plain edit, §16): only that is
	// held; soft: what they asked for without an amount ("move the seesaw along"), which may go further that way, never back)
	const FREE = { x: false, y: false, angle: false }
	const held = locks ?? touched
	const lock = (id) => (flex ? FREE : lockOf(held, id))
	const propSet = (id, k) => {
		const s = held?.get?.(id) ?? null
		return !flex && (s === "all" || !!s?.has?.(k))
	}
	const softOn = (id, key) => {
		const s = soft?.get?.(id)
		if (!s) return false
		return key === "x" || key === "y" || key === "angle" ? [...s].some((k) => /^place/.test(k)) : s.has(key)
	}
	const was = (id) => before?.items?.find?.((i) => i.id === id) ?? null
	/** May a knob move this much on what the edit set (key: "x", "y", "angle" or a prop)? Not back more than a quarter of the edit's own change. */
	const forward = (id, key, d) => {
		const s = setBy(id)
		if (!(flex || softOn(id, key)) || !s) return true
		const a = was(id)
		const b = scene.items.find((i) => i.id === id)
		if (!a || !b) return true
		const e = key === "x" || key === "y" ? (Number(b[key]) || 0) - (Number(a[key]) || 0) : key === "angle" ? (Number(b.angle) || 0) - (Number(a.angle) || 0) : (num(propValue(b, key)) ?? 0) - (num(propValue(a, key)) ?? 0)
		return Math.abs(e) < 1e-9 || Math.sign(d) === Math.sign(e) || Math.abs(d) <= 0.25 * Math.abs(e)
	}
	const mult = (id) => (setBy(id) ? 2 : 1)
	const push = (changes, cost, why) => out.push({ changes, cost, why })
	const isRider = (id) => [...riders.values()].some((l) => l.includes(id))
	for (const id of order) {
		const it = scene.items.find((i) => i.id === id)
		if (!it || it.type === "table" || it.type === "wall") continue
		// (a big fixed structure, a board or a stand, is the last thing a person would shift)
		const structure = isStaticItem(it.type, it.fixed === true) && !containers.has(id) && !["plank", "seesaw", "domino-row"].includes(it.type)
		const m = mult(id) * (containers.has(id) ? 0.9 : 1) * (structure ? 1.5 : 1)
		const carried = (riders.get(id) ?? []).length
		const carryK = 1 + 0.2 * carried
		const air = inAir.has(id)
		// (a moving thing that rests on something other than the table, a ball in a launcher or on a seesaw, goes where that goes: never alone)
		// (and one not known to stand on the table: a ball sitting inside a launcher's guides)
		const perched = !isStaticItem(it.type, it.fixed === true) && !it.held && scene.items.find((i) => i.id === restsOn.get(id))?.type !== "table"
		// place: along the table (and up and down for a thing in the air: a hung box, a held ball); a thing resting on another goes with it, not alone
		// (a ramp is turned rather than slid along the table)
		const slide = it.type === "plank" ? 1.5 : 1
		// (a thing the person added stays where they put it, give or take 10 cm: c02, 16 Oct)
		const steps = locks && before?.items && !before.items.some((b) => b.id === id) ? MOVE_STEPS.filter((d) => d <= 0.1) : MOVE_STEPS
		if (!isRider(id) && !perched) {
			if (!lock(id).x) for (const d of steps) for (const s of [1, -1]) if (forward(id, "x", s * d)) push([{ kind: "move", ids: [id], dx: s * d, dy: 0 }], moveCost(d, 0) * m * carryK * slide, "x")
			if (air && !lock(id).y) for (const d of steps) for (const s of [1, -1]) if (forward(id, "y", s * d)) push([{ kind: "move", ids: [id], dx: 0, dy: s * d }], moveCost(0, d) * m * carryK, "y")
		}
		// a thing waiting on a ramp (a car, a ball): started further up or down that ramp
		const sup = scene.items.find((i) => i.id === restsOn.get(id))
		if (perched && !it.held && sup?.type === "plank" && Math.abs(Number(sup.angle) || 0) > 0.5 && !lock(id).x)
			for (const d of MOVE_STEPS) for (const s of [1, -1]) if (forward(id, "x", s * d)) push([{ kind: "slide", id, on: sup.id, dx: s * d }], moveCost(d, 0) * m, "slide")
		// a fan turned round, to blow the other way (c01: a fan at the left end blowing the ping-pong ball along the table, not off it)
		if (/^(fan|blower)/.test(it.type) && !lock(id).angle) push([{ kind: "turn", id, d: 180 }], 12 * m, "flip")
		// a ramp's slope (nothing resting on it)
		if (it.type === "plank" && Math.abs(Number(it.angle) || 0) > 0.5 && !propSet(id, "angle") && !lock(id).angle && !carried)
			for (const d of TURN_STEPS) for (const s of [1, -1]) if (forward(id, "angle", s * d)) push([{ kind: "turn", id, d: s * d }], d * 1.2 * m, "angle")
		// settings that decide how the chain goes on
		const props = {
			seesaw: [["tilt", "deg"]],
			"domino-row": [["spacing", "rel"]],
			"spring-launcher": [["compression", "rel"]],
			catapult: [["pull_back", "deg"]],
			"spring-catapult": [["pull_back", "deg"]],
			"conveyor-belt": [["speed", "rel"]],
			// (how a springy thing gives a bounce back: its stiffness, a mat's weight, how high it stands)
			trampoline: [["stiffness", "rel"], ["mat_mass", "rel"], ["height", "m"]],
			"bounce-pad": [["stiffness", "rel"], ["rest_length", "rel"]],
			fan: [["speed", "rel"], ["diameter", "rel"]]
		}[it.type] ?? []
		for (const [k, how] of props) {
			const sp = propSpec(it.type, k)
			const v0 = num(propValue(it, k))
			if (!sp || v0 === null || propSet(id, k)) continue
			const lo = num(sp.min) ?? -Infinity
			const hi = num(sp.max) ?? Infinity
			const steps = how === "deg" ? DEG_STEPS : how === "m" ? [0.005, 0.01, 0.02, 0.03, 0.05, 0.08] : REL_STEPS
			for (const d of steps)
				for (const s of [1, -1]) {
					// (a value a person would type: a half degree, a millimetre, two figures)
					const raw = how === "rel" ? v0 * (1 + s * d) : v0 + s * d
					const to = how === "deg" ? Math.round(raw * 2) / 2 : how === "m" ? Math.round(raw * 1000) / 1000 : Number(raw.toPrecision(raw < 1 ? 2 : 3))
					if (to < lo || to > hi || Math.abs(to - v0) < 1e-9 || !forward(id, k, to - v0)) continue
					const cost = (how === "deg" ? d : how === "m" ? d / 0.01 : d / 0.05) * 2 * m // (a setting is less plain to see than a place)
					push([{ kind: "prop", id, key: k, from: v0, to: r5(to) }], cost, k)
				}
		}
		// the weight of a thing whose kind the edit swapped (a tennis ball is 9× the plastic ball it replaced): it stays that kind
		if (swapped?.has?.(id) && propSpec(it.type, "mass") && !it.props?.mass) {
			// (a weight that follows the size has no number in the scene: the engine's own figure for it)
			const v0 = num(propValue(it, "mass")) ?? num(resolved?.[id]?.mass)
			if (v0)
				for (const d of [0.1, 0.2, 0.3, 0.45, 0.6])
					for (const s of [1, -1]) {
						const to = v0 * (1 + s * d)
						const sp = propSpec(it.type, "mass")
						if (to < (num(sp.min) ?? 0) || to > (num(sp.max) ?? Infinity)) continue
						push([{ kind: "prop", id, key: "mass", from: v0, to: Number(to.toPrecision(2)) }], (d / 0.05) * 2.5, "mass")
					}
		}
	}
	return out
}

// ================================================================ a stand-in for a lost hit
let TIPPERS = null
/** The catalog's things that make a hard hit from a light push: heavy (≥ 0.8 kg), and tall and thin stood up (angle 0° or 90°): a closed
 *  laptop or a cutting board on its edge. -> [{type, angle, h, w, kg}], the thinnest first. */
export function tippers() {
	if (TIPPERS) return TIPPERS
	const out = []
	try {
		for (const t of simCatalog().types) {
			if (["table", "wall"].includes(t.key) || isStaticItem(t.key, false)) continue
			const kg = weightOf(t.key, {})
			if (!(kg >= 0.8)) continue
			for (const angle of [0, 90]) {
				const q = shapesAt(itemGeometry(t.key, {}, false), 0, 0, angle)
				const w = Math.max(...q.map((z) => z.x1)) - Math.min(...q.map((z) => z.x0))
				const h = Math.max(...q.map((z) => z.y1)) - Math.min(...q.map((z) => z.y0))
				const low = Math.min(...q.map((z) => z.y0))
				if (h >= 0.2 && h / w >= 8) out.push({ type: t.key, angle, h, w, kg, low })
			}
		}
	} catch {}
	TIPPERS = out.sort((a, b) => a.w - b.w).slice(0, 3)
	// (and the thinnest made thinner, when its thickness is a setting: a closed laptop 6 mm thick tips where an 11 mm one stands (V8817 m2,
	// found only by the AI's rework): stood on its edge, its thickness is its foot)
	try {
		const t0 = TIPPERS[0]
		const thick = t0 && t0.angle === 90 ? propSpec(t0.type, "height") : null
		if (thick && num(thick.default) !== null && num(thick.min) !== null) {
			const v = Math.max(thick.min, Math.round(thick.default * 0.55 * 2000) / 2000)
			if (v < thick.default - 0.002) {
				const q = shapesAt(itemGeometry(t0.type, { height: v }, false), 0, 0, 90)
				TIPPERS.push({ ...t0, props: { height: v }, w: Math.max(...q.map((z) => z.x1)) - Math.min(...q.map((z) => z.x0)), h: Math.max(...q.map((z) => z.y1)) - Math.min(...q.map((z) => z.y0)), low: Math.min(...q.map((z) => z.y0)), thin: v })
			}
		}
	} catch {}
	return TIPPERS
}
/**
 * When the change took away what struck the thing that throws the goal's thing (the dominoes that struck the seesaw), and what took its place
 * is far too light to (a row of soda cans: the seesaw turns 1°), a stand-in: one heavy, tall, thin thing stood just before it, where the row
 * tips it over onto it as the old one fell (D1, 16 Oct: no setting of the cans alone works; a closed laptop on its edge does). The row is laid
 * out up to it (a can's width apart and more), emptied too where it is a kind that can be (a full can is never tipped by a light ball).
 * -> [{changes, cost, why: "standin"}]
 */
function standInCandidates({ scene, sim, before, targets, locks = null, soft = null }) {
	if (!before?.sim?.track?.frames?.length || !before?.scene?.items || !sim?.summary) return []
	const t = targets.find((x) => goalKind(x.goal) === "in" && !x.implicit)
	if (!t) return []
	const g = t.goal
	const run0 = before.sim
	const sc0 = before.scene
	const solids0 = new Map((run0.doc?.solids ?? []).map((x) => [x.id, x]))
	const typeOf0 = new Map(sc0.items.map((i) => [i.id, i.type]))
	const firstHit = (id, not = []) =>
		(run0.track.impacts ?? [])
			.map((h) => ({ t: h.t, speed: h.speed ?? 0, a: solids0.get(h.a), b: solids0.get(h.b) }))
			.filter((h) => h.a && h.b && h.a.item !== h.b.item && (h.a.item === id || h.b.item === id))
			.map((h) => ({ ...h, by: h.a.item === id ? h.b : h.a, self: h.a.item === id ? h.a : h.b }))
			.filter((h) => !["table", "wall"].includes(typeOf0.get(h.by.item)) && !not.includes(h.by.item) && h.speed >= 0.1)
			.sort((p, q) => p.t - q.t)[0] ?? null
	const launch = firstHit(g.item, [g.container])
	if (!launch) return []
	const L = launch.by.item
	const drive = firstHit(L, [g.item, g.container])
	if (!drive) return []
	const D = drive.by
	// (its driver is gone or another kind now, or still there but what of it strikes is far lighter (14 small dominoes for 7 growing ones: the
	// last weighs 40 g, not 1.3 kg: c11, 16 Oct); and it does far less now)
	const now = scene.items.find((i) => i.id === D.item)
	let lighter = false
	if (now && now.type === typeOf0.get(D.item)) {
		const m0 = solidMass(run0.doc, D)
		const parts = (sim.doc?.solids ?? []).filter((x) => x.item === D.item && x.kind === "dynamic")
		const m1 = parts.length ? Math.max(...parts.map((x) => solidMass(sim.doc, x) ?? 0)) : null
		// (or as heavy but striking far slower: 14 growing dominoes that reach the seesaw at 0.2 m/s where 7 did at 0.65 m/s, V8817 c11 r2)
		const ids1 = new Set(parts.map((x) => x.id))
		const of1 = new Map((sim.doc?.solids ?? []).map((x) => [x.id, x.item]))
		const v1 = Math.max(0, ...(sim.track?.impacts ?? []).filter((h) => (ids1.has(h.a) && of1.get(h.b) === L) || (ids1.has(h.b) && of1.get(h.a) === L)).map((h) => h.speed ?? 0))
		const slower = m1 > 0 && v1 < 0.5 * (drive.speed ?? 0)
		if (!(m0 > 0) || !(m1 > 0) || (m1 > 0.5 * m0 && !slower)) return []
		lighter = true
	}
	const Lit = scene.items.find((i) => i.id === L)
	if (!Lit || Lit.type !== typeOf0.get(L)) return []
	const turned = (run) => Number(/^turns (\d+(?:\.\d+)?)°/.exec((run?.summary?.stories ?? []).find((st) => st.item === L)?.text ?? "")?.[1] ?? 0)
	const t0 = turned(run0)
	if (!(t0 >= 5) || turned(sim) >= 0.5 * t0) return []
	// where the driver struck it, and from which side
	const frames = run0.track.frames
	const f = frames.reduce((p, q) => (Math.abs(q.t - drive.t) < Math.abs(p.t - drive.t) ? q : p))
	const pD = outlinePts(D.body, f.placements?.[D.id])
	const pL = outlinePts(drive.self.body, f.placements?.[drive.self.id])
	if (!pD.length || !pL.length) return []
	let best = null
	for (const a of pD) for (const b of pL) {
		const d = Math.hypot(a[0] - b[0], a[1] - b[1])
		if (!best || d < best.d) best = { d, x: a[0], y: a[1] }
	}
	const x0D = frames[0]?.placements?.[D.id]?.x
	if (!best || !Number.isFinite(x0D)) return []
	const dir = Math.sign(best.x - x0D) || 1
	let ins
	try {
		ins = inspect(scene)
	} catch {
		return []
	}
	const table = scene.items.find((i) => i.type === "table")
	const top = table ? ins.box(table.id)?.y1 ?? 0 : 0
	const cy = best.y - top
	if (lighter) return lighterDriverStandIns({ scene, before, row: now, L: Lit, best, dir, top, cy, locks, soft })
	// the row that took the driver's place: things the change added, of one kind, standing between where the driver was and the thing it struck
	const was = new Map(sc0.items.map((i) => [i.id, i.type]))
	const kinds = new Map()
	for (const it of scene.items) {
		if (was.get(it.id) === it.type || ["table", "wall"].includes(it.type) || isStaticItem(it.type, it.fixed === true) || it.held) continue
		const bx = ins.box(it.id)
		if (!bx || (dir > 0 ? bx.x1 > best.x : bx.x0 < best.x) || Math.abs(bx.y0 - top) > 0.01) continue
		kinds.set(it.type, [...(kinds.get(it.type) ?? []), it])
	}
	const row = [...kinds.values()].sort((a, b) => b.length - a.length)[0]
	if (!row || row.length < 2) return []
	row.sort((a, b) => dir * ((Number(a.x) || 0) - (Number(b.x) || 0)))
	const ids = row.map((i) => i.id)
	const half = Math.max(...row.map((i) => {
		const bx = ins.box(i.id)
		return bx ? (bx.x1 - bx.x0) / 2 : 0.03
	}))
	const xs0 = row.map((i) => Number(i.x) || 0)
	const gaps0 = xs0.slice(1).map((x, i) => Math.abs(x - xs0[i]))
	const sp0 = gaps0.length ? gaps0.reduce((p, q) => p + q, 0) / gaps0.length : 0
	const full = propSpec(row[0].type, "full") && row.every((i) => propValue(i, "full") === true)
	// (how far back the row may start: up to 1 cm from the nearest thing behind it at its height, a ramp's end; never past where it starts now
	// by more than 15 cm)
	const b0 = ins.box(row[0].id)
	let limit = (Number(row[0].x) || 0) - dir * 0.15
	for (const o of scene.items) {
		if (ids.includes(o.id) || ["table", "wall"].includes(o.type)) continue
		const ob = ins.box(o.id)
		if (!ob || !b0 || ob.y0 > b0.y1 || ob.y1 < b0.y0) continue
		const edge = dir > 0 ? ob.x1 : ob.x0
		if (dir * ((Number(row[0].x) || 0) - edge) < 0) continue
		const lim = edge + dir * (half + 0.01)
		if (dir * (lim - limit) > 0) limit = lim
	}
	const out = []
	const id = (() => {
		let k = 1
		while (scene.items.some((i) => i.id === `standin${k}`)) k++
		return `standin${k}`
	})()
	for (const tp of tippers()) {
		if (!(tp.h > cy + 0.02)) continue
		const reach = Math.sqrt(tp.h * tp.h - cy * cy)
		// (its top landing where the old driver struck, or up to 24 cm further along toward the pivot: V8817 m2's working laptop stood 7 cm
		// past the last landing point this tried)
		for (let k = 0; k <= 16; k++) {
			const land = best.x + dir * 0.015 * k
			const base = land - dir * reach
			for (const gap of [0.01, 0.03]) {
				const last = base - dir * (tp.w / 2 + gap + half)
				// (the row laid out up to it, a can's width apart or as it was; or its first one kept where the chain reaches it and the rest spread
				// evenly up to the tipper: V8817 m2, toilet rolls 15 → 11 cm apart from the first one, found only by the AI's rework)
				const tight = 2 * half + 0.004
				const anchored = row.length > 1 ? (dir * (last - xs0[0])) / (row.length - 1) : null
				const sps = [...new Set([tight, Math.max(tight, Math.min(sp0, 0.1)), ...(anchored !== null && anchored >= 2 * half + 0.0015 && anchored <= 0.2 ? [anchored] : [])].map((v) => Math.round(v * 1000) / 1000))]
				for (const sp of sps) {
					const xs = row.map((_, i) => r5(last - dir * (row.length - 1 - i) * sp))
					if (dir * (xs[0] - limit) < 0) continue
					const item = { id, type: tp.type, name: typeName(tp.type), x: r5(base), y: r5(top - tp.low), angle: tp.angle, props: { ...(tp.props ?? {}) } }
					const changes = [{ kind: "add", item, row: ids, near: L }, { kind: "layout", ids, xs, sp }]
					if (full) changes.push({ kind: "props", ids, key: "full", from: true, to: false })
					out.push({ changes, cost: 30 + 100 * Math.abs(land - best.x) + (full ? 4 : 0) + Math.abs(sp - sp0) * 30 + (tp.thin ? 3 : 0), why: "standin" })
				}
			}
		}
	}
	return out
}
/**
 * The stand-in when the thing that struck the launcher is still there but far lighter where it strikes (a row of small dominoes): the tipper
 * stood right after the row, the launcher and what comes after it (on that side along the table) moved along to make room so the tipper's top
 * lands where the old last domino struck, and the row grown a little (its last one heavier, the rest carried along with it) when its growth is
 * not the person's. row: the driver as it is now; L: the launcher; best: where it was struck before (the world, before's run); dir: from the
 * driver to the launcher; top: the table's top; cy: the strike's height above the table. -> [{changes, cost, why: "standin"}]
 */
function lighterDriverStandIns({ scene, before, row, L, best, dir, top, cy, locks, soft }) {
	const out = []
	const heldKey = (id, k) => {
		const s = locks?.get?.(id)
		return s === "all" || !!s?.has?.(k)
	}
	let ins
	try {
		ins = inspect(scene)
	} catch {
		return out
	}
	const rb = ins.box(row.id)
	const Lb0 = before.scene.items.find((i) => i.id === L.id)
	if (!rb || !Lb0) return out
	// what makes room: everything past the row's end on the launcher's side (what rides on those comes along)
	const R = riderMap(scene)
	const riding = new Set([...R.values()].flat())
	const follow = scene.items
		.filter((o) => o.id !== row.id && !["table", "wall"].includes(o.type) && !o.held && !riding.has(o.id) && (dir > 0 ? (ins.box(o.id)?.x0 ?? -Infinity) >= rb.x1 - 0.03 : (ins.box(o.id)?.x1 ?? Infinity) <= rb.x0 + 0.03))
		.map((o) => o.id)
	if (!follow.includes(L.id) || follow.some((f) => heldKey(f, "place") || heldKey(f, "place-x"))) return out
	// (a thing the person asked to move one way is never moved back the other)
	const backward = (dx) =>
		follow.some((f) => {
			const sf = soft?.get?.(f)
			if (!sf || ![...sf].some((k) => /^place/.test(k))) return false
			const a = before.scene.items.find((i) => i.id === f)
			const b = scene.items.find((i) => i.id === f)
			const e = (Number(b?.x) || 0) - (Number(a?.x) || 0)
			return Math.abs(e) > 1e-6 && Math.sign(e) !== Math.sign(dx)
		})
	const g0 = num(propValue(row, "growth"))
	const grows = row.type === "domino-row" && g0 !== null && !heldKey(row.id, "growth") ? [0, 0.02, 0.04, 0.06] : [0]
	const id = (() => {
		let k = 1
		while (scene.items.some((i) => i.id === `standin${k}`)) k++
		return `standin${k}`
	})()
	const relBest = best.x - (Number(Lb0.x) || 0)
	for (const dg of grows) {
		const grow = dg ? [{ kind: "prop", id: row.id, key: "growth", from: g0, to: r5(Math.round((g0 + dg) * 1000) / 1000), follow, side: dir }] : []
		let s1
		try {
			s1 = grow.length ? applyChanges(scene, grow, R) : scene
		} catch {
			continue
		}
		let ins1
		try {
			ins1 = inspect(s1)
		} catch {
			continue
		}
		const rb1 = ins1.box(row.id)
		const L1 = s1.items.find((i) => i.id === L.id)
		if (!rb1 || !L1) continue
		const end = dir > 0 ? rb1.x1 : rb1.x0
		for (const tp of tippers()) {
			if (!(tp.h > cy + 0.02)) continue
			const reach = Math.sqrt(tp.h * tp.h - cy * cy)
			for (const gap of [0.005, 0.015, 0.03]) {
				const base = end + dir * (gap + tp.w / 2)
				for (let k = 0; k <= 8; k++) {
					// (its top lands on the launcher where the old driver struck it, or up to 12 cm further along it)
					const want = (Number(L1.x) || 0) + relBest + dir * 0.015 * k
					const dx = r5(base + dir * reach - want)
					if (Math.abs(dx) > 0.6 || backward(dx)) continue
					const item = { id, type: tp.type, name: typeName(tp.type), x: r5(base), y: r5(top - tp.low), angle: tp.angle, props: { ...(tp.props ?? {}) } }
					const changes = [...grow, { kind: "move", ids: follow, dx, dy: 0, reason: "to make room" }, { kind: "add", item, row: [row.id], near: L.id }]
					out.push({ changes, cost: 30 + dg * 300 + Math.abs(dx) * 20 + k * 1.5 + (tp.thin ? 3 : 0), why: "standin" })
				}
			}
		}
	}
	return out
}
/**
 * Size knobs on the person's new things, and a row in the chain grown (ai/DESIGN.md §16; the user's follow-up, 16 Oct: "add generic size/count/
 * prop knobs to the search"): the things a change added or swapped in, of one kind, made smaller or bigger together, each by the same factor of
 * its own size settings and standing where it stood ("make the 10 water bottles smaller (20.5 → 12 cm tall)"), or only shorter or taller, and
 * emptied or filled with it; and a row in the chain made to grow more (or start bigger, or spaced anew), what comes after it along the table
 * carried along by as much as the row's end moved ("make the dominoes grow faster, with the seesaw, Ball 2 and the box carried 50 cm along").
 * Never a setting the person gave (locks: their sizes, counts and places with an amount), never their count. -> [{changes, cost, why}]
 */
function sizeCandidates({ scene, before, order, locks, targets = null }) {
	const out = []
	if (!before?.items) return out
	// (never a thing something rests on: a shelf made shorter drops the ball on it, c01)
	let carriers = new Set()
	try {
		carriers = new Set([...riderMap(scene)].filter(([, rs]) => rs.length).map(([id]) => id))
	} catch {}
	const was = new Map(before.items.map((i) => [i.id, i.type]))
	const heldKey = (id, k) => {
		const s = locks?.get?.(id)
		return s === "all" || !!s?.has?.(k)
	}
	const groups = new Map()
	for (const it of scene.items) {
		if (was.get(it.id) === it.type || ["table", "wall"].includes(it.type) || it.held) continue
		groups.set(it.type, [...(groups.get(it.type) ?? []), it])
	}
	for (const [type, list] of groups) {
		const sk = sizeKeys(type)
		if (!sk.all.length) continue
		// (a stack the person put something on, the books under the pillow (c08): only made shorter, what rests on it re-seated with it; never
		// narrower or shorter along, which would drop what rests on it)
		if (list.some((i) => carriers.has(i.id))) {
			const ids = [...list].map((i) => i.id)
			if (sk.h && !list.some((i) => heldKey(i.id, sk.h))) for (const k of [0.8, 0.9]) out.push({ changes: [{ kind: "scale", ids, keys: [sk.h], k }], cost: (list.length > 1 ? 8 : 12) + 2 + Math.abs(1 - k) * 30, why: "size" })
			continue
		}
		const ids = [...list].sort((p, q) => (Number(p.x) || 0) - (Number(q.x) || 0)).map((i) => i.id)
		const free = (keys) => keys.filter((k) => !list.some((i) => heldKey(i.id, k)))
		const all = free(sk.all)
		const hk = sk.h && free([sk.h]).length ? [sk.h] : []
		const fulls = list.map((i) => propValue(i, "full"))
		const canFlip = !!propSpec(type, "full") && fulls.every((v) => typeof v === "boolean" && v === fulls[0]) && !list.some((i) => heldKey(i.id, "full"))
		const base = list.length > 1 ? 8 : 12
		if (all.length)
			for (const k of [0.6, 0.75, 0.9, 1.15, 1.3]) {
				out.push({ changes: [{ kind: "scale", ids, keys: all, k }], cost: base + Math.abs(1 - k) * 30, why: "size" })
				if (canFlip && k < 1) out.push({ changes: [{ kind: "scale", ids, keys: all, k }, { kind: "props", ids, key: "full", from: fulls[0], to: !fulls[0] }], cost: base + 6 + Math.abs(1 - k) * 30, why: "size" })
			}
		// (only slimmer or wider: a thin bottle tips where a fat one is shoved, c03, 16 Oct)
		const wk = sk.w && sk.h && free([sk.w]).length ? [sk.w] : []
		if (wk.length && all.length > 1)
			for (const k of [0.6, 0.7, 0.8, 0.9, 1.2]) {
				out.push({ changes: [{ kind: "scale", ids, keys: wk, k }], cost: base + 1 + Math.abs(1 - k) * 30, why: "size" })
				if (canFlip && k < 1) out.push({ changes: [{ kind: "scale", ids, keys: wk, k }, { kind: "props", ids, key: "full", from: fulls[0], to: !fulls[0] }], cost: base + 7 + Math.abs(1 - k) * 30, why: "size" })
			}
		// (and a row of them slimmer or smaller and closer together at once: a row of cans 12 cm tall stood 16 cm apart never knocks the next one
		// over, n08 live, 16 Oct)
		const row = list.length > 2 && list.every((i) => Math.abs((Number(i.y) || 0) - (Number(list[0].y) || 0)) < 0.005)
		if (row)
			for (const [keys, k] of [...(wk.length ? [[wk, 0.5], [wk, 0.7]] : []), ...(all.length ? [[all, 0.75]] : [])])
				for (const sp of [0.5, 0.6, 0.75]) out.push({ changes: [{ kind: "scale", ids, keys, k }, { kind: "spread", ids, about: ids[0], k: sp }], cost: base + 10 + Math.abs(1 - k) * 30 + Math.abs(1 - sp) * 20, why: "size" })
		if (hk.length && all.length > 1)
			for (const k of [0.6, 0.75, 0.9, 1.2]) {
				out.push({ changes: [{ kind: "scale", ids, keys: hk, k }], cost: base + 2 + Math.abs(1 - k) * 30, why: "size" })
				if (canFlip && k < 1) out.push({ changes: [{ kind: "scale", ids, keys: hk, k }, { kind: "props", ids, key: "full", from: fulls[0], to: !fulls[0] }], cost: base + 8 + Math.abs(1 - k) * 30, why: "size" })
			}
	}
	// a thing of the scene's own that the change stood on something new, re-seated higher or lower where it stood (the pillow on the new books,
	// c08: the counterweight lands on it 11 cm sooner and the pail lifts the orange 36 of 40 cm): made shorter, what rests on it with it, so what
	// lands on it lands as low as before (V8820: only the AI's rework found "the pillow shorter", by luck)
	for (const it of scene.items) {
		const b0 = before.items.find((i) => i.id === it.id)
		if (!b0 || b0.type !== it.type || ["table", "wall"].includes(it.type) || it.held || it.fixed) continue
		if (Math.abs((Number(it.y) || 0) - (Number(b0.y) || 0)) < 0.01 || Math.abs((Number(it.x) || 0) - (Number(b0.x) || 0)) > 0.01) continue
		const sk = sizeKeys(it.type)
		if (!sk.h || heldKey(it.id, sk.h) || heldKey(it.id, "place")) continue
		for (const k of [0.6, 0.75, 0.9]) out.push({ changes: [{ kind: "scale", ids: [it.id], keys: [sk.h], k }], cost: 10 + Math.abs(1 - k) * 30, why: "size" })
	}
	// a thing wider than the opening it must land in, made small enough to go in (never one the person sized or swapped in themselves: then
	// nothing but undoing their change would do)
	for (const t of targets ?? []) {
		if (goalKind(t.goal) !== "in" || !t.goal.container || !t.goal.item) continue
		const it = scene.items.find((i) => i.id === t.goal.item)
		const box = scene.items.find((i) => i.id === t.goal.container)
		if (!it || !box || was.get(it.id) !== it.type) continue
		const sk = sizeKeys(it.type)
		const d = num(propValue(it, "diameter"))
		const C = containerGeo(scene, null, box.id)
		if (!d || !C || !sk.all.includes("diameter") || heldKey(it.id, "diameter") || d < C.inR - C.inL - 0.002) continue
		for (const f of [0.8, 0.65, 0.5]) {
			const k = r5((f * (C.inR - C.inL)) / d)
			if (k < 0.05) continue
			out.push({ changes: [{ kind: "scale", ids: [it.id], keys: ["diameter"], k }], cost: 10 + (1 - f) * 10, why: "fit" })
		}
	}
	// a row in the chain grown, the rest of the chain after it carried along (never a row the person counted or sized themselves, nor what they
	// placed with an amount)
	let ins = null
	try {
		ins = inspect(scene)
	} catch {
		return out
	}
	for (const [k, id] of order.entries()) {
		const it = scene.items.find((i) => i.id === id)
		if (!it || it.type !== "domino-row") continue
		const bx = ins.box(id)
		if (!bx) continue
		const after = order.slice(k + 1).map((x) => scene.items.find((i) => i.id === x)).filter((o) => o && !["table", "wall"].includes(o.type))
		const right = after.filter((o) => (ins.box(o.id)?.x0 ?? -Infinity) >= bx.x1 - 0.03)
		const left = after.filter((o) => (ins.box(o.id)?.x1 ?? Infinity) <= bx.x0 + 0.03)
		const side = right.length >= left.length ? 1 : -1
		// (everything on that side of it along the table goes along, so the chain after it keeps its shape; what rides on those comes too)
		const follow = scene.items
			.filter((o) => o.id !== id && !["table", "wall"].includes(o.type) && !o.held && (side > 0 ? (ins.box(o.id)?.x0 ?? -Infinity) >= bx.x1 - 0.03 : (ins.box(o.id)?.x1 ?? Infinity) <= bx.x0 + 0.03))
			.map((o) => o.id)
		if (follow.some((f) => heldKey(f, "place") || heldKey(f, "place-x"))) continue
		const g0 = num(propValue(it, "growth")) ?? 1
		const gMax = num(propSpec(it.type, "growth")?.max) ?? 1.7
		if (!heldKey(id, "growth"))
			for (const d of [0.02, 0.04, 0.06, 0.09, 0.12, 0.15]) {
				const to = r5(Math.round((g0 + d) * 1000) / 1000)
				if (to > gMax) continue
				out.push({ changes: [{ kind: "prop", id, key: "growth", from: g0, to, follow, side }], cost: 14 + (d / 0.01) * 1.5, why: "grow" })
			}
		// (a row stood too close to tip, the next one jammed against it: spread out, what follows it carried along (V8832 c11: 14 dominoes
		// packed at 0.27 heights, none fell))
		const s0 = num(propValue(it, "spacing"))
		if (s0 && !heldKey(id, "spacing"))
			for (const f of [1.25, 1.5, 1.8]) {
				const to = r5(Math.round(s0 * f * 1000) / 1000)
				if (to > (num(propSpec(it.type, "spacing")?.max) ?? 2)) continue
				out.push({ changes: [{ kind: "prop", id, key: "spacing", from: s0, to, follow, side }], cost: 15 + (f - 1) * 30, why: "grow" })
			}
		const h0 = num(propValue(it, "first_height"))
		if (h0 && !heldKey(id, "first_height"))
			for (const f of [1.25, 1.5, 1.8]) {
				const to = r5(Math.round(h0 * f * 1000) / 1000)
				if (to > (num(propSpec(it.type, "first_height")?.max) ?? 0.4)) continue
				out.push({ changes: [{ kind: "prop", id, key: "first_height", from: h0, to, follow, side }], cost: 16 + (f - 1) * 40, why: "grow" })
			}
	}
	return out
}
/**
 * The things of one kind the edit added (a row of soda cans) as one knob each way (D1, 16 Oct: the search moved them one at a time, or not at
 * all, being the person's): all filled or emptied at once, where the kind can be ("empty the 6 soda cans"), and the row's gaps closer or wider
 * about its first one ("space the soda cans 3 cm closer together"); both together too. -> [{changes, cost, why}]
 */
function groupCandidates({ scene, before, locks = null }) {
	if (!before?.items) return []
	const was = new Map(before.items.map((i) => [i.id, i.type]))
	const groups = new Map()
	for (const it of scene.items) {
		if (was.get(it.id) === it.type || ["table", "wall"].includes(it.type) || isStaticItem(it.type, it.fixed === true) || it.held) continue
		groups.set(it.type, [...(groups.get(it.type) ?? []), it])
	}
	const out = []
	for (const [type, list] of groups) {
		if (list.length < 2) continue
		const ids = [...list].sort((p, q) => (Number(p.x) || 0) - (Number(q.x) || 0)).map((i) => i.id)
		const flips = []
		const sp = propSpec(type, "full")
		const fulls = list.map((i) => propValue(i, "full"))
		// (a fill the person asked for, "a row of full cans", is theirs)
		const heldFull = list.some((i) => !!locks?.get?.(i.id)?.has?.("full"))
		if (sp && fulls.every((v) => typeof v === "boolean" && v === fulls[0]) && !heldFull) flips.push({ kind: "props", ids, key: "full", from: fulls[0], to: !fulls[0] })
		// (a row: one y, along the table)
		const row = list.every((i) => Math.abs((Number(i.y) || 0) - (Number(list[0].y) || 0)) < 0.005)
		const spreads = row ? [0.6, 0.7, 0.8, 0.9, 1.15, 1.3].map((k) => ({ kind: "spread", ids, about: ids[0], k })) : []
		for (const f of flips) out.push({ changes: [f], cost: 6, why: "group" })
		for (const g of spreads) out.push({ changes: [g], cost: 4 + Math.abs(1 - g.k) * 20, why: "group" })
		for (const f of flips) for (const g of spreads) out.push({ changes: [f, g], cost: 10 + Math.abs(1 - g.k) * 20, why: "group" })
	}
	return out
}
/**
 * Where the container must be to catch the thing: its flight (the run's track up to where it first struck the container, then on as a free
 * fall) crossing the rim's height on the way down, inside the opening, with nothing of the flight or of the other moving things passing
 * through where the container would be first. -> [{changes, cost}]
 */
/** Points on a solid's outline at a pose (every 1.5 cm or so along its edges; a ball: 12 around it). */
function outlinePts(b, pose) {
	if (!b || !pose) return []
	const c = Math.cos(pose.angle ?? 0)
	const n = Math.sin(pose.angle ?? 0)
	const at = (x, y) => [pose.x + x * c - y * n, pose.y + x * n + y * c]
	if (b.kind === "ball") return Array.from({ length: 12 }, (_, k) => at(b.radius * Math.cos((k * Math.PI) / 6), b.radius * Math.sin((k * Math.PI) / 6)))
	let poly
	if (b.kind === "slab") {
		const hw = (b.width ?? 0) / 2
		const hh = (b.height ?? 0) / 2
		const hb = hw * (b.taper ?? 1)
		poly = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]]
	} else if (b.kind === "polygon" && Array.isArray(b.points)) poly = b.points.map((q) => [q.x, q.y])
	else return []
	const out = []
	for (let i = 0; i < poly.length; i++) {
		const [x0, y0] = poly[i]
		const [x1, y1] = poly[(i + 1) % poly.length]
		const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.015))
		for (let j = 0; j < k; j++) out.push(at(x0 + ((x1 - x0) * j) / k, y0 + ((y1 - y0) * j) / k))
	}
	return out
}

export { interceptCandidates as _intercept }
function interceptCandidates({ scene, sim, goal, air, yRange = 0.15 }) {
	const C = containerGeo(scene, sim, goal.container)
	if (!C || Math.abs(C.angle) > 1) return []
	let P = pathOf(sim, goal.item)
	if (P.length < 3) return []
	const moved = P.findIndex((p) => Math.hypot(p.x - P[0].x, p.y - P[0].y) > 0.005)
	if (moved < 0) return []
	const r = reachOf(sim, goal.item)
	const hit = contactsBetween(sim, goal.item, goal.container)[0]
	if (hit) {
		// the free flight beyond the first touch of the container (the run has it bouncing off it)
		const pre = P.filter((p) => p.t < hit.t - 1e-6)
		if (pre.length >= 3) {
			const a = pre.at(-3)
			const b = pre.at(-1)
			const dt = b.t - a.t || 1 / 120
			let vx = (b.x - a.x) / dt
			let vy = (b.y - a.y) / dt + (G * dt) / 2
			let { x, y, t } = b
			const ext = []
			for (let k = 0; k < 150 && y > -0.3; k++) {
				const h = 1 / 120
				x += vx * h
				vy -= G * h
				y += vy * h
				t += h
				ext.push({ t, x, y })
			}
			P = [...pre, ...ext]
		}
	}
	P = P.slice(Math.max(0, moved - 1))
	const others = (sim.doc?.solids ?? []).filter((s) => s.kind === "dynamic" && s.item !== goal.item && s.item !== goal.container)
	const frames = sim.track?.frames ?? []
	const table = Number(scene.items.find((i) => i.type === "table")?.y) || 0
	const dys = [0]
	if (air) for (let k = 1; k <= Math.round(yRange / 0.01); k++) dys.push(k * 0.01, -k * 0.01)
	const out = []
	const seen = new Set()
	for (const dy0 of dys) {
		if (dy0 < 0 && C.y0 + dy0 < table + 0.005) continue // (lowered no further than the table)
		const level = C.rim + dy0 + r
		let crossings = 0
		for (let i = 1; i < P.length && crossings < 3; i++) {
			const a = P[i - 1]
			const b = P[i]
			if (!(a.y > level && b.y <= level)) continue
			crossings++
			const xc = a.x + ((level - a.y) / (b.y - a.y)) * (b.x - a.x)
			const tc = a.t + ((level - a.y) / (b.y - a.y)) * (b.t - a.t)
			// where the container could be: the thing well inside the opening (strict), its middle over the opening (loose), or some of it over
			// the opening (it may clip the wall's top and drop in): the least move for each, tried in that order of trust
			const m = Math.min(0.012, Math.max(0, (C.inR - C.inL) / 2 - r - 0.002))
			const opts = []
			for (const [lo0, hi0, trust] of [[C.inL + r + m, C.inR - r - m, 1], [C.inL, C.inR, 1.15], [C.inL - r * 0.6, C.inR + r * 0.6, 1.3]]) {
				const lo = xc - hi0
				const hi = xc - lo0
				if (lo > hi) continue
				opts.push([Math.min(hi, Math.max(lo, 0)), trust])
			}
			if (!opts.length) opts.push([xc - C.cx, 1.2])
			for (let [dx, trust] of opts) {
				// rounded: to 5 mm, a whole centimetre when it is more than 5 cm
				const q = Math.abs(dx) > 0.05 ? 0.01 : 0.005
				dx = Math.round(dx / q) * q
				const dy = Math.round(dy0 * 200) / 200
				const key = `${dx.toFixed(3)}|${dy.toFixed(3)}`
				if (seen.has(key)) continue
				seen.add(key)
				if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue
				// the flight before it comes down must not pass through where the container would be
				const X0 = C.x0 + dx - r
				const X1 = C.x1 + dx + r
				const Y0 = C.y0 + dy - r
				const blocked = P.some((p) => p.t < tc - 0.02 && p.x > X0 && p.x < X1 && p.y > Y0 && p.y < C.rim + dy + r * 0.5)
				if (blocked) continue
				// nor the other moving things (their outlines, frame by frame) before it lands
				const bx0 = C.x0 + dx - 0.002
				const bx1 = C.x1 + dx + 0.002
				const by0 = C.y0 + dy - 0.002
				const by1 = C.rim + dy + 0.002
				let hitOther = false
				for (const s of others) {
					let last = null
					for (let fi = 0; fi < frames.length && !hitOther; fi += 2) {
						const f = frames[fi]
						if (f.t > tc) break
						const p = f.placements?.[s.id] ?? last
						if (!p) continue
						last = p
						for (const [px, py] of outlinePts(s.body, p)) if (px > bx0 && px < bx1 && py > by0 && py < by1) ((hitOther = true), 0)
					}
					if (hitOther) break
				}
				if (hitOther) continue
				out.push({ changes: [{ kind: "move", ids: [goal.container], dx: r5(dx), dy: r5(dy) }], cost: moveCost(dx, dy) * 0.4, order: moveCost(dx, dy) * 0.4 * trust, why: "intercept" }) // (moving the container under the flight is the plain fix)
			}
		}
	}
	return out
}

/** A held thing that falls short of (or past) the container: held that much further along instead, where its fall comes down inside. */
function aimCandidates({ scene, sim, goal }) {
	const C = containerGeo(scene, sim, goal.container)
	const P = pathOf(sim, goal.item)
	if (!C || P.length < 3) return []
	const r = reachOf(sim, goal.item)
	const level = C.rim + r
	const out = []
	for (let i = 1; i < P.length && out.length < 2; i++) {
		const a = P[i - 1]
		const b = P[i]
		if (!(a.y > level && b.y <= level)) continue
		const xc = a.x + ((level - a.y) / (b.y - a.y)) * (b.x - a.x)
		let dx = C.cx - xc
		if (Math.abs(dx) < 0.003) break
		const q = Math.abs(dx) > 0.05 ? 0.01 : 0.005
		dx = Math.round(dx / q) * q
		out.push({ changes: [{ kind: "move", ids: [goal.item], dx: r5(dx), dy: 0 }], cost: moveCost(dx, 0) * 0.6, why: "aim" })
		break
	}
	return out
}

/**
 * Things that move together: what the person (or the solver, to make room) moved, the things it works with follow by the same amount. For a
 * moved thing late in the chain (the box): the things before it, nearest first, in growing groups (the seesaw with its ball; and the dominoes;
 * and the ramp…); for one early in the chain: the things after it. -> [{changes, cost, why}]
 */
function followCandidates({ scene, before, order, riders, touched, inAir, origin = null }) {
	if (!before?.scene) return []
	const A = new Map(before.scene.items.map((i) => [i.id, i]))
	// (a thing the person moved in an earlier turn counts as moved from where it stood before that: "move the box 10 cm left", then "make it
	// 2 cm wider": the rest may still line up with the box)
	for (const [id, o] of origin ?? []) if (A.has(id)) A.set(id, { ...A.get(id), x: o.x, y: o.y })
	const out = []
	const isRider = (id) => [...riders.values()].some((l) => l.includes(id))
	// (how far a thing has moved since before the edit: a follower that already moved, to make room, follows only the rest of the way)
	const own = (id) => {
		const o = scene.items.find((i) => i.id === id)
		const a = A.get(id)
		return o && a ? [(Number(o.x) || 0) - (Number(a.x) || 0), (Number(o.y) || 0) - (Number(a.y) || 0)] : [0, 0]
	}
	/** The group's moves for one lead move (each the rest of the way), grouped by amount: [{kind: "move", ids, dx, dy, follows}] */
	const movesFor = (group, dx, dy, f, lead) => {
		const air = group.every((g) => inAir.has(g) && !lockOf(touched, g).y)
		const by = new Map()
		for (const g of group) {
			const [ox, oy] = own(g)
			const ddx = r5(Math.round((dx - ox) * f * 200) / 200)
			// (things standing on something follow along the table; up and down only when all of them are in the air)
			const ddy = air && Math.abs(dy) >= 0.01 ? r5(Math.round((dy - oy) * f * 200) / 200) : 0
			if (Math.abs(ddx) < 0.004 && Math.abs(ddy) < 0.004) continue
			const k = `${ddx}|${ddy}`
			if (!by.has(k)) by.set(k, { kind: "move", ids: [], dx: ddx, dy: ddy, follows: lead })
			by.get(k).ids.push(g)
		}
		return [...by.values()].map((c) => ({ ...c, ids: c.ids.sort((p, q) => order.indexOf(p) - order.indexOf(q)) }))
	}
	const costOf = (moves) => moves.reduce((t, c) => t + moveCost(c.dx, c.dy) * (0.6 + 0.4 * c.ids.length), 0)
	for (const it of scene.items) {
		if (it.type === "table" || it.type === "wall") continue
		const a = A.get(it.id)
		// (a swapped thing re-seated a little higher or lower is not a move; a thing riding on another moved with it)
		if (!a || a.type !== it.type || isRider(it.id)) continue
		const dx = (Number(it.x) || 0) - (Number(a.x) || 0)
		const dy = (Number(it.y) || 0) - (Number(a.y) || 0)
		if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.01) continue
		const k = order.indexOf(it.id)
		if (k < 0) continue
		const free = (id) => !(lockOf(touched, id).x || isRider(id) || (riders.get(it.id) ?? []).includes(id) || ["table", "wall"].includes(scene.items.find((i) => i.id === id)?.type ?? "table"))
		const up = order.slice(0, k).reverse().filter(free)
		const down = order.slice(k + 1).filter(free)
		for (const side of [up, down]) {
			const group = []
			for (const id of side) {
				group.push(id)
				for (const f of [1, 0.8, 1.2]) {
					const moves = movesFor(group, dx, dy, f, it.id)
					if (moves.length) out.push({ changes: moves, cost: costOf(moves) * (f === 1 ? 1 : 1.1), why: "follow" })
				}
				if (group.length >= 5) break
			}
		}
		// and the whole rest of the chain, both sides at once: everything lined up with it again, as it was (when one side alone isn't enough)
		if (up.length && down.length) {
			const moves = movesFor([...up.slice(0, 5), ...down.slice(0, 5)], dx, dy, 1, it.id)
			if (moves.length) out.push({ changes: moves, cost: costOf(moves) * 1.3, why: "follow-all" })
		}
	}
	return out
}

// ================================================================ the search
/** The two copies of a candidate a little either side of its value, half its smallest step: ±2.5 mm for a move or a slide, ±0.25° for a
 *  turn or a tilt, ±2.5% of a setting. -> [changes, changes] (empty when there is nothing to nudge) */
function nudged(changes) {
	const c = changes[0]
	if (!c) return []
	const at = (d) => [{ ...c, ...d }, ...changes.slice(1)]
	if (c.kind === "move") return Math.abs(c.dx) >= 1e-9 || !(Math.abs(c.dy) >= 1e-9) ? [at({ dx: r5(c.dx + 0.0025) }), at({ dx: r5(c.dx - 0.0025) })] : [at({ dy: r5(c.dy + 0.0025) }), at({ dy: r5(c.dy - 0.0025) })]
	if (c.kind === "slide") return [at({ dx: r5(c.dx + 0.0025) }), at({ dx: r5(c.dx - 0.0025) })]
	if (c.kind === "turn") return [at({ d: r5(c.d + 0.25) }), at({ d: r5(c.d - 0.25) })]
	if (c.kind === "spread") return [at({ k: r5(c.k + 0.03) }), at({ k: r5(c.k - 0.03) })]
	if (c.kind === "scale") return [at({ k: r5(c.k * 1.025) }), at({ k: r5(c.k * 0.975) })]
	if (c.kind === "add") return [at({ item: { ...c.item, x: r5(c.item.x + 0.0025) } }), at({ item: { ...c.item, x: r5(c.item.x - 0.0025) } })]
	if (c.kind === "prop" && typeof c.to === "number" && c.key === "growth") return [at({ to: r5(c.to + 0.005) }), at({ to: r5(c.to - 0.005) })]
	if (c.kind === "prop" && typeof c.to === "number") {
		const deg = ["tilt", "pull_back", "start_angle", "angle"].includes(c.key)
		return deg ? [at({ to: r5(c.to + 0.25) }), at({ to: r5(c.to - 0.25) })] : [at({ to: r5(c.to * 1.025) }), at({ to: r5(c.to * 0.975) })]
	}
	return []
}
/** A run judged for the search: the targets' results, how far it is from them (farness), and its start-up warnings. (A fix worker sends this
 *  back instead of the whole run: ./fix-worker.js.) targets: [{goal, label, implicit}] */
export function judgeRun(targets, sim, scene) {
	const results = judge(targets, sim)
	const warn = sim?.warnings?.length ?? 0
	return { results, ok: results.every((r) => r.ok === true), f: farness(targets, results, sim, scene), warn }
}
/**
 * ctx: {scene (after the edit, as it is on the table), sim (its run, as the app ran it), goals (the plan's goals as solved, or null: the
 *       scene's), before: {scene, sim} (the scene and run before the edit, or null), touched: Map id -> Set|"all" (what the edit set; never
 *       undone), swapped: Set of ids, targets? (precomputed fixTargets)}
 * opts: {evaluate(scene, targets, signal) -> judgeRun's answer (a pool of fix workers), or simulate(scene, signal) -> a run (judged here);
 *        verify(scene, signal) -> a run of the found fix on the app's own engine (default: simulate), signal, budgetMs, maxRuns, parallel,
 *        extraMs, onProgress({runs, found, ms})}
 * -> {status, targets, results (in the edited run), fix?: {scene, sim, changes, cost, results, words}, near?: {scene, changes, words, happened},
 *     runs, tried, candidates, ms}
 */
export async function findFix(ctx, opts = {}) {
	const t0 = now()
	const { signal } = opts
	const budgetMs = (num(opts.budgetMs) ?? FIX_MS) * TIME_SCALE
	const maxRuns = num(opts.maxRuns) ?? FIX_RUNS
	const extraMs = (num(opts.extraMs) ?? FIX_EXTRA_MS) * TIME_SCALE
	// (a heavy scene runs few candidates in its time: up to hardMs it goes on until it has run minRuns, V8817 c02: 117–128 runs in 35 s on the
	// 24-domino scene, while a light one runs 30 a second)
	const minRuns = num(opts.minRuns) ?? 0
	const hardMs = Math.max(budgetMs, num(opts.hardMs) != null ? num(opts.hardMs) * TIME_SCALE : budgetMs)
	const P = Math.max(1, Math.min(8, Math.round(num(opts.parallel) ?? 2)))
	const { scene, sim } = ctx
	const targets = ctx.targets ?? fixTargets({ goals: ctx.goals, scene, before: ctx.before, sim })
	const results = judge(targets, sim)
	// (a goal the run can't tell about is no target)
	const live = targets.filter((_, i) => results[i].ok !== null)
	const liveRes = results.filter((r) => r.ok !== null)
	const out = { status: "ok", targets: live, results: liveRes, runs: 0, tried: 0, candidates: 0, ms: 0 }
	if (!live.length || liveRes.every((r) => r.ok === true)) return out
	out.status = "none"
	const aborted = () => Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const evaluate = opts.evaluate ?? (async (sc, tg, sig) => judgeRun(tg, await opts.simulate(sc, sig), sc))
	const verify = opts.verify ?? opts.simulate ?? null
	const baseOver = overlapsOf(scene)
	const riders = riderMap(scene)
	const inAir = new Set()
	const restsOn = new Map() // id -> what it rests on (the highest thing within a few mm under it), or nothing
	try {
		const ins = inspect(scene)
		const table = scene.items.find((i) => i.type === "table")
		const tableTop = table ? ins.box(table.id)?.y1 ?? 0 : 0
		for (const it of scene.items) {
			if (it.type === "table" || it.type === "wall") continue
			let on = null
			let top = -Infinity
			// (standing on the table: its bottom at the table's top, give or take a few millimetres)
			const y0 = ins.box(it.id)?.y0
			if (table && Number.isFinite(y0) && Math.abs(y0 - tableTop) < 0.015) ((on = table.id), (top = tableTop))
			for (const o of scene.items) {
				if (o === it || o.type === "wall") continue
				const g = ins.gap(it.id, o.id)
				const t = ins.box(o.id)?.y1 ?? -Infinity
				if (g !== null && g > -0.003 && g < 0.004 && t > top + 1e-9) ((top = t), (on = o.id))
			}
			if (on) restsOn.set(it.id, on)
			if ((it.type === "box" && propValue(it, "hung") === true) || it.held) {
				inAir.add(it.id)
				continue
			}
			if (!on && isStaticItem(it.type, it.fixed === true) && it.type !== "plank") inAir.add(it.id)
		}
	} catch {}
	// the chain: who takes part, in order (the run before the edit says how the machine is meant to go; the edited run adds what it does now)
	const inv = involvement(ctx.before?.sim ?? sim, ctx.before?.scene ?? scene)
	for (const [id, t] of involvement(sim, scene)) if (!inv.has(id)) inv.set(id, t + 1e-3)
	const has = new Set(scene.items.map((i) => i.id))
	const containers = new Set()
	const goalIds = new Set()
	// (the chain is read back from the goals that fail: their things and containers, "nearest the goal" is nearest those; a scene with six goals
	// and one failing, c01's ping-pong ball, is searched round that one)
	const failingT = live.filter((_, i) => liveRes[i]?.ok === false)
	for (const t of failingT.length ? failingT : live) {
		for (const id of goalItems(t.goal)) goalIds.add(id)
		if (t.goal.container) containers.add(t.goal.container)
		if (t.goal.target) containers.add(t.goal.target)
	}
	for (const id of [...goalIds, ...containers]) if (!inv.has(id)) inv.set(id, Infinity)
	// (what acts on the goal's thing without touching it, a fan's air, a switch on a timer: part of the chain just before that thing, so its place
	// and settings are knobs too: c01, the fan's jet passing over the ping-pong ball)
	for (const it of scene.items) {
		if (inv.has(it.id) || !(/^(fan|blower|magnet)/.test(it.type) || propSpec(it.type, "on_at"))) continue
		const tg = Math.min(...[...goalIds].map((id) => inv.get(id) ?? Infinity))
		inv.set(it.id, Number.isFinite(tg) ? tg - 1e-3 : 1e6)
	}
	// (what carries a thing in the chain is part of it, a moment before: the conveyor belt the golf balls ride on, the plank under a launcher.
	// A fixed support takes part without ever moving or being struck, so the run alone never names it)
	const tableId = scene.items.find((i) => i.type === "table")?.id
	for (const [id, t] of [...inv]) {
		const s = restsOn.get(id)
		if (s && s !== tableId && has.has(s) && !inv.has(s)) inv.set(s, t - 1e-3)
	}
	const order = [...inv].filter(([id]) => has.has(id)).sort((a, b) => a[1] - b[1]).map(([id]) => id)
	// nearest the goal first: the containers and the goal's things, then back along the chain
	const lastGoal = Math.max(...order.map((id, i) => (goalIds.has(id) || containers.has(id) ? i : -1)))
	const near = [...order.slice(0, lastGoal + 1).reverse(), ...order.slice(lastGoal + 1)]
	// what the search must leave as the person set it: their own choices when those are known apart from all the edit set (the search after a
	// plain edit: ctx.hard, §16), else all the edit set (ctx.touched); ctx.forward: what they asked for without an amount, which may go further
	const relaxed = ctx.relaxed === true && ctx.hard instanceof Map
	const locks = relaxed ? ctx.hard : ctx.touched
	const soft = relaxed && ctx.forward instanceof Map ? ctx.forward : null
	// ---- the candidates, each with its cost; the targeted ones (intercept, follow) first
	const firstCands = []
	for (const t of live) {
		const g = t.goal
		if (goalKind(g) !== "in" || !g.container || !has.has(g.container)) continue
		const c = scene.items.find((i) => i.id === g.container)
		const lk = lockOf(locks, g.container)
		if ((lk.x && lk.y) || !CONTAINERS.includes(c?.type)) continue
		// (a container whose height the person set may still slide along the table; one they moved along, still be raised or lowered)
		firstCands.push(...interceptCandidates({ scene, sim, goal: g, air: inAir.has(g.container) && !lk.y }).filter((c) => !lk.x || Math.abs(c.changes[0].dx) < 1e-9))
	}
	// and the other way round: a thing dropped from where it is held is held over the container instead (its fall moves with it)
	for (const t of live) {
		const g = t.goal
		if (goalKind(g) !== "in" || !g.container || !g.item || !inAir.has(g.item)) continue
		if (!ctx.flex && lockOf(locks, g.item).x) continue
		firstCands.push(...aimCandidates({ scene, sim, goal: g }))
	}
	firstCands.push(...followCandidates({ scene, before: ctx.before, order, riders, touched: locks, inAir, origin: ctx.origin }))
	// a thing that must end off the table and is stopped by the invisible wall at the table's end: that wall taken away (c01, 16 Oct: "the
	// safety wall stops it")
	// (a fan blowing the wrong way or past the thing it is for: put on the other side of it, turned round to face it: c01, a fan at the left end
	// blowing the ping-pong ball along the table instead of off it)
	for (const [i, t] of live.entries()) {
		if (!["off", "moves"].includes(goalKind(t.goal)) || liveRes[i]?.ok !== false) continue
		const X = scene.items.find((it) => it.id === goalItems(t.goal)[0])
		if (!X) continue
		for (const F of scene.items.filter((it) => /^(fan|blower)/.test(it.type))) {
			const dx = r5(2 * ((Number(X.x) || 0) - (Number(F.x) || 0)))
			if (Math.abs(dx) < 0.02 || Math.abs(dx) > 1.5) continue
			firstCands.push({ changes: [{ kind: "move", ids: [F.id], dx, dy: 0 }, { kind: "turn", id: F.id, d: 180 }], cost: 12, why: "fan" })
			// (off the table: and the invisible wall at the end it now blows toward taken away)
			if (goalKind(t.goal) === "off") {
				const blowsLeft = dx < 0 // (put on the thing's right, turned round: it blows left)
				const wall = scene.items.filter((w) => w.type === "wall" && w.props?.invisible_in_3d === true).sort((p, q) => (blowsLeft ? (Number(p.x) || 0) - (Number(q.x) || 0) : (Number(q.x) || 0) - (Number(p.x) || 0)))[0]
				if (wall) firstCands.push({ changes: [{ kind: "remove", ids: [wall.id] }, { kind: "move", ids: [F.id], dx, dy: 0 }, { kind: "turn", id: F.id, d: 180 }], cost: 16, why: "fan" })
			}
		}
	}
	for (const [i, t] of live.entries()) {
		if (goalKind(t.goal) !== "off" || liveRes[i]?.ok !== false) continue
		const P = pathOf(sim, goalItems(t.goal)[0])
		if (!P.length) continue
		const end = P.at(-1)
		const walls = scene.items.filter((w) => w.type === "wall" && w.props?.invisible_in_3d === true)
		const near = walls.map((w) => ({ w, d: Math.abs((Number(w.x) || 0) - end.x) })).sort((p, q) => p.d - q.d)[0]
		if (near && near.d < 0.6) firstCands.push({ changes: [{ kind: "remove", ids: [near.w.id] }], cost: 5, why: "wall" })
	}
	// a thing hung from a pivot made shorter or longer (a pendulum's string): hung that much lower or higher, so it swings as low as before
	for (const [id, keys] of ctx.touched ?? []) {
		if (keys === "all" || !keys?.has?.("length") || lockOf(ctx.touched, id).y) continue
		const it = scene.items.find((i) => i.id === id)
		const b = ctx.before?.scene?.items?.find((i) => i.id === id)
		if (!it || !b || it.type !== b.type || !/pivot/i.test(propSpec(it.type, "length")?.help ?? "")) continue
		const d = (num(propValue(it, "length")) ?? 0) - (num(propValue(b, "length")) ?? 0)
		if (Math.abs(d) < 0.005) continue
		firstCands.push({ changes: [{ kind: "move", ids: [id], dx: 0, dy: r5(d), reason: `so it swings as low as before` }], cost: moveCost(0, d) * 0.5, why: "rehang" })
	}
	// (the nine things nearest the goal that a knob may change: a row of things the person placed, each locked where it is, counts as one, so a
	// row of 7 new soda cans no longer fills the window and leaves the ramps and the launcher untried)
	const window = []
	const counted = new Set()
	for (const id of near) {
		const it = scene.items.find((i) => i.id === id)
		if (!it) continue
		const lk = lockOf(ctx.touched, id)
		const placed = lk.x && lk.y
		const key = placed ? `type:${it.type}` : `id:${id}`
		if (placed && counted.has(key)) {
			window.push(id)
			continue
		}
		if (counted.size >= 9) continue
		counted.add(key)
		window.push(id)
	}
	const blind = [
		...knobCandidates({ scene, order: window, containers, touched: ctx.touched, swapped: ctx.swapped, inAir, riders, restsOn, resolved: sim?.resolved, flex: !!ctx.flex, before: ctx.before?.scene, locks: relaxed ? ctx.hard : null, soft }),
		...groupCandidates({ scene, before: ctx.before?.scene, locks: relaxed ? ctx.hard : null }),
		// (sizes of the person's new things, a row grown with what follows it carried along: only after a plain edit, where what is theirs is known)
		...(relaxed ? sizeCandidates({ scene, before: ctx.before?.scene, order, locks, targets: live }) : [])
	]
	// (a change near the goal is the plain one, and the sturdy one: a nudge at the start of a long chain works by luck as much as by design)
	for (const c of blind) {
		const ids = c.changes.flatMap((x) => (Array.isArray(x.ids) ? x.ids : [x.id]))
		const rank = Math.max(0, ...ids.map((id) => near.indexOf(id)))
		c.cost *= 1 + 0.75 * rank
	}
	// (a knob on something that comes before everything the person changed is tried last, and only while nothing else has worked: "move the
	// first ball 1 cm" to win back a box moved at the far end reads as arbitrary, and it is luck more often than not)
	const firstTouched = Math.min(...[...(ctx.touched?.keys?.() ?? [])].map((id) => order.indexOf(id)).filter((i) => i >= 0))
	const early = (c) => Number.isFinite(firstTouched) && c.changes.every((x) => (Array.isArray(x.ids) ? x.ids : [x.id]).every((id) => order.indexOf(id) >= 0 && order.indexOf(id) < firstTouched))
	const keyOf = (c) => JSON.stringify(c.changes.map((x) => ({ ...x, follows: undefined, from: undefined })))
	const queue = []
	const seenK = new Set()
	const byCost = (a, b) => a.cost - b.cost
	// (the targeted ones, at most 16, cheapest first; the whole chain lined up again always gets its turn, after them)
	const first = firstCands.filter((c) => c.why !== "follow-all").sort((a, b) => (a.order ?? a.cost) - (b.order ?? b.cost)).slice(0, 16)
	// (a stand-in for a lost hit, when the change took away what drove the thing that throws the goal's thing: after the targeted ones)
	let standIns = []
	try {
		standIns = standInCandidates({ scene, sim, before: ctx.before, targets: live, locks: relaxed ? ctx.hard : null, soft })
	} catch {}
	for (const [list, phase] of [[[...first, ...firstCands.filter((c) => c.why === "follow-all").sort(byCost)], 0], [standIns.sort(byCost), 0], [blind.filter((c) => !early(c)).sort(byCost), 1], [blind.filter(early).sort(byCost), 2]])
		for (const c of list) {
			const k = keyOf(c)
			if (seenK.has(k)) continue
			seenK.add(k)
			queue.push({ ...c, phase, key: k })
		}
	// (an "off" goal stopped by the invisible wall at that end: the wall taken away goes with every one of the cheapest changes too, since nothing
	// leaves the table past it)
	const wallOff = firstCands.find((c) => c.why === "wall")
	if (wallOff) {
		const extra = queue.filter((c) => c.why !== "wall").slice(0, 120).map((c) => ({ ...c, changes: [...wallOff.changes, ...c.changes], cost: c.cost + 5, key: `wall+${c.key}` }))
		queue.splice(1, 0, ...extra)
	}
	// (only these things may change, when the caller says so: a change that states its own outcome tunes what that outcome is about and what
	// the change put in, never the rest of the machine: V8817 c01)
	if (ctx.only instanceof Set) {
		const idsOf = (x) => (x.kind === "add" ? null : [...(Array.isArray(x.ids) ? x.ids : x.id !== undefined ? [x.id] : []), ...(Array.isArray(x.follow) ? x.follow : [])])
		for (let i = queue.length - 1; i >= 0; i--)
			if (
				!queue[i].changes.every((x) => {
					const ids = idsOf(x)
					return ids !== null && ids.every((id) => ctx.only.has(id))
				})
			)
				queue.splice(i, 1)
	}
	// (what the person chose stays what they chose: a size or a weight of theirs never made absurd, nothing the other way from a word they gave
	// it, "heavy", "big": V8820 x5 / c01 / n6, VERIFY plainswap2)
	{
		const typeOf = new Map(scene.items.map((i) => [i.id, i.type]))
		const sizes = (x) => x.kind === "scale" || x.kind === "props" || (x.kind === "prop" && (x.key === "mass" || sizeKeys(typeOf.get(x.id)).all.includes(x.key) || dimKeys(typeOf.get(x.id)).len.includes(x.key) || dimKeys(typeOf.get(x.id)).kg.includes(x.key)))
		const memo = new Map()
		const breaks = (c) => {
			const k = JSON.stringify(c.changes.filter(sizes))
			if (!memo.has(k))
				try {
					memo.set(k, characterBreak(scene, applyChanges(scene, c.changes.filter(sizes), riders), ctx.before?.scene ?? null, ctx.hard ?? null))
				} catch {
					memo.set(k, null)
				}
			return memo.get(k)
		}
		for (let i = queue.length - 1; i >= 0; i--) if (queue[i].changes.some(sizes) && breaks(queue[i])) queue.splice(i, 1)
	}
	// (few candidates: two of the cheapest together, each on its own things, so a search is never done after a dozen runs when a pair would do:
	// V8820 c08, 16 runs and nothing, where the AI's rework found two changes that work)
	if (queue.length < 80) {
		const idsOf = (c) => c.changes.flatMap((x) => (Array.isArray(x.ids) ? x.ids : x.id !== undefined ? [x.id] : []))
		const singles = queue.filter((c) => c.phase <= 1 && c.why !== "wall" && !String(c.why).startsWith("follow") && c.changes.length === 1).slice(0, 12)
		const pairs = []
		for (let i = 0; i < singles.length; i++)
			for (let j = i + 1; j < singles.length; j++) {
				const a = singles[i]
				const b = singles[j]
				if (idsOf(a).some((id) => idsOf(b).includes(id))) continue
				const k = `${a.key}+${b.key}`
				if (seenK.has(k)) continue
				seenK.add(k)
				pairs.push({ changes: [...a.changes, ...b.changes], cost: a.cost + b.cost + 4, why: "pair", phase: 1, key: k })
			}
		queue.push(...pairs.sort(byCost).slice(0, 60))
	}
	out.candidates = queue.length
	// ---- the edited scene once on the search's own engine: what a candidate is compared with (its warnings, how far it is from the goals)
	let base
	try {
		out.runs++
		base = await evaluate(scene, live, signal)
	} catch (e) {
		if (e?.name === "AbortError" || signal?.aborted) throw aborted()
		base = { f: farness(live, liveRes, sim, scene), warn: sim?.warnings?.length ?? 0 }
	}
	const baseWarn = Math.max(base?.warn ?? 0, 0)
	const f0 = base?.f ?? farness(live, liveRes, sim, scene)
	// ---- run them: P at a time, the cheapest first; after a fix is found, only cheaper ones, for a little longer
	let best = null
	let fallback = null // (the cheapest fix that works only at its exact value: offered only when no sturdy one is found)
	let nearest = null
	let deadline = t0 + budgetMs
	let hard = t0 + hardMs
	let next = 0
	const done = () => signal?.aborted || out.runs >= maxRuns || now() > hard || (now() > deadline && (out.runs >= minRuns || best))
	const take = () => {
		while (next < queue.length) {
			const c = queue[next++]
			if (best && (c.cost >= best.cost || c.phase === 2)) continue
			return c
		}
		return null
	}
	/** Does a passing candidate still pass a little either side of its value (half its smallest step: ±2.5 mm, ±0.25°, ±2.5%)? A fix that
	 *  works only at one exact value is luck: a person copying it, or the next run, would miss. (A nudge that doesn't fit says nothing.) */
	const sturdy = async (c) => {
		const vs = nudged(c.changes)
		const rs = await Promise.all(
			vs.map(async (ch) => {
				let cand
				try {
					cand = applyChanges(scene, ch, riders)
				} catch {
					return true
				}
				if (!fits(cand, scene, baseOver)) return true
				out.runs++
				try {
					const e = await evaluate(cand, live, signal)
					return !!e?.ok && (e.warn ?? 0) <= baseWarn
				} catch (err) {
					if (err?.name === "AbortError" || signal?.aborted) throw aborted()
					return false
				}
			})
		)
		return rs.every(Boolean)
	}
	const tryOne = async (c) => {
		let cand
		try {
			cand = applyChanges(scene, c.changes, riders)
		} catch {
			return
		}
		if (!fits(cand, scene, baseOver)) return opts.debug?.(c, "unfit")
		out.tried++
		let e
		try {
			out.runs++
			e = await evaluate(cand, live, signal)
		} catch (err) {
			if (err?.name === "AbortError" || signal?.aborted) throw aborted()
			return
		}
		const ok = !!e?.ok && (e.warn ?? 0) <= baseWarn
		opts.debug?.(c, ok ? "PASS" : `fail ${(e?.results ?? []).map((x) => x.ok).join("/")} w${e?.warn}`)
		// (a follow puts things back in line as they were, so it is as sturdy as the machine was: only the other kinds are nudged)
		if (ok && (!best || c.cost < best.cost) && !String(c.why).startsWith("follow") && !(await sturdy(c))) {
			// (it works only at that exact value: kept as a fallback, at four times its cost)
			opts.debug?.(c, "fragile")
			const fc = { ...c, cost: c.cost * 4, fragile: true, cand }
			if (!fallback || fc.cost < fallback.cost) fallback = fc
		} else if (ok && (!best || c.cost < best.cost)) {
			// (checked once more on the app's own engine, which gives the whole run: what is offered is what will happen)
			let vs = null
			if (verify) {
				try {
					out.runs++
					vs = await verify(cand, signal)
				} catch (err) {
					if (err?.name === "AbortError" || signal?.aborted) throw aborted()
				}
				const vr = vs ? judge(live, vs) : null
				if (!vr || !vr.every((r) => r.ok === true) || (vs.warnings?.length ?? 0) > (sim?.warnings?.length ?? 0)) return opts.debug?.(c, "verify failed")
				// (and it works through the machine: V8817, a bucket moved behind the catapult, a ball dropped in before the chain reached it)
				const br = chainBreak(ctx, cand, vs, live)
				if (br) {
					out.skipped = (out.skipped ?? 0) + 1
					return opts.debug?.(c, `chain: ${br}`)
				}
				if (!best || c.cost < best.cost) best = { ...c, scene: cand, sim: vs, results: vr }
			} else best = { ...c, scene: cand, sim: null, results: e.results }
			deadline = Math.min(deadline, now() + extraMs)
			hard = Math.min(hard, now() + extraMs)
		} else if (!ok && e) {
			const f = (e.f ?? Infinity) + ((e.warn ?? 0) > baseWarn ? 0.5 : 0)
			if (f < f0 - 0.15 && (!nearest || f < nearest.f - 1e-9 || (Math.abs(f - nearest.f) < 1e-9 && c.cost < nearest.cost))) nearest = { ...c, scene: cand, results: e.results, f }
		}
		opts.onProgress?.({ runs: out.runs, found: !!best, ms: Math.round(now() - t0) })
	}
	const worker = async () => {
		while (!done()) {
			const c = take()
			if (!c) return
			await tryOne(c)
		}
	}
	await Promise.all(Array.from({ length: P }, worker))
	if (signal?.aborted) throw aborted()
	// nothing sturdy: the fragile one, checked on the app's own engine like any other
	if (!best && fallback) {
		let vs = null
		if (verify)
			try {
				out.runs++
				vs = await verify(fallback.cand, signal)
			} catch (err) {
				if (err?.name === "AbortError" || signal?.aborted) throw aborted()
			}
		const vr = vs ? judge(live, vs) : null
		if (!verify || (vr && vr.every((r) => r.ok === true) && (vs.warnings?.length ?? 0) <= (sim?.warnings?.length ?? 0) && !chainBreak(ctx, fallback.cand, vs, live))) best = { ...fallback, scene: fallback.cand, sim: vs, results: vr ?? live.map((t) => ({ label: t.label, ok: true })) }
	}
	if (best) {
		out.status = "found"
		out.fix = { scene: best.scene, sim: best.sim, changes: best.changes, cost: best.cost, why: best.why, results: best.results, words: withTable(fixWords(best.changes, scene, ctx.before?.scene), scene, best.scene), ...(best.fragile ? { fragile: true } : {}) }
	} else if (nearest) {
		out.near = { scene: nearest.scene, changes: nearest.changes, cost: nearest.cost, results: nearest.results, words: withTable(fixWords(nearest.changes, scene, ctx.before?.scene), scene, nearest.scene), happened: null }
		// (what it does instead, from a whole run of it)
		if (verify)
			try {
				out.runs++
				const vs = await verify(nearest.scene, signal)
				out.near.sim = vs
				out.near.results = judge(live, vs)
				out.near.happened = firstMiss(live, out.near.results, vs, nearest.scene, ctx.before)
				// (a closest miss that skips the machine is no idea to try either)
				if (chainBreak(ctx, nearest.scene, vs, live)) delete out.near
			} catch (err) {
				if (err?.name === "AbortError" || signal?.aborted) throw aborted()
			}
	}
	out.ms = Math.round(now() - t0)
	return out
}
// ================================================================ stage by stage: the chain's receivers set up again for what reaches them now
/**
 * A run probed for the stage-by-stage search: the targets' judgement (judgeRun's) and the moving thing's path and hits, small enough for a
 * fix worker to send back: {results, ok, f, warn, path: [[t, x, y]] (every second frame), hits: [{t, other, speed}]}.
 */
export function probeRun(targets, sim, scene, item) {
	const j = judgeRun(targets, sim, scene)
	const P = pathOf(sim, item)
	const path = []
	for (let i = 0; i < P.length; i += 2) path.push([r5(P[i].t), r5(P[i].x), r5(P[i].y)])
	if (P.length && (P.length - 1) % 2) path.push([r5(P.at(-1).t), r5(P.at(-1).x), r5(P.at(-1).y)])
	const hits = impactsOf(sim, item).map((h) => ({ t: r5(h.t), other: h.other, speed: r5(h.speed ?? 0) }))
	return { ...j, path, hits }
}
/**
 * Stage by stage (ai/DESIGN.md §16; the user's follow-up, 16 Oct: "run the stage tuner on the edited scene stage by stage"): the things the
 * goal's moving thing must reach in turn (the targets of its "hits" goals in the order it reached them before the change, then the container of
 * its "in" goal: the three bounce pads, then the basket) are set up again one after the other, as a person would after swapping in a ball that
 * bounces lower and shorter: each moved along the table to where the thing now comes to it and carries on best (as high and as far along as it
 * can go after it), the container last, to where the thing now lands in it (the smallest move that makes every goal happen). Nothing the person
 * placed with an amount moves; a receiver never stands inside or over a neighbour. Every stage's candidates run at once (opts.parallel).
 * opts: {probe(scene, targets, item, signal) -> probeRun's answer, verify(scene, signal) -> a whole run on the app's own engine, signal,
 * budgetMs, maxRuns, parallel, onProgress({runs, stage})} -> {status: "ok" | "found" | "none", fix?, runs, ms}
 */
export async function restageFix(ctx, opts = {}) {
	const t0 = now()
	const { signal } = opts
	const budgetMs = (num(opts.budgetMs) ?? 30000) * TIME_SCALE
	const maxRuns = num(opts.maxRuns) ?? 600
	const P = Math.max(1, Math.min(8, Math.round(num(opts.parallel) ?? 2)))
	const out = { status: "none", runs: 0, ms: 0 }
	const { scene, sim, before } = ctx
	const aborted = () => Object.assign(new Error("Cancelled"), { name: "AbortError" })
	if (!before?.sim?.track || !opts.probe) return out
	const targets = ctx.targets ?? fixTargets({ goals: ctx.goals, scene, before, sim })
	const res0 = judge(targets, sim)
	const live = targets.filter((_, i) => res0[i].ok !== null)
	if (!live.length || judge(live, sim).every((r) => r.ok === true)) return { ...out, status: "ok" }
	// the moving thing and its receivers, in the order it reached them before the change
	const failing = live.filter((t) => judge([t], sim)[0].ok === false)
	const mover = goalItems((failing.find((t) => !t.implicit) ?? failing[0]).goal)[0]
	if (!mover) return out
	const mine = live.filter((t) => goalItems(t.goal)[0] === mover && ["hits", "in"].includes(goalKind(t.goal)))
	const reachT = (id) => {
		const h = impactsOf(before.sim, mover).find((x) => x.other === id)
		return h ? h.t : Infinity
	}
	const hitsR = mine.filter((t) => goalKind(t.goal) === "hits" && t.goal.target).map((t) => t.goal.target)
	const inR = mine.filter((t) => goalKind(t.goal) === "in" && t.goal.container).map((t) => t.goal.container)
	const receivers = [...new Set([...hitsR.sort((a, b) => reachT(a) - reachT(b)), ...inR])].filter((id) => scene.items.some((i) => i.id === id))
	if (!receivers.length) return out
	const locks = ctx.relaxed === true && ctx.hard instanceof Map ? ctx.hard : ctx.touched
	const riders = riderMap(scene)
	const baseOver = overlapsOf(scene)
	let ins0 = null
	try {
		ins0 = inspect(scene)
	} catch {
		return out
	}
	const tableTop = (() => {
		const t = scene.items.find((i) => i.type === "table")
		return t ? ins0.box(t.id)?.y1 ?? 0 : 0
	})()
	// (two things standing on the table whose outlines overlap along it, that did not before: one stood in or over the other (a trampoline's
	// frame round a basket), never a setup a person would make)
	const standing = (ins, id) => {
		const b = ins.box(id)
		return !!b && Math.abs(b.y0 - tableTop) < 0.02
	}
	const nested = (cand, id) => {
		let ins
		try {
			ins = inspect(cand)
		} catch {
			return true
		}
		if (!standing(ins, id)) return false
		const b = ins.box(id)
		for (const o of cand.items) {
			if (o.id === id || ["table", "wall"].includes(o.type) || (riders.get(id) ?? []).includes(o.id) || (riders.get(o.id) ?? []).includes(id)) continue
			if (!standing(ins, o.id)) continue
			const ob = ins.box(o.id)
			const ov = Math.min(b.x1, ob.x1) - Math.max(b.x0, ob.x0)
			const was0 = ins0.box(o.id) && ins0.box(id) ? Math.min(ins0.box(id).x1, ins0.box(o.id).x1) - Math.max(ins0.box(id).x0, ins0.box(o.id).x0) : -1
			if (ov > 0.005 && ov > was0 + 0.002) return true
		}
		return false
	}
	const evalAll = async (cands) => {
		const outs = new Array(cands.length).fill(null)
		let k = 0
		const work = async () => {
			while (k < cands.length) {
				const i = k++
				if (signal?.aborted) throw aborted()
				if (out.runs >= maxRuns || now() - t0 > budgetMs) return
				out.runs++
				try {
					outs[i] = await opts.probe(cands[i].scene, live, mover, signal)
				} catch (e) {
					if (e?.name === "AbortError" || signal?.aborted) throw aborted()
				}
				opts.onProgress?.({ runs: out.runs, stage: cands[i].stage })
			}
		}
		await Promise.all(Array.from({ length: P }, work))
		return outs
	}
	const dirOf = (from, to) => Math.sign((Number(to?.x) || 0) - (Number(from?.x) || 0)) || 1
	const wallIds = new Set(scene.items.filter(invisibleWall).map((i) => i.id))
	const walls0 = new Set(impactsOf(before.sim, mover).map((h) => h.other).filter((id) => wallIds.has(id)))
	let cur = scene
	const moves = []
	for (const [k, id] of receivers.entries()) {
		if (signal?.aborted) throw aborted()
		if (now() - t0 > budgetMs || out.runs >= maxRuns) break
		const lk = lockOf(locks, id)
		const it = cur.items.find((i) => i.id === id)
		if (!it || lk.x || it.held) continue
		const last = k === receivers.length - 1
		const next = last ? null : cur.items.find((i) => i.id === receivers[k + 1])
		const dir = dirOf(it, next ?? it)
		// a coarse pass (6 cm steps over ±72 cm), then 2 cm steps round the best three
		const make = (dx) => {
			let cand
			try {
				cand = applyChanges(cur, [{ kind: "move", ids: [id], dx: r5(dx), dy: 0 }], riders)
			} catch {
				return null
			}
			if (Math.abs(dx) > 1e-9 && (!fits(cand, cur, baseOver) || nested(cand, id))) return null
			return { dx, scene: cand, stage: k + 1 }
		}
		const prevOk = (pr) => {
			// (every receiver before this one is still reached, in order)
			let tPrev = -Infinity
			for (const rid of receivers.slice(0, k)) {
				const h = pr.hits.find((x) => x.other === rid && x.t > tPrev - 1e-6)
				if (!h) return false
				tPrev = h.t
			}
			return true
		}
		const score = (pr, c) => {
			if (!pr || (pr.warn ?? 0) > (sim?.warnings?.length ?? 0) || !prevOk(pr)) return -Infinity
			// (never by way of an invisible end wall it didn't touch before: c09, a tennis ball off the right wall into the basket)
			if (pr.hits.some((h) => wallIds.has(h.other) && !walls0.has(h.other))) return -Infinity
			if (last) return pr.ok ? 1000 - Math.abs(c.dx) * 10 : -(pr.f ?? 9)
			const tPrev = receivers.slice(0, k).reduce((t, rid) => pr.hits.find((x) => x.other === rid && x.t > t - 1e-6)?.t ?? t, -Infinity)
			const h = pr.hits.find((x) => x.other === id && x.t > tPrev)
			if (!h) return -Infinity
			// (after it: how high it rises, and how far along toward the next one it gets at the top)
			let top = null
			for (const [t, x, y] of pr.path) {
				if (t <= h.t + 0.02) continue
				if (!top || y > top.y) top = { x, y }
				else if (y < top.y - 0.03) break
			}
			if (!top) return -Infinity
			const ix = (Number(it.x) || 0) + c.dx
			const along = (top.x - ix) * dir
			if (along <= 0) return -Infinity
			return top.y + 0.5 * along + (pr.ok ? 100 : 0)
		}
		const coarse = []
		for (let dx = -0.72; dx <= 0.7201; dx += 0.06) coarse.push(make(Math.abs(dx) < 1e-9 ? 0 : dx))
		if (!coarse.some((c) => c && Math.abs(c.dx) < 1e-9)) coarse.push(make(0))
		const cs = coarse.filter(Boolean)
		const r1 = await evalAll(cs)
		const scored = cs.map((c, i) => ({ c, s: score(r1[i], c), pr: r1[i] })).filter((x) => Number.isFinite(x.s)).sort((a, b) => b.s - a.s)
		if (!scored.length) continue
		const fine = []
		for (const top of scored.slice(0, 3)) for (const d of [-0.04, -0.02, 0.02, 0.04]) {
			const dx = r5(top.c.dx + d)
			if (Math.abs(dx) > 0.75 || scored.some((x) => Math.abs(x.c.dx - dx) < 1e-6) || fine.some((x) => x && Math.abs(x.dx - dx) < 1e-6)) continue
			fine.push(make(dx))
		}
		const fs = fine.filter(Boolean)
		const r2 = await evalAll(fs)
		const all = [...scored, ...fs.map((c, i) => ({ c, s: score(r2[i], c), pr: r2[i] })).filter((x) => Number.isFinite(x.s))].sort((a, b) => b.s - a.s)
		const best = all[0]
		// (staying put when that is nearly as good: the fewest things moved)
		const stay = all.find((x) => Math.abs(x.c.dx) < 1e-9)
		const pick = stay && (last ? stay.pr?.ok : stay.s >= best.s - 0.03) ? stay : best
		if (Math.abs(pick.c.dx) > 1e-9) {
			cur = pick.c.scene
			moves.push({ kind: "move", ids: [id], dx: r5(pick.c.dx), dy: 0 })
		}
		if (pick.pr?.ok) break
	}
	out.ms = Math.round(now() - t0)
	if (!moves.length) return out
	// the whole set, checked on the app's own engine
	let vs = null
	try {
		out.runs++
		vs = opts.verify ? await opts.verify(cur, signal) : null
	} catch (e) {
		if (e?.name === "AbortError" || signal?.aborted) throw aborted()
	}
	const vr = vs ? judge(live, vs) : null
	if (!vs || !vr.every((r) => r.ok === true) || (vs.warnings?.length ?? 0) > (sim?.warnings?.length ?? 0)) return out
	// (through the machine: the chain still sets the thing off, nothing behind the launcher, no end wall)
	if (chainBreak(ctx, cur, vs, live)) return out
	// (it still works a little either side: each move 5 mm further and less, all at once)
	for (const f of [1, -1]) {
		const nudge = moves.map((m) => ({ ...m, dx: r5(m.dx + f * 0.005 * Math.sign(m.dx || 1)) }))
		let cand
		try {
			cand = applyChanges(scene, nudge, riders)
		} catch {
			continue
		}
		out.runs++
		const pr = await opts.probe(cand, live, mover, signal).catch((e) => {
			if (e?.name === "AbortError" || signal?.aborted) throw aborted()
			return null
		})
		if (!pr?.ok) out.fragile = true
	}
	// (said as one setup: "move the first trampoline 44 cm left, the 2nd trampoline 54 cm left and the last trampoline 30 cm left, to where
	// the tennis ball now comes down on each")
	const item = (id) => scene.items.find((i) => i.id === id)
	const movedIts = moves.map((m) => item(m.ids[0]))
	// (each by its place among its kind: "the first trampoline", never "Trampoline 1": V8820 c09)
	const parts = moves.map((m, i) => `${placeName(movedIts[i], scene)}${(riders.get(m.ids[0]) ?? []).length ? ` (with ${groupNames((riders.get(m.ids[0]) ?? []).map(item))} on it)` : ""} ${dirWords(m.dx, 0)}`)
	const whereW = `to where ${placeName(item(mover), scene)} now comes down on ${moves.length > 1 ? "each" : "it"}`
	const words = withTable({ say: `move ${andList(parts)}, ${whereW}`, did: `moved ${andList(parts)}, ${whereW}`, label: clipLabel(`Move ${groupNames(movedIts)} to where it lands`, 46) }, scene, cur)
	out.status = "found"
	out.fix = { scene: cur, sim: vs, changes: moves, cost: moves.reduce((t, m) => t + Math.abs(m.dx) * 100, 0), why: "restage", results: vr, words, ...(out.fragile ? { fragile: true } : {}) }
	out.targets = live
	out.ms = Math.round(now() - t0)
	return out
}
// ================================================================ the chain, judged: a fix must work THROUGH the machine (V8817, 16 Oct)
// A candidate that passes the goals can still skip the machine: the bucket moved behind the catapult so the bowling ball drops in off the
// invisible end wall; Ball 2 moved where it drops into the box at 0.87 s, before Ball 1 even reaches Ramp 2; the ramp leaned on the first
// domino so the row falls on its own with nothing released; the orange falls out of the rising pail and rolls 3 m, "moving" 40 cm. Each run
// is read as a chain (what set each thing off) and compared with the run before the change, the machine as it was meant to go.
const START_EPS = 0.01 // m: a part has started once it is 1 cm from where it began…
const START_TURN = 0.05 // rad (≈ 3°): …or turned that far
const SETTLE_M = 0.025 // m: a thing that never gets further than this (nor turns more than SETTLE_TURN) only settled or rocked
const SETTLE_TURN = 0.15
/** When each item first moves (any of its parts 1 cm along or 3° round) and whether it ever really moves: Map id -> {t, moved}. */
function onsets(sim) {
	const solids = (sim?.doc?.solids ?? []).filter((s) => s.kind === "dynamic")
	const frames = sim?.track?.frames ?? []
	const out = new Map()
	if (!frames.length) return out
	const p0 = new Map()
	const last = new Map()
	const t0 = new Map()
	const tSmall = new Map() // (the first stir: 2 mm or 1°, for a thing that strikes another while it barely moves itself)
	const far = new Map()
	const turn = new Map()
	for (const f of frames)
		for (const s of solids) {
			const p = f.placements?.[s.id] ?? last.get(s.id)
			if (!p) continue
			last.set(s.id, p)
			if (!p0.has(s.id)) p0.set(s.id, p)
			const a = p0.get(s.id)
			const d = Math.hypot(p.x - a.x, p.y - a.y)
			const r = Math.abs((p.angle ?? 0) - (a.angle ?? 0))
			if (d > (far.get(s.id) ?? 0)) far.set(s.id, d)
			if (r > (turn.get(s.id) ?? 0)) turn.set(s.id, r)
			if (!t0.has(s.id) && (d > START_EPS || r > START_TURN)) t0.set(s.id, f.t)
			if (!tSmall.has(s.id) && (d > 0.002 || r > 0.0175)) tSmall.set(s.id, f.t)
		}
	for (const s of solids) {
		const o = out.get(s.item) ?? { t: Infinity, stir: Infinity, moved: false, solids: [] }
		o.solids.push(s.id)
		if (t0.has(s.id)) o.t = Math.min(o.t, t0.get(s.id))
		if (tSmall.has(s.id)) o.stir = Math.min(o.stir, tSmall.get(s.id))
		if ((far.get(s.id) ?? 0) > SETTLE_M || (turn.get(s.id) ?? 0) > SETTLE_TURN) o.moved = true
		out.set(s.item, o)
	}
	return out
}
/**
 * What set each thing off in a run: Map id -> {t (when it started), by (the thing whose hit or ride did it; null: nothing did, it started on
 * its own: a released driver, or something the machine never touched)}. Only things that really move are in it.
 */
export function chainOf(sim, scene) {
	const on = onsets(sim)
	const typeOf = new Map((scene?.items ?? []).map((i) => [i.id, i.type]))
	const scenery = (id) => !id || id === "table" || ["table", "wall"].includes(typeOf.get(id))
	const of = new Map((sim?.doc?.solids ?? []).map((s) => [s.id, s.item]))
	const hits = new Map()
	for (const h of sim?.track?.impacts ?? []) {
		const a = of.get(h.a)
		const b = of.get(h.b)
		if (!a || !b || a === b || scenery(a) || scenery(b)) continue
		for (const [x, y] of [[a, b], [b, a]]) hits.set(x, [...(hits.get(x) ?? []), { t: h.t, by: y, speed: h.speed ?? 0 }])
	}
	// (what each rests on or sits in at the start: when that moves, it carries it)
	const carriers = new Map()
	try {
		for (const [sup, rs] of riderMap(scene)) for (const r of rs) carriers.set(r, [...(carriers.get(r) ?? []), sup])
	} catch {}
	const out = new Map()
	for (const [id, o] of on) {
		if (!o.moved || !Number.isFinite(o.t) || scenery(id)) continue
		// (a hit sets it off when what hit it was moving then: stirring at least, or striking it firmly while it was still at rest)
		const moving = (h) => on.has(h.by) && ((on.get(h.by).stir ?? Infinity) <= h.t + 0.12 || (h.speed >= 0.1 && h.t >= o.t - 1.5 && (on.get(h.by).stir ?? Infinity) <= o.t + 0.15))
		const hit = (hits.get(id) ?? []).filter((h) => h.t <= o.t + 0.05 && moving(h)).sort((p, q) => p.t - q.t)[0]
		const ride = hit ? null : (carriers.get(id) ?? []).filter((s) => (on.get(s)?.t ?? Infinity) <= o.t + 0.15).sort((p, q) => on.get(p).t - on.get(q).t)[0]
		out.set(id, { t: o.t, by: hit?.by ?? ride ?? null })
	}
	return out
}
/** Is a wall one of the invisible ones at the table's ends? */
const invisibleWall = (it) => it?.type === "wall" && it.props?.invisible_in_3d === true
/** "item|wall" for each firm touch of a thing with an invisible end wall in a run. */
function wallTouches(sim, scene) {
	const W = new Set((scene?.items ?? []).filter(invisibleWall).map((i) => i.id))
	const of = new Map((sim?.doc?.solids ?? []).map((s) => [s.id, s.item]))
	const out = new Set()
	for (const h of sim?.track?.impacts ?? []) {
		if ((h.speed ?? 0) < 0.15) continue
		const a = of.get(h.a)
		const b = of.get(h.b)
		if (W.has(a) && b && !W.has(b)) out.add(`${b}|${a}`)
		else if (W.has(b) && a && !W.has(a)) out.add(`${a}|${b}`)
	}
	return out
}
/** The things a word names in a scene ("the cone": the traffic cone; "Ramp 2"; "the soda cans": all three): by name, else by their kind's
 *  words (one thing, or several of one kind for a plural). [] when it names nothing there. */
function namedThings(words, scene) {
	const w = String(words ?? "").toLowerCase().replace(/^(the|a|an)\s+/, "").trim()
	if (!w) return []
	const items = (scene?.items ?? []).filter((i) => i.type !== "table" && i.type !== "wall")
	const byName = items.filter((i) => String(i.name ?? "").toLowerCase() === w)
	if (byName.length === 1) return byName
	const plural = /s$/.test(w)
	const head = w.split(/\s+/).at(-1).replace(/(?<=[^s])s$/, "")
	const byKind = items.filter((i) => {
		const ws = `${i.name ?? ""} ${typeName(i.type) ?? ""} ${kindNoun(i.type, 1)} ${i.type}`.toLowerCase().split(/[^\p{L}]+/u)
		return ws.includes(head) || ws.includes(`${head}s`)
	})
	if (byKind.length === 1) return byKind
	return plural && byKind.length > 1 && byKind.every((i) => i.type === byKind[0].type) ? byKind : []
}
/** The path words of a goal's label ("…sails over the cone into the bucket"): [{how: "over" | "under" | "past", what}] */
const PATH_RE = /\b(over|above|past|under|beneath)\s+((?:the|a|an)\s+[\p{L}\p{N}'’ -]+?)(?=\s+(?:and|into|onto|in|to|then|before|after|so|while|toward|towards)\b|[,.;!]|$)/giu
export function pathClaims(label) {
	const out = []
	for (const m of String(label ?? "").matchAll(PATH_RE)) out.push({ how: m[1].toLowerCase() === "above" ? "over" : m[1].toLowerCase() === "beneath" ? "under" : m[1].toLowerCase(), what: m[2].trim(), phrase: m[0].trim() })
	return out
}
/** Does a thing's path in a run do what a path word says about another thing? true / false / null (it can't be told). */
function pathHolds(claim, id, sim, scene) {
	const Xs = namedThings(claim.what, scene)
	if (!Xs.length || Xs.some((X) => X.id === id)) return null
	let box = null
	try {
		const ins = inspect(scene)
		const bs = Xs.map((X) => ins.box(X.id)).filter(Boolean)
		if (bs.length) box = { x0: Math.min(...bs.map((b) => b.x0)), x1: Math.max(...bs.map((b) => b.x1)), y0: Math.min(...bs.map((b) => b.y0)), y1: Math.max(...bs.map((b) => b.y1)) }
	} catch {}
	const P = pathOf(sim, id)
	if (!box || P.length < 2) return null
	const r = reachOf(sim, id)
	const over = P.filter((p) => p.x >= box.x0 && p.x <= box.x1)
	if (claim.how === "over") return over.some((p) => p.y - r > box.y1 - 0.005)
	if (claim.how === "under") return over.some((p) => p.y + r < box.y0 + 0.005)
	const right = P[0].x < (box.x0 + box.x1) / 2
	return right ? P.some((p) => p.x - r > box.x1) : P.some((p) => p.x + r < box.x0)
}
/** A goal's label as a fix may claim it: a path phrase whose thing can't be found in the scene is left out ("sails over the cone into the
 *  bucket" with no cone: "sails into the bucket"), never claimed unchecked. */
export function claimLabel(label, scene) {
	let out = String(label ?? "")
	for (const c of pathClaims(out)) if (!namedThings(c.what, scene).length) out = out.replace(c.phrase, "").replace(/\s{2,}/g, " ").replace(/\s+([,.;!])/g, "$1").trim()
	return out
}
/**
 * Does a version that meets the goals get there through the machine? ctx: {scene, sim (the edited version and its run), before: {scene, sim}
 * (the machine as it was meant to go)}; scene, sim: the candidate and its whole run; targets: the goals it meets. -> null, or why not in words:
 * 1. nothing starts on its own that didn't before (a released driver, or a thing the person's change put in that does so in their version);
 * 2. each goal's thing is set off by what set it off before, by something before that in the chain, or by something new in it;
 * 3. no new touch of an invisible end wall (a goal's own thing: never; anything else: not one the person's version didn't have);
 * 4. a container is never moved to the far side of what launches the thing into it;
 * 5. a "moves" goal keeps its direction, and its thing stays on or in what carried it;
 * 6. the path words of a goal's label ("over the cone") hold, when they did before.
 */
export function chainBreak(ctx, scene, sim, targets = null) {
	const theName = (it) => placeName(it, scene) // (one of a row by its place: "the 6th soda can", never "Soda can 6")
	const before = ctx?.before
	if (!before?.sim?.track?.frames?.length || !before?.scene?.items || !sim?.track?.frames?.length || !scene?.items) return null
	const tg = targets ?? ctx.targets ?? fixTargets({ goals: ctx.goals, scene: ctx.scene, before, sim: ctx.sim })
	const A = new Map(before.scene.items.map((i) => [i.id, i]))
	const E = new Map((ctx.scene?.items ?? []).map((i) => [i.id, i]))
	const K = new Map(scene.items.map((i) => [i.id, i]))
	const fresh = (id) => !A.has(id) || (K.has(id) && A.get(id).type !== K.get(id).type)
	const theirs = (id) => E.has(id) && (!A.has(id) || A.get(id).type !== E.get(id).type)
	const nm = (id) => theName(K.get(id) ?? E.get(id) ?? A.get(id) ?? { name: id })
	let C0
	let C1
	let CE = null
	try {
		C0 = chainOf(before.sim, before.scene)
		C1 = chainOf(sim, scene)
		if (ctx.sim?.track?.frames?.length) CE = chainOf(ctx.sim, ctx.scene)
	} catch {
		return null
	}
	// 1. what starts on its own
	for (const [id, c] of [...C1].sort((p, q) => p[1].t - q[1].t)) {
		if (c.by !== null) continue
		if (A.has(id) && C0.get(id)?.by === null) continue
		if (theirs(id) && CE?.get(id)?.by === null) continue
		// (the person's own version already starts it on its own, and the fix left it where it was: not the fix's doing)
		const e = E.get(id)
		const k = K.get(id)
		if (CE?.get(id)?.by === null && e && k && Math.abs((Number(e.x) || 0) - (Number(k.x) || 0)) < 0.002 && Math.abs((Number(e.y) || 0) - (Number(k.y) || 0)) < 0.002 && Math.abs(CE.get(id).t - c.t) < 0.15) continue
		const n = nm(id)
		return `${n} would start moving on ${/s$/i.test(n) && !/\d/.test(n) ? "their" : "its"} own (at ${trimNum(c.t, 2)} s), with nothing in the machine setting ${/s$/i.test(n) && !/\d/.test(n) ? "them" : "it"} off`
	}
	const goalIds = new Set(tg.flatMap((t) => goalItems(t.goal)))
	// 2. what sets each goal's thing off
	for (const t of tg)
		for (const id of goalItems(t.goal)) {
			const c0 = C0.get(id)
			const c1 = C1.get(id)
			if (!c0 || !c1 || c0.by === null || c1.by === null || c1.by === c0.by) continue
			const chain = new Set()
			for (let p = c0.by, k = 0; p && k < 16 && !chain.has(p); k++) (chain.add(p), (p = C0.get(p)?.by ?? null))
			if (chain.has(c1.by) || fresh(c1.by)) continue
			return `${nm(id)} would be set off by ${nm(c1.by)}, not by the machine (${nm(c0.by)} did it before)`
		}
	// 3. the invisible end walls
	const W0 = wallTouches(before.sim, before.scene)
	const WE = ctx.sim?.track ? wallTouches(ctx.sim, ctx.scene) : new Set()
	for (const k of wallTouches(sim, scene)) {
		const [id] = k.split("|")
		if (W0.has(k) || (!goalIds.has(id) && WE.has(k))) continue
		return `${nm(id)} would bounce off the invisible wall at the table's end`
	}
	const x = (it) => Number(it?.x) || 0
	for (const t of tg) {
		const g = t.goal
		const id = goalItems(g)[0]
		// 4. the container stays on the side the thing is launched toward
		if (goalKind(g) === "in" && g.container && id) {
			const L = C0.get(id)?.by ?? null
			const l0 = L ? A.get(L) : A.get(id)
			const l1 = L ? K.get(L) : K.get(id)
			const b0 = A.get(g.container)
			const b1 = K.get(g.container)
			if (l0 && l1 && b0 && b1) {
				const s0 = x(b0) - x(l0)
				const s1 = x(b1) - x(l1)
				if (Math.abs(s0) > 0.03 && Math.abs(s1) > 0.03 && Math.sign(s0) !== Math.sign(s1)) return `${nm(g.container)} would be moved behind ${L ? nm(L) : `where ${nm(id)} starts`}, away from where it is sent`
			}
		}
		// 5. a "moves" goal: the same way as before, and on or in what carried it
		if (goalKind(g) === "moves" && id) {
			const p0 = pathOf(before.sim, id)
			const p1 = pathOf(sim, id)
			if (p0.length > 1 && p1.length > 1) {
				const d0 = { x: p0.at(-1).x - p0[0].x, y: p0.at(-1).y - p0[0].y }
				const d1 = { x: p1.at(-1).x - p1[0].x, y: p1.at(-1).y - p1[0].y }
				const n0 = Math.hypot(d0.x, d0.y)
				const n1 = Math.hypot(d1.x, d1.y)
				const way = (d) => (Math.abs(d.y) > Math.abs(d.x) ? (d.y > 0 ? "up" : "down") : d.x > 0 ? "right" : "left")
				if (n0 > 0.05 && n1 > 0.05 && (d0.x * d1.x + d0.y * d1.y) / (n0 * n1) < 0.5) return `${nm(id)} would go ${way(d1)}, not ${way(d0)} as before`
				// (what carried it: the moving part of what it rested on or in that stayed with it before)
				const carried = carrierPath(before.sim, before.scene, id)
				if (carried && carried.stays) {
					const c1 = carrierPath(sim, scene, id, carried.solid)
					if (!c1 || !c1.stays) return `${nm(id)} wouldn't stay ${carried.inside ? "in" : "on"} ${nm(carried.item)}`
				}
			}
		}
		// 6. path words in the goal's label
		for (const claim of pathClaims(t.label)) {
			if (!id || pathHolds(claim, id, before.sim, before.scene) !== true) continue
			if (pathHolds(claim, id, sim, scene) === false) return `${nm(id)} wouldn't go ${claim.how} ${claim.what}`
		}
	}
	// 7. a goal's own thing that the machine set off before never starts on its own, whatever the person's version does: a fix that "works" with
	// the machine playing no part (the ball rolling off on its own, a shrunken box slid under it) is no fix (V8832 x3: "Replace the seesaw with a
	// pillow", Ball 2 started at 0.55 s by itself and the offer moved the box under it; rule 1 let it by, as the person's version did the same)
	// (a thing that only settled or rolled a little on its seat at the start, then was thrown by the machine, is set off by the machine: what
	// counts is whether a part of the machine acts on it before it really goes, 10 cm from where it began)
	const of = new Map((sim?.doc?.solids ?? []).map((x) => [x.id, x.item]))
	let carriersOf = new Map()
	try {
		for (const [sup, rs] of riderMap(scene)) for (const r of rs) carriersOf.set(r, [...(carriersOf.get(r) ?? []), sup])
	} catch {}
	const machineActs = (id) => {
		const P = pathOf(sim, id)
		const t10 = P.find((q) => Math.hypot(q.x - P[0].x, q.y - P[0].y) >= 0.1)?.t ?? Infinity
		const inChain = (o) => C1.has(o) && (C1.get(o).by !== null || C0.get(o)?.by === null)
		for (const h of sim?.track?.impacts ?? []) {
			const a = of.get(h.a)
			const b = of.get(h.b)
			const o = a === id ? b : b === id ? a : null
			if (!o || o === id || (h.speed ?? 0) < 0.2 || h.t > t10 + 0.05) continue
			if (inChain(o) && C1.get(o).t <= h.t + 0.05) return true
		}
		return (carriersOf.get(id) ?? []).some((sup) => C1.get(sup)?.by != null && C1.get(sup).t <= t10 + 0.05)
	}
	for (const t of tg)
		for (const id of goalItems(t.goal)) {
			const c0 = C0.get(id)
			const c1 = C1.get(id)
			if (!c0 || c0.by === null || !c1 || c1.by !== null || machineActs(id)) continue
			const n = nm(id)
			const many = /s$/i.test(n) && !/\d/.test(n)
			return `nothing in the machine sets ${n} off: ${many ? "they start" : "it starts"} moving on ${many ? "their" : "its"} own (at ${trimNum(c1.t, 2)} s)`
		}
	return null
}
/** What carried a thing at the start of a run (the moving part of what it rests on or sits in, nearest to it), and whether it stayed with
 *  it to the end (within 6 cm of where it sat on it). solid: that part's id, to follow the same one in another run. */
function carrierPath(sim, scene, id, solid = null) {
	let sup = null
	try {
		for (const [s, rs] of riderMap(scene)) if (rs.includes(id)) sup = s
	} catch {}
	const frames = sim?.track?.frames ?? []
	if (!frames.length) return null
	const sids = (sim?.doc?.solids ?? []).filter((s) => s.kind === "dynamic")
	const mine = sids.filter((s) => s.item === id).map((s) => s.id)
	const first = (sid) => frames.find((f) => f.placements?.[sid])?.placements?.[sid] ?? null
	const lastP = (sid) => [...frames].reverse().find((f) => f.placements?.[sid])?.placements?.[sid] ?? null
	const P = pathOf(sim, id)
	if (!mine.length || P.length < 2) return null
	let cs = solid
	if (!cs) {
		if (!sup) return null
		const parts = sids.filter((s) => s.item === sup).map((s) => ({ id: s.id, p: first(s.id) })).filter((x) => x.p)
		if (!parts.length) return null
		cs = parts.sort((p, q) => Math.hypot(p.p.x - P[0].x, p.p.y - P[0].y) - Math.hypot(q.p.x - P[0].x, q.p.y - P[0].y))[0].id
	}
	const c0 = first(cs)
	const c1 = lastP(cs)
	if (!c0 || !c1) return null
	const rel0 = { x: P[0].x - c0.x, y: P[0].y - c0.y }
	const rel1 = { x: P.at(-1).x - c1.x, y: P.at(-1).y - c1.y }
	// (only a carrier that itself went somewhere: a pail that rose, a cart that rolled)
	const went = Math.hypot(c1.x - c0.x, c1.y - c0.y) > 0.05
	const of = new Map(sids.map((s) => [s.id, s.item]))
	const item = of.get(cs) ?? sup
	const ins = CONTAINERS.includes((scene.items.find((i) => i.id === item) ?? {}).type)
	return { solid: cs, item, inside: ins, stays: went && Math.hypot(rel1.x - rel0.x, rel1.y - rel0.y) < 0.06 }
}

/** A fix that needed a wider table says so: "… (and make the table 30 cm wider)". */
function withTable(words, scene, fixed) {
	const dw = (tableWidth(fixed) ?? 0) - (tableWidth(scene) ?? 0)
	if (!(dw > 0.001)) return words
	return { ...words, say: `${words.say} (and make the table ${fmtLen(dw)} wider)`, did: `${words.did} (and made the table ${fmtLen(dw)} wider)` }
}
/** What the first failing target does in a run, in words. */
function firstMiss(targets, results, sim, scene, before = null) {
	const i = results.findIndex((r) => r.ok !== true)
	return i < 0 ? null : outcomeWords(results[i], targets[i].goal, sim, scene, before)
}

// ================================================================ a fix in words: "lower the box 4 cm", "shift the dominoes, the seesaw and Ball 2 8 cm left"
const dirWords = (dx, dy) => [Math.abs(dx) >= 0.0005 ? `${fmtLen(dx)} ${dx > 0 ? "right" : "left"}` : null, Math.abs(dy) >= 0.0005 ? `${fmtLen(dy)} ${dy > 0 ? "up" : "down"}` : null].filter(Boolean).join(" and ")
const sig = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Number(Number(v).toPrecision(3))))
/** One change in words, as an instruction ("lower the box 4 cm") and as done ("lowered the box 4 cm"). */
/** Things named together: three golf balls are "the golf balls", else each by its name ("Ball 2 and the box"). */
export function groupNames(items) {
	const list = items.filter(Boolean)
	const types = new Set(list.map((i) => i.type))
	if (list.length > 1 && types.size === 1) {
		const w = lc(typeName(list[0].type) ?? "thing")
		return `the ${/(s|x|z|ch|sh)$/.test(w) ? `${w}es` : `${w}s`}`
	}
	return andList(list.map(theName))
}
/**
 * Things moved together, said by group (V8817 c02: "the bucket, Book 1 (with the hardcover books on it), Bowling pin 1, Bowling pin 2 and
 * Bowling pin 3" for "the bucket, the 4 hardcover books and the 3 bowling pins"): several of one kind by their count, one thing by its name
 * (with what rides on it, of another kind, after it). ids: the things moved (what rides on them goes too); R: riderMap.
 */
export function movedNames(ids, scene, R) {
	const theName = (it) => placeName(it, scene) // (one of a row by its place: "the 6th soda can", never "Soda can 6")
	const item = (id) => scene.items.find((i) => i.id === id)
	const all = [...new Set(ids.flatMap((id) => [id, ...(R.get(id) ?? [])]))].map(item).filter(Boolean)
	const said = new Set()
	const parts = []
	const byType = new Map()
	for (const it of all) byType.set(it.type, [...(byType.get(it.type) ?? []), it])
	for (const id of ids) {
		const it = item(id)
		if (!it || said.has(it.id)) continue
		const kin = byType.get(it.type) ?? [it]
		if (kin.length > 1) {
			kin.forEach((k) => said.add(k.id))
			const n = kin.length
			const every = scene.items.filter((i) => i.type === it.type).length === n
			parts.push(`${every ? "the" : `${n} of the`} ${every ? `${n} ` : ""}${kindNoun(it.type, n, { short: true })}`)
			continue
		}
		said.add(it.id)
		const rs = (R.get(id) ?? []).map(item).filter((r) => r && r.type !== it.type && !said.has(r.id))
		rs.forEach((r) => said.add(r.id))
		parts.push(`${theName(it)}${rs.length ? ` (with ${groupNames(rs)} ${CONTAINERS.includes(it.type) ? "in" : "on"} it)` : ""}`)
	}
	return andList(parts)
}
/** A short name for a chip: "the launcher" for "the spring launcher" (a proper name, "Ball 2", stays). */
const shortName = (it, scene = null) => {
	const n = placeName(it, scene)
	return /^the \S+ \S+$/.test(n) && !/^the (first|last|top|bottom|\d+(st|nd|rd|th))\b/.test(n) ? `the ${n.split(" ").at(-1)}` : n
}
/** Do these moves (with what rides on them) take every real thing but `lead` (and what rides on it)? "everything else" */
function everythingElse(ids, lead, scene, R) {
	const moved = new Set(ids.flatMap((id) => [id, ...(R.get(id) ?? [])]))
	const fixed = new Set([lead, ...(R.get(lead) ?? [])])
	const real = scene.items.filter((i) => i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d) && !fixed.has(i.id))
	return real.length > 2 && real.every((i) => moved.has(i.id))
}
function changeWords(c, scene, before) {
	const theName = (it) => placeName(it, scene) // (one of a row by its place: "the 6th soda can", never "Soda can 6")
	const item = (id) => scene.items.find((i) => i.id === id)
	if (c.kind === "move") {
		const R = riderMap(scene)
		if (c.follows && c.ids.length > 1 && everythingElse(c.ids, c.follows, scene, R)) {
			const w = `everything else ${dirWords(c.dx, c.dy)} to line up with ${theName(item(c.follows))}`
			return { say: `shift ${w}`, did: `shifted ${w}`, label: `Shift everything else ${dirWords(c.dx, c.dy)}` }
		}
		const names = c.ids.map((id) => {
			const it = item(id)
			const rs = (R.get(id) ?? []).map(item)
			return `${theName(it)}${rs.length && c.ids.length === 1 ? ` (with ${groupNames(rs)} on it)` : ""}`
		})
		const riding = c.ids.flatMap((id) => R.get(id) ?? []).filter((id) => !c.ids.includes(id))
		const all = c.ids.length > 1 ? [...names, ...(riding.length ? [groupNames(riding.map(item))] : [])] : names
		// (several things: by group, never each by its name)
		const who = c.ids.length > 2 ? movedNames(c.ids, scene, R) : andList(all)
		const lead = c.follows ? item(c.follows) : null
		const why = lead ? ` to line up with ${theName(lead)}` : c.reason ? ` ${c.reason}` : ""
		if (Math.abs(c.dx) < 0.0005 && Math.abs(c.dy) >= 0.0005) {
			const v = c.dy < 0 ? ["lower", "lowered"] : ["raise", "raised"]
			return { say: `${v[0]} ${who} ${fmtLen(c.dy)}${why}`, did: `${v[1]} ${who} ${fmtLen(c.dy)}${why}` }
		}
		const verb = all.length > 1 ? ["shift", "shifted"] : ["move", "moved"]
		return { say: `${verb[0]} ${who} ${dirWords(c.dx, c.dy)}${why}`, did: `${verb[1]} ${who} ${dirWords(c.dx, c.dy)}${why}` }
	}
	if (c.kind === "slide") {
		const it = item(c.id)
		const sup = item(c.on)
		// (up the ramp is toward its higher end: a ramp turned clockwise, angle < 0, is higher on the left)
		const up = (Number(sup?.angle) || 0) < 0 ? c.dx < 0 : c.dx > 0
		const w = `${theName(it)} ${fmtLen(c.dx)} ${up ? "higher up" : "lower down"} ${theName(sup)}`
		return { say: `start ${w}`, did: `started ${w}`, label: `start ${shortName(it, scene)} ${fmtLen(c.dx)} ${up ? "higher" : "lower"}` }
	}
	if (c.kind === "turn" && Math.abs(Math.abs(c.d) - 180) < 1e-6) {
		const it = item(c.id)
		return { say: `turn ${theName(it)} round to face the other way`, did: `turned ${theName(it)} round to face the other way`, label: `Turn ${shortName(it, scene)} round` }
	}
	if (c.kind === "turn") {
		const it = item(c.id)
		const a = Number(it?.angle) || 0
		const steeper = Math.abs(a + c.d) > Math.abs(a)
		const w = `${theName(it)} ${trimNum(Math.abs(c.d), 1)}° ${steeper ? "steeper" : "flatter"} (${sig(Math.abs(a))}° → ${sig(Math.abs(a + c.d))}°)`
		return { say: `tilt ${w}`, did: `tilted ${w}` }
	}
	if (c.kind === "add") {
		const L = item(c.near)
		const row = (c.row ?? []).map(item).filter(Boolean)
		const rowWords = row.length > 1 ? `the ${kindNoun(row[0].type, row.length, { short: true })}` : row[0] ? theName(row[0]) : null
		const how = Math.abs(Math.abs(Number(c.item.angle) || 0) - 90) < 1 ? " on its edge" : ""
		const where = L ? (rowWords ? ` between ${rowWords} and ${theName(L)}` : ` next to ${theName(L)}`) : ""
		const so = L && rowWords ? `, so they tip it onto ${theName(L)}` : ""
		// (one made thinner says so: "a closed laptop 6 mm thick")
		const thin = num(c.item.props?.height) !== null && num(propSpec(c.item.type, "height")?.default) !== null && c.item.props.height < propSpec(c.item.type, "height").default - 1e-4 ? ` ${fmtLen(c.item.props.height)} thick` : ""
		return { say: `stand ${aKindOf(c.item.type)}${thin}${how}${where}${so}`, did: `stood ${aKindOf(c.item.type)}${thin}${how}${where}${so}`, label: L ? `Stand ${aKindOf(c.item.type)} by ${shortName(L, scene)}` : `Add ${aKindOf(c.item.type)}` }
	}
	if (c.kind === "layout") {
		const list = c.ids.map(item).filter(Boolean)
		const n = list.length
		const w = `the ${n > 1 ? kindNoun(list[0]?.type, n, { short: true }) : theName(list[0])} ${fmtLen(c.sp)} apart, up to it`
		return { say: `set ${w}`, did: `set ${w}` }
	}
	if (c.kind === "props") {
		const list = c.ids.map(item).filter(Boolean)
		const n = list.length
		const who = n > 1 ? `the ${n} ${kindNoun(list[0]?.type, n, { short: true })}` : theName(list[0])
		const wa = weightOf(list[0]?.type, { ...(list[0]?.props ?? {}), [c.key]: c.from })
		const wb = weightOf(list[0]?.type, { ...(list[0]?.props ?? {}), [c.key]: c.to })
		const each = wa && wb && Math.abs(wa - wb) / wa > 0.02 ? ` (${fmtMass(wa)} → ${fmtMass(wb)}${n > 1 ? " each" : ""})` : ""
		if (c.key === "full") {
			const v = c.to ? ["fill", "filled"] : ["empty", "emptied"]
			return { say: `${v[0]} ${who}${each}`, did: `${v[1]} ${who}${each}`, label: `${cap(v[0])} ${n > 1 ? `the ${kindNoun(list[0]?.type, n, { short: true })}` : who}` }
		}
		const sp = propSpec(list[0]?.type, c.key)
		const label = lc(sp?.label ?? c.key.replace(/_/g, " "))
		return { say: `set ${who}'s ${label} to ${c.to}${each}`, did: `set ${who}'s ${label} to ${c.to}${each}` }
	}
	if (c.kind === "spread") {
		const list = c.ids.map(item).filter(Boolean)
		const n = list.length
		const xs = list.map((i) => Number(i.x) || 0).sort((p, q) => p - q)
		const gap = n > 1 ? (xs.at(-1) - xs[0]) / (n - 1) : 0
		const noun = kindNoun(list[0]?.type, n, { short: true })
		const w = `the ${n} ${noun} ${c.k < 1 ? "closer together" : "further apart"} (${lenPair(gap, gap * c.k)} apart)`
		return { say: `space ${w}`, did: `spaced ${w}`, label: `Space the ${noun} ${c.k < 1 ? "closer" : "further apart"}` }
	}
	if (c.kind === "remove") {
		const w = item(c.ids[0])
		const tbl = scene.items.find((i) => i.type === "table")
		const side = w && tbl ? ((Number(w.x) || 0) > (Number(tbl.x) || 0) ? "right" : "left") : null
		const what = w?.type === "wall" && w.props?.invisible_in_3d ? `the invisible wall at the table's ${side ?? ""} end`.replace("  ", " ") : theName(w)
		return { say: `take away ${what}, so things can go off that end`, did: `took away ${what}, so things can go off that end`, label: `Take away the ${side ?? ""} end wall`.replace("  ", " ") }
	}
	if (c.kind === "scale") {
		const list = c.ids.map(item).filter(Boolean)
		const n = list.length
		const it0 = list[0]
		const who = n > 1 ? `the ${n} ${kindNoun(it0?.type, n, { short: true })}` : theName(it0)
		const sk = sizeKeys(it0?.type)
		const onlyH = c.keys.length === 1 && c.keys[0] === sk.h && sk.all.length > 1
		const onlyW = c.keys.length === 1 && c.keys[0] === sk.w && sk.all.length > 1
		const key = onlyW ? sk.w : c.keys.includes(sk.h) ? sk.h : c.keys[0]
		const v0 = num(propValue(it0, key))
		const dim = /height|first_height/.test(key) ? "tall" : /diameter|radius/.test(key) ? "across" : /length/.test(key) ? "long" : "wide"
		const how = onlyH ? (c.k < 1 ? "shorter" : "taller") : onlyW ? (c.k < 1 ? "slimmer" : "wider") : c.k < 1 ? "smaller" : "bigger"
		// (and what it weighs then, when that follows the size: "(6.7 → 5.4 cm across; 125 → 64 g)", as the fix card says it: V8820 n6)
		let wt = ""
		try {
			const P = { ...(it0?.props ?? {}) }
			for (const k of c.keys) if (num(propValue(it0, k)) !== null) P[k] = num(propValue(it0, k)) * c.k
			const wa = it0?.props?.mass === undefined ? weightOf(it0?.type, it0?.props ?? {}) : null
			const wb = wa ? weightOf(it0?.type, P) : null
			if (wa && wb && Math.abs(wb - wa) / wa > 0.03) wt = `; ${fmtMass(wa)} → ${fmtMass(wb)}`
		} catch {}
		const range = v0 ? ` (${lenPair(v0, v0 * c.k)} ${dim}${wt}${n > 1 ? " each" : ""})` : ""
		return { say: `make ${who} ${how}${range}`, did: `made ${who} ${how}${range}`, label: `Make ${n > 1 ? `the ${kindNoun(it0?.type, n, { short: true })}` : theName(it0)} ${how}` }
	}
	if (c.kind === "prop" && Array.isArray(c.follow) && (c.key === "growth" || c.key === "first_height")) {
		const it = item(c.id)
		const a = c.from ?? propValue(it, c.key)
		const b = c.to
		const R = riderMap(scene)
		const lead = c.follow.filter((id) => !c.follow.some((o) => (R.get(o) ?? []).includes(id))).map(item).filter(Boolean)
		const what = c.key === "growth" ? `grow ${b > a ? "faster" : "slower"} (each ${sig(a)} → ${sig(b)}× the one before)` : `${b > a ? "bigger" : "smaller"} (the first ${lenPair(a, b)} tall)`
		const d = num(c.shift)
		const carried = lead.length && d ? `, with ${movedNames(lead.map((o) => o.id), scene, R)} moved ${fmtLen(d)} ${d > 0 ? "right" : "left"} to keep the same gap after them` : ""
		const verb = c.key === "growth" ? ["make", "made"] : ["make", "made"]
		return { say: `${verb[0]} ${theName(it)} ${what}${carried}`, did: `${verb[1]} ${theName(it)} ${what}${carried}`, label: c.key === "growth" ? `Make ${theName(it)} grow faster` : `Make ${theName(it)} bigger` }
	}
	if (c.kind === "prop") {
		const it = item(c.id)
		const sp = propSpec(it?.type, c.key)
		const label = lc(sp?.label ?? c.key.replace(/_/g, " "))
		const a = c.from ?? propValue(it, c.key)
		const b = c.to
		const up = b > a
		if (c.key === "mass") {
			const g = (kg) => (kg >= 1 ? `${trimNum(kg, 2)} kg` : `${trimNum(kg * 1000, kg < 0.01 ? 1 : 0)} g`)
			return { say: `make ${theName(it)} ${up ? "heavier" : "lighter"} (${g(a)} → ${g(b)})`, did: `made ${theName(it)} ${up ? "heavier" : "lighter"} (${g(a)} → ${g(b)})` }
		}
		if (c.key === "tilt") return { say: `tilt ${theName(it)} ${up ? "more" : "less"} (${sig(a)}° → ${sig(b)}°)`, did: `tilted ${theName(it)} ${up ? "more" : "less"} (${sig(a)}° → ${sig(b)}°)` }
		if (c.key === "compression" || c.key === "pull_back") {
			const u = c.key === "compression" ? (x) => fmtLen(x) : (x) => `${sig(x)}°`
			return { say: `pull ${theName(it)} back ${up ? "further" : "less"} (${u(a)} → ${u(b)})`, did: `pulled ${theName(it)} back ${up ? "further" : "less"} (${u(a)} → ${u(b)})` }
		}
		if (c.key === "spacing") {
			// (a row's spacing is in domino heights: said as the first gap in cm)
			const h = num(propValue(it, "first_height"))
			const gap = (v) => (h ? fmtLen(v * h) : `${trimNum(v, 2)} ${sp?.unit ?? ""}`.trim())
			const ga = gap(a)
			const gb = gap(b)
			const same = ga.split(" ").at(-1) === gb.split(" ").at(-1)
			const w = `${theName(it)} ${up ? "further apart" : "closer together"} (${h ? "first gap " : ""}${same ? ga.replace(/ \S+$/, "") : ga} → ${gb})`
			return { say: `space ${w}`, did: `spaced ${w}` }
		}
		const unit = sp?.unit === "m" ? (x) => fmtLen(x) : (x) => `${sig(x)}${sp?.unit ? (sp.unit === "°" ? "°" : ` ${sp.unit}`) : ""}`
		return { say: `set ${theName(it)}'s ${label} to ${unit(b)} (from ${unit(a)})`, did: `set ${theName(it)}'s ${label} to ${unit(b)} (from ${unit(a)})` }
	}
	return { say: "adjust it", did: "adjusted it" }
}
/**
 * A fix's changes in words: {say: "lower the box 4 cm" (the offer: "Want me to …?"), did: "lowered the box 4 cm" (the reply once done),
 * label: "Lower the box 4 cm" (the chip: short)}.
 */
export function fixWords(changes, scene, before = null) {
	const theName = (it) => placeName(it, scene) // (one of a row by its place: "the 6th soda can", never "Soda can 6")
	// a stand-in for a lost hit, with the row laid out up to it (and emptied), or the row grown a little and the rest moved along to make room:
	// one offer
	const addC = changes.find((c) => c.kind === "add")
	if (addC && changes.every((c) => c === addC || ["layout", "props"].includes(c.kind) || (c.kind === "prop" && Array.isArray(c.follow)) || (c.kind === "move" && c.reason === "to make room"))) {
		const a = changeWords(addC, scene, before)
		const lay = changes.find((c) => c.kind === "layout")
		const pr = changes.find((c) => c.kind === "props")
		const grow = changes.find((c) => c.kind === "prop" && Array.isArray(c.follow))
		const mv = changes.find((c) => c.kind === "move" && c.reason === "to make room")
		const list = (lay?.ids ?? []).map((id) => scene.items.find((i) => i.id === id)).filter(Boolean)
		const n = list.length
		const how = []
		if (pr) {
			const pw = changeWords(pr, scene, before)
			how.push(pw.did.replace(/^(emptied|filled) the \d+ [^(]*?(?= \(|$)/, "$1"))
		}
		if (lay) {
			// (and where the row now starts, as the fix card says it: "7 cm apart, starting 2.6 cm further right": V8820, the breakfast)
			const at = lay.ids.map((id, i) => ({ i, x: Number(scene.items.find((it) => it.id === id)?.x) || 0 })).sort((p, q) => p.x - q.x)[0]
			const d0 = at ? r5(lay.xs[at.i] - at.x) : 0
			how.push(`${fmtLen(lay.sp)} apart${Math.abs(d0) >= 0.005 ? `, starting ${fmtLen(d0)} further ${d0 > 0 ? "right" : "left"}` : ""}`)
		}
		const parts = []
		if (n > 1 && how.length) parts.push(`the ${n} ${kindNoun(list[0].type, n, { short: true })} ${andList(how)}`)
		if (grow) {
			const it = scene.items.find((i) => i.id === grow.id)
			parts.push(`${theName(it)} growing a little faster (each ${sig(grow.from ?? propValue(it, "growth"))} → ${sig(grow.to)}× the one before)`)
		}
		if (mv) {
			const R = riderMap(scene)
			const shift = r5(mv.dx + (num(grow?.shift) ?? 0))
			const who = movedNames(mv.ids, scene, R)
			parts.push(`${who} moved ${fmtLen(shift)} ${shift > 0 ? "right" : "left"} to make room`)
		}
		const tail = parts.length ? `, with ${andList(parts)}` : ""
		return { say: `${a.say}${tail}`, did: `${a.did}${tail}`, label: a.label }
	}
	// several things lined up with one: "shift the dominoes 7 cm left, and Ramp 2 and the box 10 cm left, to line up with the seesaw"
	if (changes.length > 1 && changes.every((c) => c.kind === "move" && c.follows && c.follows === changes[0].follows)) {
		const R = riderMap(scene)
		const item = (id) => scene.items.find((i) => i.id === id)
		const parts = changes.map((c) => `${movedNames(c.ids, scene, R)} ${dirWords(c.dx, c.dy)}`)
		const lead = theName(item(changes[0].follows))
		const n = new Set(changes.flatMap((c) => c.ids.flatMap((id) => [id, ...(R.get(id) ?? [])]))).size
		// (all of the rest: said so, with the odd one out named: "shift everything else 10 cm left (the dominoes only 7 cm) to line up with the seesaw")
		if (everythingElse(changes.flatMap((c) => c.ids), changes[0].follows, scene, R)) {
			const main = [...changes].sort((a, b) => b.ids.length - a.ids.length)[0]
			const odd = changes.filter((c) => c !== main).map((c) => `${andList(c.ids.map((id) => theName(item(id))))} only ${fmtLen(Math.hypot(c.dx, c.dy))}`)
			const w = `everything else ${dirWords(main.dx, main.dy)}${odd.length ? ` (${andList(odd)})` : ""} to line up with ${lead}`
			return { say: `shift ${w}`, did: `shifted ${w}`, label: `Line everything up with ${lead}` }
		}
		return { say: `shift ${parts.join(", and ")}, to line up with ${lead}`, did: `shifted ${parts.join(", and ")}, to line up with ${lead}`, label: clipLabel(cap(`line ${movedNames([...new Set(changes.flatMap((c) => c.ids))], scene, R)} up with ${lead}`), 46) }
	}
	// (one row made slimmer and closer together: said of the row once, "make the 10 soda cans slimmer (6.6 → 4.6 cm across each) and closer
	// together (16 → 10 cm apart)")
	if (changes.length === 2 && changes[0].kind === "scale" && changes[1].kind === "spread" && JSON.stringify([...changes[0].ids].sort()) === JSON.stringify([...changes[1].ids].sort())) {
		const a = changeWords(changes[0], scene, before)
		const b = changeWords(changes[1], scene, before)
		const tail = b.say.replace(/^space the \d+ [^(]*?(closer together|further apart)/, "$1")
		return { say: `${a.say} and ${tail}`, did: `${a.did} and ${tail}`, label: clipLabel(`${a.label} and ${changes[1].k < 1 ? "closer" : "further apart"}`, 46) }
	}
	const parts = changes.map((c) => changeWords(c, scene, before))
	const say = andList(parts.map((p) => p.say))
	const did = andList(parts.map((p) => p.did))
	const short = (p) => p.label ?? p.say.replace(/ (to line up with|so it) .*$/, "").replace(/ \([^)]*\)/g, "")
	let label = cap(parts.map(short).join(", "))
	// (three changes or more: the chip says how many, never one change standing for six: V8820 c01, "Move the box 1 cm down" for a fix that also
	// took away the end wall and made the fan faster)
	if (parts.length >= 3) label = clipLabel(`Make ${parts.length} changes: ${lc(short(parts[0]))}`, 46)
	else if (label.length > 46) {
		// a long group: "Shift the box, the seesaw and Ball 2 8 cm left" (by group, never "Shift 5 things")
		const c = changes[0]
		const R = riderMap(scene)
		if (c?.kind === "move" && changes.length === 1) {
			const full = cap(`${c.ids.length > 1 || (R.get(c.ids[0]) ?? []).length ? "shift" : "move"} ${movedNames(c.ids, scene, R)} ${dirWords(c.dx, c.dy)}`)
			const bare = full.replace(/ \(with [^)]*\)/g, "")
			label = full.length <= 46 ? full : bare.length <= 46 ? bare : clipLabel(bare, 46)
		} else label = clipLabel(label, 46)
	}
	return { say, did, label }
}
