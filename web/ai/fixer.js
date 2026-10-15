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
import { inspect, typeName, propSpec, isStaticItem } from "./solver.js"
import { checkGoals, goalItems, goalKind } from "./goals.js"

export const FIX_MS = 12000 // the search's time budget
export const FIX_RUNS = 320 // and its most engine runs (the page runs about 30 a second on four workers)
export const FIX_EXTRA_MS = 2500 // once a fix is found: how much longer it looks for a smaller one
const G = 9.81

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
const r5 = (v) => Math.round(v * 1e5) / 1e5
const lc = (s) => String(s).replace(/^./, (c) => c.toLowerCase())
const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase())
const andList = (l) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l.at(-1)}`)
const trimNum = (v, d) => String(Number(Number(v).toFixed(d)))
const CONTAINERS = ["box", "cup", "bucket", "basket"]

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
	return /\d/.test(n) || /^[A-Z][a-z]+ [A-Z]/.test(n) ? n : `the ${lc(n)}`
}
const propValue = (it, k) => (it?.props?.[k] !== undefined ? it.props[k] : propSpec(it?.type, k)?.default)

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
			if (!it || out.some((t) => goalKind(t.goal) === "falls" && goalItems(t.goal).includes(st.item))) continue
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
export function newHit(before, sim, scene, by = Infinity) {
	if (!before?.sim?.track || !sim?.track) return null
	const pairs = (run, sc) => {
		const of = new Map((run.doc?.solids ?? []).map((x) => [x.id, x.item]))
		const typeOf = new Map((sc?.items ?? []).map((i) => [i.id, i.type]))
		const out = new Map()
		for (const h of run.track.impacts ?? []) {
			const a = of.get(h.a)
			const b = of.get(h.b)
			if (!a || !b || a === b || ["table", "wall"].includes(typeOf.get(a)) || ["table", "wall"].includes(typeOf.get(b)) || (h.speed ?? 0) < 0.3) continue
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
	return `${n} ${plural ? "hit" : "hits"} ${theName(Y)}`
}
function inWords(g, sim, scene, before = null) {
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
		// the chain stopped before it: a hit the run before didn't have says why ("the dominoes now hit the box"), else the first row that
		// didn't all fall
		const inv0 = before?.sim ? involvement(before.sim, before.scene) : null
		const by = inv0 ? Math.max(inv0.get(g.item) ?? -Infinity, inv0.get(g.container) ?? -Infinity) : Infinity
		const hit = newHit(before, sim, scene, Number.isFinite(by) ? by + 0.05 : Infinity)
		if (hit) return `${hit}, so ${who} ${moved ? "is never launched" : "never moves"}`
		for (const st of sim?.summary?.stories ?? []) {
			let r = null
			if (/^\d+ of \d+ fall$/.test(st?.text ?? ""))
				try {
					;[r] = checkGoals([{ kind: "falls", items: [st.item], label: "x" }], sim)
				} catch {}
			if (r && r.of > 0 && r.fallen < r.of) return `${who} ${moved ? "is never launched" : "never moves"}: only ${r.fallen} of ${r.of} ${st.item && scene.items.find((i) => i.id === st.item)?.type === "domino-row" ? "dominoes" : "of its parts"} fall`
		}
		return moved ? `${who} is never launched` : `${who} never moves`
	}
	const C = containerGeo(scene, sim, g.container)
	const r = reachOf(sim, g.item)
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
	const k = goalKind(goal)
	if (result?.ok === true) return null
	if (k === "in") return inWords(goal, sim, scene, before)
	const items = goalItems(goal).map((id) => scene.items.find((i) => i.id === id)).filter(Boolean)
	const who = items.length === 1 ? theName(items[0]) : "they"
	if (k === "falls" && Number.isFinite(result?.fallen) && result.of > 0) return result.fallen === 0 ? `none of ${items.length === 1 && items[0].type === "domino-row" ? "the dominoes" : "them"} fall` : `only ${result.fallen} of ${result.of} ${items.length === 1 && items[0].type === "domino-row" ? "dominoes" : "of them"} fall`
	if (k === "hits") {
		const tgt = scene.items.find((i) => i.id === goal.target)
		return Number.isFinite(result?.t) ? `${who} touches ${theName(tgt)} only at ${result.t} s` : `${who} never touches ${theName(tgt)}`
	}
	if (k === "moves" && Number.isFinite(result?.moved_m)) return `${who} moves only ${fmtLen(result.moved_m)}`
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
	if (grow > 0.4) return
	table.props = { ...(table.props ?? {}), width: r5(w + 2 * grow) }
	for (const it of s.items) if (it.type === "wall" && it.props?.invisible_in_3d === true) it.x = r5(Number(it.x) + Math.sign(Number(it.x) - Number(table.x)) * grow)
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
		}
		// what rests on a thing whose shape or slope changed is put back on it, at the same resting distance as before
		if ((c.kind === "prop" || c.kind === "turn") && (R.get(c.id) ?? []).length) {
			try {
				const ins0 = inspect(scene)
				for (const rid of R.get(c.id)) {
					const it = byId.get(rid)
					if (!it) continue
					const g0 = ins0.gap(rid, c.id)
					const g1 = inspect(s).gap(rid, c.id)
					if (g0 !== null && g1 !== null && Math.abs(g1 - g0) > 1e-5) it.y = r5((Number(it.y) || 0) - (g1 - g0))
				}
			} catch {}
		}
	}
	widenTable(s, scene)
	return s
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
function knobCandidates({ scene, order, containers, touched, swapped, inAir, riders, restsOn, resolved = null, flex = false, before = null }) {
	const out = []
	const setBy = (id) => touched?.get?.(id) ?? null
	// (flex: a request that only states an outcome, "make it land in cup 3": what the edit set on the way may be adjusted further, never more
	// than a quarter of the way back)
	const FREE = { x: false, y: false, angle: false }
	const lock = (id) => (flex ? FREE : lockOf(touched, id))
	const propSet = (id, k) => {
		const s = setBy(id)
		return !flex && (s === "all" || !!s?.has?.(k))
	}
	const was = (id) => before?.items?.find?.((i) => i.id === id) ?? null
	/** May a knob move this much on what the edit set (key: "x", "y", "angle" or a prop)? Not back more than a quarter of the edit's own change. */
	const forward = (id, key, d) => {
		const s = setBy(id)
		if (!flex || !s) return true
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
		if (!isRider(id) && !perched) {
			if (!lock(id).x) for (const d of MOVE_STEPS) for (const s of [1, -1]) if (forward(id, "x", s * d)) push([{ kind: "move", ids: [id], dx: s * d, dy: 0 }], moveCost(d, 0) * m * carryK * slide, "x")
			if (air && !lock(id).y) for (const d of MOVE_STEPS) for (const s of [1, -1]) if (forward(id, "y", s * d)) push([{ kind: "move", ids: [id], dx: 0, dy: s * d }], moveCost(0, d) * m * carryK, "y")
		}
		// a thing waiting on a ramp (a car, a ball): started further up or down that ramp
		const sup = scene.items.find((i) => i.id === restsOn.get(id))
		if (perched && !it.held && sup?.type === "plank" && Math.abs(Number(sup.angle) || 0) > 0.5 && !lock(id).x)
			for (const d of MOVE_STEPS) for (const s of [1, -1]) if (forward(id, "x", s * d)) push([{ kind: "slide", id, on: sup.id, dx: s * d }], moveCost(d, 0) * m, "slide")
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
			"conveyor-belt": [["speed", "rel"]]
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
function followCandidates({ scene, before, order, riders, touched, inAir }) {
	if (!before?.scene) return []
	const A = new Map(before.scene.items.map((i) => [i.id, i]))
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
			if (moves.length > 1) out.push({ changes: moves, cost: costOf(moves) * 1.3, why: "follow-all" })
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
	const budgetMs = num(opts.budgetMs) ?? FIX_MS
	const maxRuns = num(opts.maxRuns) ?? FIX_RUNS
	const extraMs = num(opts.extraMs) ?? FIX_EXTRA_MS
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
	for (const t of live) {
		for (const id of goalItems(t.goal)) goalIds.add(id)
		if (t.goal.container) containers.add(t.goal.container)
		if (t.goal.target) containers.add(t.goal.target)
	}
	for (const id of [...goalIds, ...containers]) if (!inv.has(id)) inv.set(id, Infinity)
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
	// ---- the candidates, each with its cost; the targeted ones (intercept, follow) first
	const firstCands = []
	for (const t of live) {
		const g = t.goal
		if (goalKind(g) !== "in" || !g.container || !has.has(g.container)) continue
		const c = scene.items.find((i) => i.id === g.container)
		const lk = lockOf(ctx.touched, g.container)
		if ((lk.x && lk.y) || !CONTAINERS.includes(c?.type)) continue
		// (a container whose height the person set may still slide along the table; one they moved along, still be raised or lowered)
		firstCands.push(...interceptCandidates({ scene, sim, goal: g, air: inAir.has(g.container) && !lk.y }).filter((c) => !lk.x || Math.abs(c.changes[0].dx) < 1e-9))
	}
	// and the other way round: a thing dropped from where it is held is held over the container instead (its fall moves with it)
	for (const t of live) {
		const g = t.goal
		if (goalKind(g) !== "in" || !g.container || !g.item || !inAir.has(g.item)) continue
		if (!ctx.flex && lockOf(ctx.touched, g.item).x) continue
		firstCands.push(...aimCandidates({ scene, sim, goal: g }))
	}
	firstCands.push(...followCandidates({ scene, before: ctx.before, order, riders, touched: ctx.touched, inAir }))
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
	const blind = knobCandidates({ scene, order: near.slice(0, 9), containers, touched: ctx.touched, swapped: ctx.swapped, inAir, riders, restsOn, resolved: sim?.resolved, flex: !!ctx.flex, before: ctx.before?.scene })
	// (a change near the goal is the plain one, and the sturdy one: a nudge at the start of a long chain works by luck as much as by design)
	for (const c of blind) {
		const ids = c.changes.flatMap((x) => (x.kind === "move" ? x.ids : [x.id]))
		const rank = Math.max(0, ...ids.map((id) => near.indexOf(id)))
		c.cost *= 1 + 0.75 * rank
	}
	// (a knob on something that comes before everything the person changed is tried last, and only while nothing else has worked: "move the
	// first ball 1 cm" to win back a box moved at the far end reads as arbitrary, and it is luck more often than not)
	const firstTouched = Math.min(...[...(ctx.touched?.keys?.() ?? [])].map((id) => order.indexOf(id)).filter((i) => i >= 0))
	const early = (c) => Number.isFinite(firstTouched) && c.changes.every((x) => (x.kind === "move" ? x.ids : [x.id]).every((id) => order.indexOf(id) >= 0 && order.indexOf(id) < firstTouched))
	const keyOf = (c) => JSON.stringify(c.changes.map((x) => ({ ...x, follows: undefined, from: undefined })))
	const queue = []
	const seenK = new Set()
	const byCost = (a, b) => a.cost - b.cost
	// (the targeted ones, at most 16, cheapest first; the whole chain lined up again always gets its turn, after them)
	const first = firstCands.filter((c) => c.why !== "follow-all").sort((a, b) => (a.order ?? a.cost) - (b.order ?? b.cost)).slice(0, 16)
	for (const [list, phase] of [[[...first, ...firstCands.filter((c) => c.why === "follow-all").sort(byCost)], 0], [blind.filter((c) => !early(c)).sort(byCost), 1], [blind.filter(early).sort(byCost), 2]])
		for (const c of list) {
			const k = keyOf(c)
			if (seenK.has(k)) continue
			seenK.add(k)
			queue.push({ ...c, phase, key: k })
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
	let next = 0
	const done = () => signal?.aborted || now() > deadline || out.runs >= maxRuns
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
				if (!best || c.cost < best.cost) best = { ...c, scene: cand, sim: vs, results: vr }
			} else best = { ...c, scene: cand, sim: null, results: e.results }
			deadline = Math.min(deadline, now() + extraMs)
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
		if (!verify || (vr && vr.every((r) => r.ok === true) && (vs.warnings?.length ?? 0) <= (sim?.warnings?.length ?? 0))) best = { ...fallback, scene: fallback.cand, sim: vs, results: vr ?? live.map((t) => ({ label: t.label, ok: true })) }
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
			} catch (err) {
				if (err?.name === "AbortError" || signal?.aborted) throw aborted()
			}
	}
	out.ms = Math.round(now() - t0)
	return out
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
/** A short name for a chip: "the launcher" for "the spring launcher" (a proper name, "Ball 2", stays). */
const shortName = (it) => {
	const n = theName(it)
	return /^the \S+ \S+$/.test(n) ? `the ${n.split(" ").at(-1)}` : n
}
function changeWords(c, scene, before) {
	const item = (id) => scene.items.find((i) => i.id === id)
	if (c.kind === "move") {
		const R = riderMap(scene)
		const names = c.ids.map((id) => {
			const it = item(id)
			const rs = (R.get(id) ?? []).map(item)
			return `${theName(it)}${rs.length && c.ids.length === 1 ? ` (with ${groupNames(rs)} on it)` : ""}`
		})
		const riding = c.ids.flatMap((id) => R.get(id) ?? []).filter((id) => !c.ids.includes(id))
		const all = c.ids.length > 1 ? [...names, ...(riding.length ? [groupNames(riding.map(item))] : [])] : names
		const who = andList(all)
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
		return { say: `start ${w}`, did: `started ${w}`, label: `start ${shortName(it)} ${fmtLen(c.dx)} ${up ? "higher" : "lower"}` }
	}
	if (c.kind === "turn") {
		const it = item(c.id)
		const a = Number(it?.angle) || 0
		const steeper = Math.abs(a + c.d) > Math.abs(a)
		const w = `${theName(it)} ${trimNum(Math.abs(c.d), 1)}° ${steeper ? "steeper" : "flatter"} (${sig(Math.abs(a))}° → ${sig(Math.abs(a + c.d))}°)`
		return { say: `tilt ${w}`, did: `tilted ${w}` }
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
	// several things lined up with one: "shift the dominoes 7 cm left, and Ramp 2 and the box 10 cm left, to line up with the seesaw"
	if (changes.length > 1 && changes.every((c) => c.kind === "move" && c.follows && c.follows === changes[0].follows)) {
		const R = riderMap(scene)
		const item = (id) => scene.items.find((i) => i.id === id)
		const parts = changes.map((c) => `${andList(c.ids.map((id) => theName(item(id))))}${c.ids.some((id) => (R.get(id) ?? []).length) ? ` (with ${groupNames(c.ids.flatMap((id) => R.get(id) ?? []).map(item))})` : ""} ${dirWords(c.dx, c.dy)}`)
		const lead = theName(item(changes[0].follows))
		const n = new Set(changes.flatMap((c) => c.ids.flatMap((id) => [id, ...(R.get(id) ?? [])]))).size
		return { say: `shift ${parts.join(", and ")}, to line up with ${lead}`, did: `shifted ${parts.join(", and ")}, to line up with ${lead}`, label: `Line ${n} things up with ${lead}` }
	}
	const parts = changes.map((c) => changeWords(c, scene, before))
	const say = andList(parts.map((p) => p.say))
	const did = andList(parts.map((p) => p.did))
	let label = cap(parts.map((p) => p.label ?? p.say.replace(/ (to line up with|so it) .*$/, "").replace(/ \([^)]*\)/g, "")).join(", "))
	if (label.length > 46) {
		// a long group: "Shift 3 things 8 cm left"
		const c = changes[0]
		const R = riderMap(scene)
		const n = c?.kind === "move" ? new Set(c.ids.flatMap((id) => [id, ...(R.get(id) ?? [])])).size : 0
		label = c?.kind === "move" && changes.length === 1 ? (n > 1 ? `Shift ${n} things ${dirWords(c.dx, c.dy)}` : cap(`move ${theName(scene.items.find((i) => i.id === c.ids[0]))} ${dirWords(c.dx, c.dy)}`)) : label.slice(0, 45).replace(/\s+\S*$/, "") + "…"
	}
	return { say, did, label }
}
