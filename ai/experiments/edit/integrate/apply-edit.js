// Deterministic application of an edit's patches: the change the patches ask for, and NOTHING else moves. Pure and synchronous; runs in the
// browser (web/ai/) and in node. Drop-in for the edit path of web/ai/orchestrator.js (it replaces `applyPatches(basePlan, ...)` + `solve`).
//   import { applyEdit } from "./apply-edit.js"
//   const r = applyEdit({ scene, plan }, patches, { solve, planFromScene, isStaticItem, applyPatches, digestScene, layout })
//   // r = {scene, plan, changes, skipped, touched, followers, dependents, pinned, madeRoom, overlaps, issues, patches} | {error, ...}
// deps: solve / planFromScene / isStaticItem (web/ai/solver.js), applyPatches / digestScene (web/ai/orchestrator.js), layout (web/sim/index.js: the overlap
// warnings of a scene, {warnings}).
// What it adds to applyPatches + solve (measured in ai/experiments/edit: untouched items byte-identical in every result):
//  1. every item the patches do not touch (nor rest on / hover just above a touched item) is pinned to its exact pose and put back byte for
//     byte after the solve (the round trip re-seated resting things at the solver's resting distance: the starter's seesaw rose 1.5 mm and a
//     brick stack up to 4 mm on EVERY edit, and the solver's keep-on-table shift moved whole layouts 0.5-8 cm);
//  2. a swapped or resized thing keeps its seat: on what it rested on, at the same x; held in the air, its lowest point stays (a 24 cm
//     basketball in place of the 6 cm superball no longer starts inside the ramp under it);
//  3. what rests on a moved thing (or is held at most 6 cm above it) goes with it by the same dx/dy; what rests on a changed thing is re-seated;
//  4. the table, the stage, the safety walls and the scene's timing stay as they were unless a patch changes them (no walls added to a scene
//     that had none);
//  5. a changed or new thing that starts inside a safety wall is slid off it; new overlaps are returned (`overlaps`) for the caller to fix
//     (the experiment's repair turn) or report.

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const safety = (i) => i?.type === "wall" && i.props?.invisible_in_3d === true
const r6 = (v) => Math.round(v * 1e6) / 1e6
const fmt = (m) => (Math.abs(m) >= 1 ? `${Math.abs(m).toFixed(2)} m` : `${(Math.abs(m) * 100).toFixed(1)} cm`)
const idsOf = (p) => (Array.isArray(p?.ids) ? p.ids : p?.id !== undefined ? [p.id] : [])
const SIZE_KEYS = new Set(["diameter", "width", "height", "length", "thickness", "wall", "depth", "count", "first_height", "growth", "spacing", "radius", "size", "scale", "bob_diameter"])
const CONTAINERS = new Set(["box", "cup", "bucket", "basket", "plastic-cup", "glass-jar"])

function expand(patches) {
	const out = []
	for (const p of Array.isArray(patches) ? patches : []) {
		if (!isObj(p)) continue
		if (Array.isArray(p.ids) && p.id === undefined) for (const id of p.ids) out.push({ ...p, ids: undefined, id })
		else out.push(p)
	}
	return out
}

export function applyEdit(base, patchesIn, deps) {
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
	const plan0 = base.plan ? clone(base.plan) : planFromScene(scene0)
	const planItem = (plan, id) => plan.items.find((i) => i.id === id)
	let patches = expand(patchesIn)

	// ---- 2. swaps and resizes keep their seat
	const placed = new Set(patches.filter((p) => ["set_place", "place"].includes(p.op) || (p.op === "move" && [p.x, p.y_m, p.dx, p.dy].some((v) => num(v) !== null))).flatMap(idsOf))
	const extra = []
	for (const p of patches) {
		if (!["replace_type", "set_props", "props"].includes(p.op) || placed.has(p.id)) continue
		const it0 = byId0.get(p.id)
		const pi = planItem(plan0, p.id)
		const row = row0.get(p.id)
		if (!it0 || !pi || !row?.box) continue
		if (p.op !== "replace_type" && !Object.keys(p.props ?? p.set ?? {}).some((k) => SIZE_KEYS.has(k))) continue
		const on = restsOn(p.id)
		const pl = pi.place ?? {}
		if (on) {
			if (pl.on === "air" || pl.keep) {
				const sup = row0.get(on)
				const inside = on !== "table" && CONTAINERS.has(byId0.get(on)?.type) && sup?.box && row.box.y0 < sup.box.y1 - 0.003
				extra.push({ op: "set_place", id: p.id, place: inside ? { on, inside: on, x: it0.x } : { on, x: it0.x } })
				placed.add(p.id)
			}
		} else if ((pl.on === "air" || !pl.on) && dynamic(it0)) {
			// held or hanging in the air (a dynamic thing): its lowest point stays where it was
			extra.push({ op: "set_place", id: p.id, place: { on: "air", x: it0.x, bottom_m: r6(row.box.y0 - top), angle_deg: Number(it0.angle) || 0 } })
			placed.add(p.id)
		}
	}
	patches = [...patches, ...extra]

	// ---- 3. what rests on (or hovers ≤ 6 cm above) a moved thing goes with it
	const support = new Map() // id -> what it rests on, or the thing it hovers just above
	for (const r of d0.items) {
		if (r.type === "table" || safety(byId0.get(r.id))) continue
		const on = restsOn(r.id)
		if (on) {
			support.set(r.id, on)
			continue
		}
		if (!r.box) continue
		let best = null
		for (const o of d0.items) {
			if (o.id === r.id || !o.box || o.type === "table" || safety(byId0.get(o.id))) continue
			if (o.box.x1 < r.box.x0 || o.box.x0 > r.box.x1 || o.box.y1 > r.box.y0 + 1e-4) continue
			if (!best || o.box.y1 > best.box.y1) best = o
		}
		if (best && r.box.y0 - best.box.y1 <= 0.06 && dynamic(byId0.get(r.id))) support.set(r.id, best.id)
	}
	const moved = new Map()
	for (const p of patches) if (p.op === "move" && (num(p.dx) !== null || num(p.dy) !== null)) for (const id of idsOf(p)) moved.set(id, { dx: num(p.dx) ?? 0, dy: num(p.dy) ?? 0 })
	const followers = new Set()
	const patched = new Set(patches.flatMap(idsOf))
	for (let grew = true; grew; ) {
		grew = false
		for (const [id, on] of support) {
			if (followers.has(id) || patched.has(id) || !moved.has(on)) continue
			const pi = planItem(plan0, id)
			const it0 = byId0.get(id)
			if (!pi || !it0) continue
			const dd = moved.get(on)
			const pl = pi.place ?? {}
			if (pl.on === "air" || pl.keep) patches.push({ op: "set_place", id, place: { ...pl, x: r6((num(pl.x) ?? it0.x) + dd.dx), ...(num(pl.y_m) !== null ? { y_m: r6(pl.y_m + dd.dy) } : {}) } })
			else if (num(pl.x) !== null) patches.push({ op: "set_place", id, place: { ...pl, x: r6(pl.x + dd.dx) } })
			moved.set(id, dd)
			followers.add(id)
			grew = true
		}
	}

	// ---- the app's own patch semantics
	const r = applyPatches(plan0, patches, scene0)
	const plan1 = r.plan
	const ids1 = new Set(plan1.items.map((i) => i.id))
	const touched = new Set([...patches.flatMap(idsOf), ...patches.filter((p) => p.op === "add").map((p) => p.item?.id).filter(Boolean), ...followers])
	for (const id of byId0.keys()) if (!ids1.has(id) && !safety(byId0.get(id)) && byId0.get(id).type !== "table") touched.add(id)
	// what rests on a changed (not moved) thing is re-seated on it (a ball on a seesaw whose tilt changed)
	for (const [id, on] of support) {
		if (!restsOn(id) || touched.has(id) || !touched.has(on) || !ids1.has(on) || moved.has(id)) continue
		const pi = planItem(plan1, id)
		const it0 = byId0.get(id)
		if (!pi || !it0) continue
		if (pi.place?.on === "air" || pi.place?.keep) pi.place = { on, x: it0.x }
		touched.add(id)
		followers.add(id)
	}
	// what refers to a touched thing in its place (in a plan-built scene: rests on it, beside it, leans on it) follows it
	const refsOf = (pl) => (isObj(pl) ? [pl.on, pl.inside, pl.left_of?.id ?? pl.left_of, pl.right_of?.id ?? pl.right_of, pl.lean?.from?.on, pl.lean?.to?.on].filter((x) => typeof x === "string") : [])
	const dependents = new Set()
	for (let grew = true; grew; ) {
		grew = false
		for (const it of plan1.items) {
			if (touched.has(it.id) || dependents.has(it.id)) continue
			const on = restsOn(it.id)
			if (refsOf(it.place).some((x) => touched.has(x) || dependents.has(x)) || (on && touched.has(on) && !ids1.has(on))) {
				dependents.add(it.id)
				grew = true
			}
		}
	}
	// ---- 1. pin the rest
	const pinned = new Set()
	for (const it of plan1.items) {
		if (touched.has(it.id) || dependents.has(it.id)) continue
		const s = byId0.get(it.id)
		if (!s) continue
		it.place = { on: "air", x: Number(s.x) || 0, y_m: r6((Number(s.y) || 0) - top), angle_deg: Number(s.angle) || 0, keep: true }
		pinned.add(it.id)
	}
	plan1.stage = clone(scene0.stage)
	let solved
	try {
		solved = solve(plan1)
	} catch (e) {
		return { error: `the solver could not place it: ${e.message}`, changes: r.changes, skipped: r.skipped, plan: plan1 }
	}
	const setScene = patches.filter((p) => p.op === "set_scene")
	const restore = (s, letGo = new Set()) => {
		const out = clone(s)
		out.id = scene0.id
		out.name = scene0.name
		out.stage = clone(scene0.stage)
		out.seconds = setScene.some((p) => p.seconds !== undefined) ? out.seconds : scene0.seconds
		out.release = setScene.some((p) => p.release !== undefined) ? out.release : scene0.release
		const keepBase = scene0.items.filter((i) => i.type === "table" || safety(i)).map(clone)
		out.items = out.items.filter((i) => i.type !== "table" && !safety(i)).map((i) => (pinned.has(i.id) && !letGo.has(i.id) && byId0.has(i.id) ? clone(byId0.get(i.id)) : i))
		const order = new Map(scene0.items.map((i, k) => [i.id, k]))
		out.items = [...keepBase, ...out.items].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
		return out
	}
	let scene1 = restore(solved.scene)
	const before = new Set((layout(scene0).warnings ?? []).map((w) => w.text))
	const fresh = (sc) => (layout(sc).warnings ?? []).filter((w) => !before.has(w.text))
	// ---- 5a. a pinned neighbour that the change now overlaps: the solver's place for it, when that clears more
	const madeRoom = []
	const w1 = fresh(scene1)
	const letGo = new Set()
	for (const w of w1) for (const id of w.items ?? []) if (pinned.has(id) && (w.items ?? []).some((o) => touched.has(o) || dependents.has(o))) letGo.add(id)
	if (letGo.size) {
		const s2 = restore(solved.scene, letGo)
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
	// ---- 5b. a changed or new thing inside a safety wall is slid off it
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
			if (!it || !b || !wb || !(touched.has(id) || dependents.has(id))) continue
			const tableX = Number(scene1.items.find((i) => i.type === "table")?.x ?? 1.3)
			const left = (wb.x0 + wb.x1) / 2 < tableX // (the left wall: slide it right)
			const shift = left ? wb.x1 - b.x0 + 0.003 : -(b.x1 - wb.x0 + 0.003)
			it.x = r6((it.x ?? 0) + shift)
			madeRoom.push(`${it.name ?? id} slid ${fmt(shift)} off the ${left ? "left" : "right"} safety wall`)
		}
	}
	return { scene: scene1, plan: plan1, changes: r.changes, skipped: r.skipped, touched: [...touched], followers: [...followers], dependents: [...dependents], pinned: [...pinned], madeRoom, overlaps: fresh(scene1), issues: (solved.issues ?? []).filter((i) => i.level !== "info" && (touched.has(i.item) || dependents.has(i.item))), patches }
}
