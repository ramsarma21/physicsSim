// Deterministic application of an edit's patches: the change the patches ask for, and NOTHING else moves. Pure and synchronous; runs in the
// browser (web/ai/) and in node. The reference for ai/DESIGN.md §14.2 (3): drop-in for the edit path of web/ai/orchestrator.js (it replaces
// `applyPatches(basePlan, ...)` + `solve`).
//   import { applyEdit } from "./apply-edit.js"
//   const r = applyEdit({ scene, plan }, patches, { solve, planFromScene, isStaticItem, applyPatches, digestScene, layout }, { exact: true })
//   // r = {scene, plan, base, changes, skipped, touched, kept, reshaped, riders, reseated, followers, dependents, pinned, madeRoom,
//   //      shortfalls, overlaps, issues, patches} | {error, ...}
// deps: solve / planFromScene / isStaticItem (web/ai/solver.js), applyPatches / digestScene (web/ai/orchestrator.js), layout (web/sim/index.js:
// the overlap warnings of a scene, {warnings}).
// What it adds to applyPatches + solve (ai/experiments/edit measured v3 of this module as arm n7; this is v4, the repair of 2026-10-15 night):
//  0. the base plan is `base.plan` only when solving it rebuilds the scene on screen (an AI-built scene the tuner or the user changed since is
//     not its plan's result); otherwise the scene read as a plan (planFromScene), keeping the plan's goals, stages, notes and knobs;
//  1. every item the patches do not touch is pinned to its exact pose WITH the scene's own props (a leaning plank's length is the solver's,
//     not the plan's: pinned without it, it was solved as a 1 m plank and pushed its neighbours) and put back byte for byte after the solve;
//     an item touched without a change to its shape or place (a rename, a material, a mass) is pinned too and comes back as it was with only
//     those fields changed;
//  2. a swapped or resized thing (its outline changed) keeps its seat: on what it rested on, at the same x; held in the air, its lowest point;
//  3. what rests on a moved thing (or is held at most 6 cm above it) goes with it rigidly, by the moved thing's FINAL dx/dy (its seat is kept);
//     what rests on a reshaped or re-placed thing is re-seated on it (never a leaning or tilted static thing: it keeps its pose); what refers
//     to such a thing in its plan place (rests on it, beside it, leans on it) is solved again;
//  4. the table, the stage, the safety walls and the scene's timing stay as they were unless a patch changes them;
//  5. a thing the solver put somewhere else than its patch asked (to clear a neighbour, or the whole layout shifted to stay on the table) is
//     a `shortfall`: with `exact` (the default) it is put where it was asked and the overlap is returned (`overlaps`: the caller's ONE repair
//     turn asks the model to make it fit or move the neighbour the least, §14.2 (4)); with `exact: false` it stays where the solver put it and
//     `madeRoom` says so ("Seesaw moved only 6.9 cm left (not 10.0 cm): to clear Dominoes"), never hidden;
//  6. a changed or new thing that starts inside a safety wall is slid off it (`madeRoom`); new start-up overlaps are returned, not hidden;
//  7. a changed thing's JSON changes only where the edit changed it: the props the solver leaves out as defaults keep the scene's own value.

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const safety = (i) => i?.type === "wall" && i.props?.invisible_in_3d === true
const real = (i) => !!i && i.type !== "table" && !safety(i)
const r6 = (v) => Math.round(v * 1e6) / 1e6
const fmt = (m) => (Math.abs(m) >= 1 ? `${Math.abs(m).toFixed(2)} m` : `${(Math.abs(m) * 100).toFixed(1)} cm`)
const idsOf = (p) => (Array.isArray(p?.ids) ? p.ids : p?.id !== undefined ? [p.id] : [])
const CONTAINERS = new Set(["box", "cup", "bucket", "basket", "plastic-cup", "glass-jar"])
// (the props whose change re-seats a thing; another prop that changes its outline, a pendulum's start_angle, leaves its anchor where it is)
const SIZE_KEYS = new Set(["diameter", "width", "height", "length", "thickness", "wall", "depth", "count", "first_height", "growth", "spacing", "radius", "size", "scale", "bob_diameter"])
const TOL = 0.001 // (m) a thing more than 1 mm from where its patch asked is a shortfall
const BOX_TOL = 1e-4 // (m) an outline that moved less than this did not change

function expand(patches) {
	const out = []
	for (const p of Array.isArray(patches) ? patches : []) {
		if (!isObj(p)) continue
		if (Array.isArray(p.ids) && p.id === undefined) for (const id of p.ids) out.push({ ...p, ids: undefined, id })
		else out.push(p)
	}
	return out
}
const sortedJson = (o) => JSON.stringify(o, (k, v) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : typeof v === "number" ? r6(v) : v))

/**
 * Does solving `plan` rebuild `scene` (same items, types, props, held and fixed; poses within 1.5 mm and 0.1°), up to the one shift along
 * the table the solver makes to stand a layout on it ("Everything was moved 0.08 m right")? -> that shift (m; 0 when none), or null when it
 * does not. The edit's base plan must rebuild the scene on screen (§14.2 (1), (3)): an AI-built scene the tuner or the user changed since is
 * not its plan's result.
 */
export function rebuilds(plan, scene, solve) {
	return rebuildInfo(plan, scene, solve)?.shift ?? null
}
/** rebuilds(), with what the solver added on its own (a stand under a funnel in mid-air: {id, for}). */
function rebuildInfo(plan, scene, solve) {
	let s
	let supports
	try {
		const out = solve(clone(plan), { noShift: true })
		s = out.scene
		supports = Array.isArray(out.supports) ? out.supports : []
	} catch {
		return null
	}
	const a = new Map((scene?.items ?? []).filter(real).map((i) => [i.id, i]))
	const b = new Map((s?.items ?? []).filter(real).map((i) => [i.id, i]))
	if (!a.size || a.size !== b.size) return null
	let shift = null
	for (const [id, x] of a) {
		const y = b.get(id)
		if (!y || y.type !== x.type) return null
		const dx = (Number(x.x) || 0) - (Number(y.x) || 0)
		shift ??= dx
		if (Math.abs(dx - shift) > 0.0015 || Math.abs((Number(x.y) || 0) - (Number(y.y) || 0)) > 0.0015 || Math.abs((Number(x.angle) || 0) - (Number(y.angle) || 0)) > 0.1) return null
		if (sortedJson(x.props ?? {}) !== sortedJson(y.props ?? {}) || !!x.held !== !!y.held || !!x.fixed !== !!y.fixed) return null
	}
	return { shift: Math.abs(shift) < 1e-6 ? 0 : r6(shift), supports }
}

/** The plan moved `dx` along the table (its places' x, the ends of its leans, its knobs on x): the plan in the scene's own coordinates. */
function shiftPlan(plan, dx) {
	if (!dx) return plan
	const sx = (o, k) => {
		if (isObj(o) && num(o[k]) !== null) o[k] = r6(o[k] + dx)
	}
	for (const it of plan.items ?? []) {
		if (!isObj(it?.place)) continue
		sx(it.place, "x")
		if (isObj(it.place.lean)) (sx(it.place.lean.from, "x"), sx(it.place.lean.to, "x"))
	}
	const knobs = (ks) => {
		for (const k of Array.isArray(ks) ? ks : []) if (isObj(k) && typeof k.param === "string" && /(^|\.)x$/.test(k.param)) for (const f of ["min", "max", "value", "from", "to"]) sx(k, f)
	}
	knobs(plan.tune)
	for (const st of Array.isArray(plan.stages) ? plan.stages : []) knobs(st?.tune)
	return plan
}

/** The scene read as a plan (exact poses), with the plan's own scene-level fields (goals, stages, notes, ...) and each item's `why`. */
function scenePlanWith(pf, plan) {
	if (!isObj(plan)) return pf
	const out = { ...pf }
	for (const k of ["title", "goals", "stages", "notes", "assumptions", "missing", "covers", "differences"]) if (plan[k] !== undefined) out[k] = clone(plan[k])
	const ids = new Set(pf.items.map((i) => i.id))
	// a knob on a plan place that the scene's own reading does not have ("lean.to.x") cannot be turned any more
	if (Array.isArray(plan.tune)) out.tune = plan.tune.filter((k) => isObj(k) && ids.has(k.id) && typeof k.param === "string" && !k.param.includes(".")).map(clone)
	for (const it of out.items) {
		const w = plan.items?.find((x) => x?.id === it.id)?.why
		if (w !== undefined && it.why === undefined) it.why = w
	}
	return out
}

/** A scene item with only what changed between two plan readings of it applied (name, held, fixed, changed props): byte-minimal. */
function overlay(sceneItem, p0, p1) {
	const out = clone(sceneItem)
	if (!p0 || !p1) return out
	if (p1.type && p1.type !== p0.type) out.type = p1.type
	if (p1.name !== p0.name) {
		if (typeof p1.name === "string" && p1.name) out.name = p1.name
		else delete out.name
	}
	for (const k of ["held", "fixed"])
		if (!!p1[k] !== !!p0[k]) {
			if (p1[k]) out[k] = true
			else delete out[k]
		}
	const a = isObj(p0.props) ? p0.props : {}
	const b = isObj(p1.props) ? p1.props : {}
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
		if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue
		out.props = isObj(out.props) ? out.props : {}
		if (b[k] === undefined || b[k] === null) delete out.props[k]
		else out.props[k] = clone(b[k])
	}
	return out
}

/**
 * A changed thing as the solver placed it, written the way the scene wrote it: a prop the solver left out because it is the type's default
 * (scene items store only what differs from the defaults) comes back with the scene's own value when the plan did not change it, in the
 * scene's key order; an angle of 0 the scene did not write stays unwritten. The same physics, and the item's JSON changes only where the
 * edit changed it (a moved row of dominoes kept "count 7" and "spacing 0.568" instead of losing them).
 */
function minimal(s0, i, p0, p1) {
	if (!s0 || !i || s0.type !== i.type) return i
	const a = isObj(p0?.props) ? p0.props : {}
	const b = isObj(p1?.props) ? p1.props : {}
	const sp = isObj(s0.props) ? s0.props : {}
	const ip = isObj(i.props) ? i.props : {}
	const props = {}
	for (const k of Object.keys(sp)) {
		if (k in ip) props[k] = ip[k]
		else if (JSON.stringify(a[k]) === JSON.stringify(b[k])) props[k] = clone(sp[k])
	}
	for (const k of Object.keys(ip)) if (!(k in props)) props[k] = ip[k]
	const src = { ...i }
	if (Object.keys(props).length || s0.props !== undefined) src.props = props
	else delete src.props
	if (s0.angle === undefined && Number(src.angle) === 0) delete src.angle
	const out = {}
	for (const k of Object.keys(s0)) if (k in src) out[k] = src[k]
	for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k]
	return out
}

export function applyEdit(base, patchesIn, deps, { exact = true } = {}) {
	const { solve, planFromScene, isStaticItem, applyPatches, digestScene, layout } = deps
	const dynamic = (it) => !!it && !isStaticItem(it.type, it.fixed === true)
	const scene0 = base.scene
	const top = Number(scene0.items.find((i) => i.type === "table")?.y) || 0
	const byId0 = new Map(scene0.items.map((i) => [i.id, i]))
	const d0 = digestScene(scene0)
	const row0 = new Map(d0.items.map((r) => [r.id, r]))
	const restsOn = (id) => {
		const r = row0.get(id)?.rests_on
		return r && !/^(nothing|held)/.test(r) ? r : null
	}
	// ---- 0. the base plan: the plan only when it rebuilds the scene on screen
	// (in the scene's own coordinates: a plan whose layout the solver shifted to stand on the table is shifted the same, and every solve
	// here is {noShift: true}, so nothing moves along the table that the edit did not move)
	const info = isObj(base.plan) && Array.isArray(base.plan.items) ? rebuildInfo(base.plan, scene0, solve) : null
	const usePlan = info !== null
	const plan0 = usePlan ? shiftPlan(clone(base.plan), info.shift) : scenePlanWith(planFromScene(scene0), base.plan)
	// what the solver added to the plan's scene on its own (stands under a thing in mid-air): pinned with what they hold up, or added again
	// by the solver when that thing is solved again
	const standFor = new Map((info?.supports ?? []).filter((x) => isObj(x) && typeof x.id === "string").map((x) => [x.id, x.for]))
	const planItem = (plan, id) => plan.items.find((i) => i.id === id)
	let patches = expand(patchesIn)

	// ---- what the patches do to each item (a dry run of the app's own patch semantics)
	const dry = applyPatches(plan0, patches, scene0).plan
	const idsDry = new Set(dry.items.map((i) => i.id))
	const patchedIds = new Set(patches.flatMap(idsOf))
	const added = new Set(dry.items.filter((i) => !byId0.has(i.id) || !planItem(plan0, i.id)).map((i) => i.id))
	const removed = new Set([...byId0.values()].filter((i) => real(i) && planItem(plan0, i.id) && !idsDry.has(i.id)).map((i) => i.id))
	const posed = new Set(patches.filter((p) => ["set_place", "place"].includes(p.op) || (p.op === "move" && [p.x, p.y_m, p.dx, p.dy, p.angle_deg].some((v) => num(v) !== null))).flatMap(idsOf))
	// reshaped: a new type, or props that change its outline (a material, a mass or a colour number do not)
	const reshaped = new Set()
	const probe = clone(scene0)
	const probed = []
	for (const it1 of dry.items) {
		const p0 = planItem(plan0, it1.id)
		const s = probe.items.find((i) => i.id === it1.id)
		if (!p0 || !s || added.has(it1.id)) continue
		if (it1.type !== p0.type) {
			reshaped.add(it1.id)
			continue
		}
		if (sortedJson(it1.props ?? {}) === sortedJson(p0.props ?? {})) continue
		Object.assign(s, overlay(s, p0, it1))
		probed.push(it1.id)
	}
	if (probed.length) {
		let rows = null
		try {
			rows = new Map(digestScene(probe).items.map((r) => [r.id, r]))
		} catch {}
		for (const id of probed) {
			const a = row0.get(id)?.box
			const b = rows?.get(id)?.box
			if (!a || !b || ["x0", "x1", "y0", "y1"].some((k) => Math.abs(a[k] - b[k]) > BOX_TOL)) reshaped.add(id)
		}
	}
	const kept = new Set([...patchedIds].filter((id) => byId0.has(id) && !posed.has(id) && !reshaped.has(id) && !added.has(id) && !removed.has(id)))

	// ---- 2. swaps and resizes keep their seat
	const resized = (id) => patches.some((p) => idsOf(p).includes(id) && (p.op === "replace_type" || (["set_props", "props"].includes(p.op) && Object.keys(p.props ?? p.set ?? {}).some((k) => SIZE_KEYS.has(k)))))
	const extra = []
	for (const id of reshaped) {
		if (posed.has(id) || !resized(id)) continue
		const it0 = byId0.get(id)
		const pi = planItem(plan0, id)
		const row = row0.get(id)
		if (!it0 || !pi || !row?.box) continue
		const on = restsOn(id)
		const pl = pi.place ?? {}
		if (on) {
			if (pl.on === "air" || pl.keep) {
				const sup = row0.get(on)
				const inside = on !== "table" && CONTAINERS.has(byId0.get(on)?.type) && sup?.box && row.box.y0 < sup.box.y1 - 0.003
				extra.push({ op: "set_place", id, place: inside ? { on, inside: on, x: it0.x } : { on, x: it0.x } })
			}
		} else if ((pl.on === "air" || !pl.on) && dynamic(it0)) {
			// held or hanging in the air (a dynamic thing): its lowest point stays where it was
			extra.push({ op: "set_place", id, place: { on: "air", x: it0.x, bottom_m: r6(row.box.y0 - top), angle_deg: Number(it0.angle) || 0 } })
		}
	}
	patches = [...patches, ...extra]

	// ---- 3. what rests on (or hovers ≤ 6 cm above) a moved thing rides with it
	const support = new Map() // id -> what it rests on, or the thing it hovers just above
	for (const r of d0.items) {
		if (!real(byId0.get(r.id))) continue
		const on = restsOn(r.id)
		if (on) {
			support.set(r.id, on)
			continue
		}
		if (!r.box) continue
		// (just above it: its middle is over the thing, not only an edge of its outline; a pendulum's swing outline that reaches 7 mm over
		// the first domino is not held above the row, and moving the row must not move the pendulum)
		const mid = (r.box.x0 + r.box.x1) / 2
		let best = null
		for (const o of d0.items) {
			if (o.id === r.id || !o.box || !real(byId0.get(o.id))) continue
			if (mid < o.box.x0 || mid > o.box.x1 || o.box.y1 > r.box.y0 + 1e-4) continue
			if (!best || o.box.y1 > best.box.y1) best = o
		}
		if (best && r.box.y0 - best.box.y1 <= 0.06 && dynamic(byId0.get(r.id))) support.set(r.id, best.id)
	}
	// the asked displacement of each moved thing (move dx/dy or x/y_m; a height change of a thing that rests on something is not a move)
	const moved = new Map()
	for (const p of patches) {
		if (p.op !== "move" || ![p.x, p.y_m, p.dx, p.dy].some((v) => num(v) !== null)) continue
		for (const id of idsOf(p)) {
			const it0 = byId0.get(id)
			if (!it0) continue
			const m = moved.get(id) ?? { x: Number(it0.x) || 0, y: Number(it0.y) || 0 }
			const pl = planItem(plan0, id)?.place ?? {}
			const air = pl.on === "air" || !pl.on || pl.keep
			if (num(p.x) !== null) m.x = p.x
			if (num(p.dx) !== null) m.x += p.dx
			if (num(p.y_m) !== null) m.y = top + p.y_m
			if (num(p.dy) !== null && air) m.y += p.dy
			moved.set(id, m)
		}
	}
	const delta = (id) => {
		const m = moved.get(id)
		const it0 = byId0.get(id)
		return m && it0 ? { dx: m.x - (Number(it0.x) || 0), dy: m.y - (Number(it0.y) || 0) } : { dx: 0, dy: 0 }
	}
	const riders = new Map() // rider -> the thing it rides on
	const rideDelta = new Map([...moved.keys()].map((id) => [id, delta(id)]))
	for (let grew = true; grew; ) {
		grew = false
		for (const [id, on] of support) {
			if (riders.has(id) || patchedIds.has(id) || removed.has(id) || !rideDelta.has(on)) continue
			const pi = planItem(plan0, id)
			const it0 = byId0.get(id)
			if (!pi || !it0) continue
			const dd = rideDelta.get(on)
			const pl = pi.place ?? {}
			// (where it starts for the solve; its final pose is set rigidly from what it rides on, after the solve)
			if (pl.on === "air" || pl.keep) patches.push({ op: "set_place", id, place: { ...pl, x: r6((num(pl.x) ?? it0.x) + dd.dx), ...(num(pl.y_m) !== null ? { y_m: r6(pl.y_m + dd.dy) } : {}) } })
			else if (num(pl.x) !== null) patches.push({ op: "set_place", id, place: { ...pl, x: r6(pl.x + dd.dx) } })
			rideDelta.set(id, dd)
			riders.set(id, on)
			grew = true
		}
	}

	// ---- the app's own patch semantics
	const r = applyPatches(plan0, patches, scene0)
	const plan1 = r.plan
	const ids1 = new Set(plan1.items.map((i) => i.id))
	// what rests on a reshaped or re-placed (not moved) thing is re-seated on it (a ball on a seesaw whose tilt changed); a leaning or tilted
	// static thing keeps its pose (seated flat it slid 32 cm)
	const reseated = new Set()
	const reshapedOrPlaced = new Set([...reshaped, ...[...posed].filter((id) => !moved.has(id))])
	for (const [id, on] of support) {
		if (!restsOn(id) || patchedIds.has(id) || riders.has(id) || !reshapedOrPlaced.has(on) || !ids1.has(on)) continue
		const pi = planItem(plan1, id)
		const it0 = byId0.get(id)
		if (!pi || !it0) continue
		const pl = pi.place ?? {}
		if (pl.lean || (!dynamic(it0) && Math.abs(Number(it0.angle) || 0) > 0.05)) continue
		if (pl.on === "air" || pl.keep) pi.place = { on, x: it0.x }
		reseated.add(id)
	}
	const spaceChanged = new Set([...posed, ...reshaped, ...added, ...removed, ...riders.keys(), ...reseated])
	// what refers to such a thing in its plan place (rests on it, beside it, leans on it) is solved again with it
	const refsOf = (pl) => (isObj(pl) ? [pl.on, pl.inside, pl.left_of?.id ?? pl.left_of, pl.right_of?.id ?? pl.right_of, pl.lean?.from?.on, pl.lean?.to?.on].filter((x) => typeof x === "string") : [])
	const dependents = new Set()
	for (let grew = true; grew; ) {
		grew = false
		for (const it of plan1.items) {
			if (spaceChanged.has(it.id) || kept.has(it.id) || dependents.has(it.id)) continue
			const on = restsOn(it.id)
			if (refsOf(it.place).some((x) => spaceChanged.has(x) || dependents.has(x)) || (on && removed.has(on))) {
				dependents.add(it.id)
				grew = true
			}
		}
	}
	const free = new Set([...posed, ...reshaped, ...added, ...riders.keys(), ...reseated, ...dependents].filter((id) => ids1.has(id)))
	// where each changed thing was asked to be, in the scene's coordinates (null: its patch leaves that to the solver, e.g. a lean or "right of")
	const asked = new Map()
	for (const p of patches) {
		if (!["move", "set_place", "place"].includes(p.op)) continue
		for (const id of idsOf(p)) {
			const it0 = byId0.get(id)
			if (!it0 || riders.has(id)) continue
			const x0 = Number(it0.x) || 0
			const y0 = Number(it0.y) || 0
			let a = asked.has(id) ? asked.get(id) : { x: x0, y: null, seat: extra.some((e) => e.id === id) }
			if (p.op === "move") {
				if (!a) continue
				a.seat = false
				const pl = planItem(plan0, id)?.place ?? {}
				const air = pl.on === "air" || !pl.on || pl.keep
				if (num(p.x) !== null) a.x = p.x
				if (num(p.dx) !== null) a.x += p.dx
				if (num(p.y_m) !== null) a.y = top + p.y_m
				if (num(p.dy) !== null && air) a.y = (a.y ?? y0) + p.dy
				if (air && a.y === null && pl.keep) a.y = y0
			} else {
				const pl = p.place
				a = isObj(pl) && !pl.lean && !pl.left_of && !pl.right_of && num(pl.x) !== null ? { x: pl.x, y: (pl.on === "air" || !pl.on) && num(pl.y_m ?? pl.y) !== null ? top + num(pl.y_m ?? pl.y) : null, seat: extra.includes(p) } : null
			}
			asked.set(id, a)
		}
	}
	for (const id of [...reshaped, ...reseated]) {
		if (asked.has(id) || !ids1.has(id)) continue
		const pl = planItem(plan1, id)?.place ?? {}
		asked.set(id, pl.lean || pl.left_of || pl.right_of ? null : { x: Number(byId0.get(id)?.x) || 0, y: null, seat: true })
	}

	for (const s of scene0.items) {
		if (!real(s) || planItem(plan0, s.id) || added.has(s.id) || ids1.has(s.id)) continue
		const holds = standFor.get(s.id)
		if (holds && (free.has(holds) || !ids1.has(holds))) continue // (the solver stands the moved or changed thing up again; a removed thing's stands go with it)
		plan1.items.push({ id: s.id, type: s.type, ...(s.name ? { name: s.name } : {}), props: clone(s.props ?? {}), ...(s.held ? { held: true } : {}), ...(s.fixed ? { fixed: true } : {}) })
	}
	// ---- 1. pin the rest, at its exact pose and with the scene's own props (what the solver derived, e.g. a leaning plank's length)
	const pinned = new Set()
	for (const it of plan1.items) {
		if (free.has(it.id)) continue
		const s = byId0.get(it.id)
		if (!s) continue
		it.place = { on: "air", x: Number(s.x) || 0, y_m: r6((Number(s.y) || 0) - top), angle_deg: Number(s.angle) || 0, keep: true }
		const p0 = planItem(plan0, it.id)
		if (kept.has(it.id)) it.props = overlay(s, p0, it).props ?? {}
		else if (isObj(s.props)) it.props = { ...(it.props ?? {}), ...clone(s.props) }
		if (!kept.has(it.id)) pinned.add(it.id)
	}
	plan1.stage = clone(scene0.stage)
	let solved
	try {
		solved = solve(plan1, { noShift: true })
	} catch (e) {
		return { error: `the solver could not place it: ${e.message}`, changes: r.changes, skipped: r.skipped, plan: plan1 }
	}
	const solvedById = new Map((solved.scene?.items ?? []).map((i) => [i.id, i]))
	const issues0 = solved.issues ?? []
	const whyMoved = (id) => {
		const own = issues0.find((i) => i.item === id && i.level === "info" && /moved|raised|kept_on/.test(i.code ?? ""))
		const all = issues0.find((i) => i.code === "shifted")
		const m = /\bto (clear|stand) .*$/.exec(own?.text ?? "") ?? /\bto (clear|stand) .*$/.exec(all?.text ?? "")
		return m ? m[0] : null
	}

	// ---- 5. where each solved thing is against where its patch asked it to be
	// (the solver could not place a changed thing at all, e.g. a leaning plank moved off the book its end rests on: said, never "corrected")
	const errors = issues0.filter((i) => i.level === "error" && (free.has(i.item) || kept.has(i.item)))
	const failed = new Set(errors.map((i) => i.item))
	const shortfalls = []
	const nudges = new Map() // (exact: the last few µm of the patch semantics' rounding to 0.1 mm, put right too; never reported)
	for (const [id, a] of asked) {
		const s = solvedById.get(id)
		const it0 = byId0.get(id)
		if (!a || !s || !it0 || !free.has(id) || failed.has(id)) continue
		// (a swapped, resized or re-seated thing that the solver slid along its support so it stands fully on it keeps that: its seat is
		// "on that support", not "at that x"; one it pushed aside to clear a neighbour is a shortfall)
		if (a.seat && issues0.some((i) => i.item === id && i.code === "kept_on")) continue
		const cx = r6(a.x - (Number(s.x) || 0))
		const cy = a.y !== null ? r6(a.y - (Number(s.y) || 0)) : 0
		if (Math.abs(cx) <= TOL && Math.abs(cy) <= TOL) {
			if (!a.seat && (Math.abs(cx) > 1e-7 || Math.abs(cy) > 1e-7)) nudges.set(id, { dx: cx, dy: cy })
			continue
		}
		shortfalls.push({
			id,
			name: it0.name ?? planItem(plan1, id)?.name ?? id,
			asked: { dx: r6(a.x - (Number(it0.x) || 0)), dy: a.y !== null ? r6(a.y - (Number(it0.y) || 0)) : 0 },
			solver: { dx: r6((Number(s.x) || 0) - (Number(it0.x) || 0)), dy: r6((Number(s.y) || 0) - (Number(it0.y) || 0)) },
			correction: { dx: cx, dy: cy },
			why: whyMoved(id)
		})
	}
	const corr = new Map(exact ? [...nudges, ...shortfalls.map((f) => [f.id, f.correction])] : [])

	const setScene = patches.filter((p) => p.op === "set_scene")
	const order = new Map(scene0.items.map((i, k) => [i.id, k]))
	const compose = (letGo = new Set()) => {
		const out = clone(solved.scene)
		out.id = scene0.id
		out.name = scene0.name
		out.stage = clone(scene0.stage)
		out.seconds = setScene.some((p) => p.seconds !== undefined) ? out.seconds : scene0.seconds
		out.release = setScene.some((p) => p.release !== undefined) ? out.release : scene0.release
		const keepBase = scene0.items.filter((i) => !real(i)).map(clone)
		const items = new Map()
		for (const i of out.items.filter(real)) {
			const s0 = byId0.get(i.id)
			if (s0 && pinned.has(i.id) && !letGo.has(i.id)) items.set(i.id, clone(s0))
			else if (s0 && kept.has(i.id)) items.set(i.id, overlay(s0, planItem(plan0, i.id), planItem(plan1, i.id)))
			else {
				const c = corr.get(i.id)
				if (c) {
					i.x = r6((Number(i.x) || 0) + c.dx)
					i.y = r6((Number(i.y) || 0) + c.dy)
				}
				items.set(i.id, minimal(s0, i, planItem(plan0, i.id), planItem(plan1, i.id)))
			}
		}
		// (an untouched thing the solver dropped is still there, as it was)
		for (const s0 of scene0.items) if (real(s0) && !items.has(s0.id) && (pinned.has(s0.id) || kept.has(s0.id))) items.set(s0.id, kept.has(s0.id) ? overlay(s0, planItem(plan0, s0.id), planItem(plan1, s0.id)) : clone(s0))
		// riders: rigidly with what they ride on, by its final displacement (their seat on it is kept exactly)
		for (const [id, on] of riders) {
			const s0 = byId0.get(id)
			const sup0 = byId0.get(on)
			const sup = items.get(on)
			if (!s0 || !sup0 || !sup || !items.has(id)) continue
			const done = clone(s0)
			done.x = r6((Number(s0.x) || 0) + (Number(sup.x) || 0) - (Number(sup0.x) || 0))
			done.y = r6((Number(s0.y) || 0) + (Number(sup.y) || 0) - (Number(sup0.y) || 0))
			items.set(id, done)
		}
		out.items = [...keepBase, ...items.values()].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
		return out
	}
	let scene1 = compose()
	// the plan says where things are now: a rider's place, and (exact: false) where the solver put a shortfall
	for (const [id] of riders) {
		const pi = planItem(plan1, id)
		const s = scene1.items.find((i) => i.id === id)
		if (!pi || !s) continue
		const pl = pi.place ?? {}
		pi.place = pl.on === "air" || !pl.on || pl.keep ? { on: "air", x: s.x, y_m: r6(s.y - top), angle_deg: Number(s.angle) || 0, keep: true } : { ...pl, x: s.x }
	}
	const madeRoom = []
	if (!exact)
		for (const f of shortfalls) {
			const pi = planItem(plan1, f.id)
			if (pi?.place && num(pi.place.x) !== null) pi.place.x = r6(pi.place.x - f.correction.dx)
			if (pi?.place && num(pi.place.y_m) !== null && (pi.place.on === "air" || !pi.place.on)) pi.place.y_m = r6(pi.place.y_m - f.correction.dy)
			const h = (d) => `${fmt(d)} ${d >= 0 ? "right" : "left"}`
			const asked = Math.abs(f.asked.dx) > TOL
			const up = Math.abs(f.solver.dy) > 0.005 ? ` and ${fmt(f.solver.dy)} ${f.solver.dy > 0 ? "up" : "down"}` : ""
			const why = f.why ?? "where the solver found room for it"
			madeRoom.push(asked ? `${f.name} moved ${Math.abs(f.solver.dx) > TOL ? `only ${h(f.solver.dx)}` : "not at all"}${up} (not ${h(f.asked.dx)}): ${why}` : `${f.name} moved ${h(f.solver.dx)}${up}, ${why}`)
		}
	const before = new Set((layout(scene0).warnings ?? []).map((w) => w.text))
	const fresh = (sc) => (layout(sc).warnings ?? []).filter((w) => !before.has(w.text))
	// ---- 5a. a pinned neighbour that the change now overlaps: the solver's place for it, when that clears more
	const w1 = fresh(scene1)
	const letGo = new Set()
	for (const w of w1) for (const id of w.items ?? []) if (pinned.has(id) && (w.items ?? []).some((o) => free.has(o))) letGo.add(id)
	if (letGo.size) {
		const s2 = compose(letGo)
		if (fresh(s2).length < w1.length) {
			scene1 = s2
			for (const id of letGo) {
				const a = byId0.get(id)
				const b = s2.items.find((i) => i.id === id)
				const dx = (b?.x ?? 0) - (a?.x ?? 0)
				const dy = (b?.y ?? 0) - (a?.y ?? 0)
				if (a && b && (Math.abs(dx) > 5e-4 || Math.abs(dy) > 5e-4)) madeRoom.push(`${a.name ?? id} moved ${fmt(dx)} ${dx >= 0 ? "right" : "left"}${Math.abs(dy) > 0.001 ? ` and ${fmt(dy)} ${dy > 0 ? "up" : "down"}` : ""} to make room`)
			}
		}
	}
	// ---- 6. a changed or new thing inside a safety wall is slid off it
	const walls = scene1.items.filter(safety)
	const ww = fresh(scene1).filter((w) => (w.items ?? []).some((id) => walls.some((x) => x.id === id)))
	if (ww.length) {
		const d1 = digestScene(scene1)
		const boxOf = new Map(d1.items.map((q) => [q.id, q.box]))
		for (const w of ww) {
			const wall = walls.find((x) => (w.items ?? []).includes(x.id))
			const id = (w.items ?? []).find((x) => x !== wall?.id)
			const it = scene1.items.find((i) => i.id === id)
			const b = boxOf.get(id)
			const wb = boxOf.get(wall?.id)
			if (!it || !b || !wb || !free.has(id)) continue
			const tableX = Number(scene1.items.find((i) => i.type === "table")?.x ?? 1.3)
			const left = (wb.x0 + wb.x1) / 2 < tableX // (the left wall: slide it right)
			const shift = left ? wb.x1 - b.x0 + 0.003 : -(b.x1 - wb.x0 + 0.003)
			it.x = r6((it.x ?? 0) + shift)
			for (const [rid, on] of riders) if (on === id) for (const q of scene1.items) if (q.id === rid) q.x = r6(q.x + shift)
			madeRoom.push(`${it.name ?? id} slid ${fmt(shift)} off the ${left ? "left" : "right"} safety wall`)
		}
	}
	// ---- what the caller must fix or say: new start-up overlaps, and a changed thing standing past the table's end (a row of 14 dominoes
	// kept at its x ran 54 cm off the table: the solver had hidden it by shifting the row 60 cm, into the pendulum's swing)
	const offTable = (sc) => {
		const out = []
		let rows
		try {
			rows = digestScene(sc).items
		} catch {
			return out
		}
		const tb = rows.find((q) => q.type === "table")?.box
		if (!tb) return out
		for (const q of rows) {
			if (!q.box || !(free.has(q.id) || added.has(q.id)) || q.box.y0 > tb.y1 + 0.01) continue
			const was = row0.get(q.id)?.box
			const over = Math.max(tb.x0 - q.box.x0, q.box.x1 - tb.x1)
			const overWas = was ? Math.max(tb.x0 - was.x0, was.x1 - tb.x1) : -Infinity
			if (over > 0.01 && over > overWas + 0.005) out.push({ items: [q.id], text: `${q.name ?? q.id} would stand ${fmt(over)} past the table's ${tb.x0 - q.box.x0 > q.box.x1 - tb.x1 ? "left" : "right"} end` })
		}
		return out
	}
	const corrected = new Set(corr.keys())
	const issues = issues0.filter((i) => (free.has(i.item) || kept.has(i.item)) && (i.level !== "info" || (!exact && /moved|raised|kept_on/.test(i.code ?? "") && !corrected.has(i.item))))
	const followers = [...riders.keys(), ...reseated]
	const touched = [...new Set([...patchedIds, ...added, ...followers, ...removed])]
	return { scene: scene1, plan: plan1, base: usePlan ? "plan" : "scene", changes: r.changes, skipped: r.skipped, touched, kept: [...kept], reshaped: [...reshaped], riders: [...riders.keys()], reseated: [...reseated], followers, dependents: [...dependents], pinned: [...pinned], madeRoom, shortfalls, overlaps: [...fresh(scene1), ...offTable(scene1)], errors, issues, patches }
}
