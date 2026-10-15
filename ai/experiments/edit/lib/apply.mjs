// Deterministic patch application for edits: the change the patches ask for, and NOTHING else moves.
//   const r = await applyEdit({scene, plan, sim}, patches)   // {scene, plan, changes, skipped, touched, followers, madeRoom, warnings, issues}
// What it adds to the app's applyPatches (web/ai/orchestrator.js) + solve:
//  1. pins every item the patches do not touch (nor rest on a touched item) to its exact pose: after the solve it is put back byte for
//     byte (the app's round trip re-seats resting things at the solver's resting distance: the starter's seesaw rose 1.5 mm on EVERY edit);
//  2. re-seats a swapped or resized thing on what it rested on (same support, same x), and keeps the lowest point of a thing held in the air
//     where it was (a 24 cm basketball in place of a 6 cm superball no longer starts inside the ramp under it);
//  3. things resting on a moved item go with it (a ball on a seesaw moved 5 cm right);
//  4. the table, the stage, the safety walls and the scene's timing stay as they were unless a patch changes them;
//  5. a pinned neighbour that the change now overlaps is the only thing let go (the solver's least move makes room), and that is said.
import { frozen } from "./env.mjs"

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const safety = (i) => i?.type === "wall" && i.props?.invisible_in_3d === true
const r6 = (v) => Math.round(v * 1e6) / 1e6
const fmt = (m) => (Math.abs(m) >= 1 ? `${m.toFixed(2)} m` : `${(Math.abs(m) * 100).toFixed(1)} cm`)

/** Patch ops that name one item (and which). */
const idsOf = (p) => (Array.isArray(p?.ids) ? p.ids : p?.id !== undefined ? [p.id] : [])
function expand(patches) {
	const out = []
	for (const p of Array.isArray(patches) ? patches : []) {
		if (!isObj(p)) continue
		if (Array.isArray(p.ids) && p.id === undefined) for (const id of p.ids) out.push({ ...p, ids: undefined, id })
		else out.push(p)
	}
	return out
}

import { applyEdit as applyEditPure } from "../integrate/apply-edit.js"

export async function applyEdit(base, patchesIn, opts = {}) {
	// v 3: the integration module (integrate/apply-edit.js: pure, browser-ready, the browser's own digestScene for what rests on what)
	if ((opts.v ?? 1) >= 3) {
		const F = await frozen()
		const r = applyEditPure(base, patchesIn, { solve: F.solver.solve, planFromScene: F.solver.planFromScene, isStaticItem: F.solver.isStaticItem, applyPatches: F.orch.applyPatches, digestScene: F.orch.digestScene, layout: (s) => F.sim.layout(s) })
		return r.error ? r : { ...r, warnings: r.overlaps }
	}
	return applyEditV12(base, patchesIn, opts)
}
async function applyEditV12(base, patchesIn, { reseat = true, follow = true, pin = true, v = 1 } = {}) {
	// v 2: a thing held just above a moved item (≤ 6 cm, nothing between) goes with it, as if it rested on it; a changed or new thing that
	// starts inside a safety wall is slid off it
	const F = await frozen()
	const cat = await F.catalog.getCatalog()
	const scene0 = base.scene
	const top = Number(scene0.items.find((i) => i.type === "table")?.y) || 0
	const byId0 = new Map(scene0.items.map((i) => [i.id, i]))
	const d0 = await F.sceneDigest.sceneDigest(scene0, cat.index)
	const rests0 = new Map(d0.items.map((r) => [r.id, r.rests_on ?? null]))
	const box0 = new Map(d0.items.map((r) => [r.id, r.box]))
	const plan0 = base.plan ? clone(base.plan) : F.solver.planFromScene(scene0)
	let patches = expand(patchesIn)
	const notes = []
	// ---- 2. swaps and resizes keep their seat
	const placed = new Set(patches.filter((p) => ["set_place", "place"].includes(p.op) || (p.op === "move" && (num(p.x) !== null || num(p.y_m) !== null || num(p.dy) !== null || num(p.dx) !== null))).flatMap(idsOf))
	if (reseat) {
		const extra = []
		for (const p of patches) {
			if (!["replace_type", "set_props", "props"].includes(p.op) || placed.has(p.id)) continue
			const it0 = byId0.get(p.id)
			const pi = plan0.items.find((i) => i.id === p.id)
			if (!it0 || !pi) continue
			const sizeKeys = new Set(["diameter", "width", "height", "length", "thickness", "wall", "depth", "count", "first_height", "growth", "spacing", "radius", "size", "scale", "bob_diameter"])
			if (p.op !== "replace_type" && !Object.keys(p.props ?? p.set ?? {}).some((k) => sizeKeys.has(k))) continue
			const on = rests0.get(p.id)
			const pl = pi.place ?? {}
			if (on && !/^nothing/.test(on)) {
				// resting on something: on that support, at the same x (a container it sits in: inside it)
				if (pl.on === "air" || pl.keep) {
					const sup = byId0.get(on)
					const inside = sup && ["box", "cup", "bucket", "basket", "plastic-cup", "glass-jar"].includes(sup.type) && box0.get(p.id) && box0.get(on) && box0.get(p.id).y0 < box0.get(on).y1 - 0.003
					extra.push({ op: "set_place", id: p.id, place: inside ? { on, inside: on, x: it0.x } : { on: on === "table" ? "table" : on, x: it0.x } })
					placed.add(p.id)
				}
			} else if ((pl.on === "air" || !pl.on) && box0.get(p.id) && byId0.get(p.id) && (F.solver.isStaticItem ? !F.solver.isStaticItem(it0) : true)) {
				// held or hanging in the air: its lowest point stays where it was
				extra.push({ op: "set_place", id: p.id, place: { on: "air", x: it0.x, bottom_m: r6(box0.get(p.id).y0 - top), angle_deg: Number(it0.angle) || 0 } })
				placed.add(p.id)
			}
		}
		if (extra.length) patches = [...patches, ...extra]
	}
	// (v 2) a dynamic thing hovering just above another (held at the top of a ramp) follows it like a thing resting on it
	const hover = new Map()
	if (v >= 2)
		for (const r of d0.items) {
			if (!/^nothing \(in the air\)/.test(r.rests_on ?? "") || !r.box) continue
			let best = null
			for (const o of d0.items) {
				if (o.id === r.id || !o.box || o.type === "table" || safety(byId0.get(o.id))) continue
				if (o.box.x1 < r.box.x0 || o.box.x0 > r.box.x1 || o.box.y1 > r.box.y0 + 1e-4) continue
				if (!best || o.box.y1 > best.box.y1) best = o
			}
			if (best && r.box.y0 - best.box.y1 <= 0.06) hover.set(r.id, best.id)
		}
	const restsF = new Map([...rests0, ...hover])
	// ---- 3. what rests on a moved thing goes with it
	const moved = new Map() // id -> {dx, dy}
	for (const p of patches) if (p.op === "move" && (num(p.dx) !== null || num(p.dy) !== null)) for (const id of idsOf(p)) moved.set(id, { dx: num(p.dx) ?? 0, dy: num(p.dy) ?? 0 })
	const followers = new Set()
	if (follow && moved.size) {
		const patched = new Set(patches.flatMap(idsOf))
		let grew = true
		while (grew) {
			grew = false
			for (const [id, on] of restsF) {
				if (followers.has(id) || patched.has(id) || !on || !(moved.has(on) || followers.has(on))) continue
				const d = moved.get(on) ?? moved.get([...followers].find((f) => f === on))
				const pi = plan0.items.find((i) => i.id === id)
				const it0 = byId0.get(id)
				if (!pi || !it0) continue
				const dd = moved.get(on) ?? { dx: 0, dy: 0 }
				const pl = pi.place ?? {}
				if (pl.on === "air" || pl.keep) patches.push({ op: "set_place", id, place: { ...pl, x: r6((num(pl.x) ?? it0.x) + dd.dx), ...(num(pl.y_m) !== null ? { y_m: r6(pl.y_m + dd.dy) } : {}) } })
				else if (num(pl.x) !== null) patches.push({ op: "set_place", id, place: { ...pl, x: r6(pl.x + dd.dx) } })
				moved.set(id, dd)
				followers.add(id)
				grew = true
				void d
			}
		}
	}
	// ---- the app's own patch semantics
	const r = F.orch.applyPatches(plan0, patches, scene0)
	const plan1 = r.plan
	// what the patches touched: named, added, removed, and what refers to those (rests on, inside, beside, leans on)
	const ids1 = new Set(plan1.items.map((i) => i.id))
	const touched = new Set([...patches.flatMap(idsOf), ...patches.filter((p) => p.op === "add").map((p) => p.item?.id).filter(Boolean), ...followers])
	for (const id of byId0.keys()) if (!ids1.has(id) && !safety(byId0.get(id)) && byId0.get(id).type !== "table") touched.add(id)
	// things resting on a changed (not moved) item are re-seated on it where they were (a ball on a seesaw whose tilt changed)
	for (const [id, on] of rests0) {
		if (!on || touched.has(id) || !touched.has(on) || !ids1.has(on) || moved.has(id)) continue
		const pi = plan1.items.find((i) => i.id === id)
		const it0 = byId0.get(id)
		if (!pi || !it0) continue
		if (pi.place?.on === "air" || pi.place?.keep) pi.place = { on, x: it0.x }
		touched.add(id)
		followers.add(id)
	}
	const refsOf = (pl) => (isObj(pl) ? [pl.on, pl.inside, pl.left_of?.id ?? pl.left_of, pl.right_of?.id ?? pl.right_of, pl.lean?.from?.on, pl.lean?.to?.on].filter((x) => typeof x === "string") : [])
	const dependents = new Set()
	let grew = true
	while (grew) {
		grew = false
		for (const it of plan1.items) {
			if (touched.has(it.id) || dependents.has(it.id)) continue
			// (in a plan-built scene, an item resting on a changed one follows it: its place names it)
			if (refsOf(it.place).some((x) => touched.has(x) || dependents.has(x)) || (rests0.get(it.id) && [...touched].some((t) => t === rests0.get(it.id) && !ids1.has(t)))) {
				dependents.add(it.id)
				grew = true
			}
		}
	}
	// ---- 1. pin the rest
	const pinned = new Set()
	if (pin)
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
		solved = F.solver.solve(plan1)
	} catch (e) {
		return { error: `the solver could not place it: ${e.message}`, changes: r.changes, skipped: r.skipped, plan: plan1 }
	}
	const restore = (s, letGo = new Set()) => {
		const out = clone(s)
		out.id = scene0.id
		out.name = scene0.name
		out.stage = clone(scene0.stage)
		// the scene's timing: as before unless a patch set it
		const setScene = patches.filter((p) => p.op === "set_scene")
		out.seconds = setScene.some((p) => p.seconds !== undefined) ? out.seconds : scene0.seconds
		out.release = setScene.some((p) => p.release !== undefined) ? out.release : scene0.release
		// the table and the safety walls exactly as they were (none added where the scene had none)
		out.items = out.items.filter((i) => i.type !== "table" && !safety(i))
		const keepBase = scene0.items.filter((i) => i.type === "table" || safety(i)).map(clone)
		// pinned items: byte for byte
		out.items = out.items.map((i) => (pinned.has(i.id) && !letGo.has(i.id) && byId0.has(i.id) ? clone(byId0.get(i.id)) : i))
		// in the base scene's order, new ones last
		const order = new Map(scene0.items.map((i, k) => [i.id, k]))
		out.items = [...keepBase, ...out.items].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
		return out
	}
	let scene1 = restore(solved.scene)
	// ---- 5. a pinned neighbour the change now overlaps is let go (the solver's place for it), once
	const before = new Set((F.sim.layout(scene0).warnings ?? []).map((w) => w.text))
	const madeRoom = []
	const w1 = (F.sim.layout(scene1).warnings ?? []).filter((w) => !before.has(w.text))
	const letGo = new Set()
	for (const w of w1) for (const id of w.items ?? []) if (pinned.has(id) && (w.items ?? []).some((o) => touched.has(o) || dependents.has(o))) letGo.add(id)
	if (letGo.size) {
		const s2 = restore(solved.scene, letGo)
		const w2 = (F.sim.layout(s2).warnings ?? []).filter((w) => !before.has(w.text))
		if (w2.length < w1.length) {
			scene1 = s2
			for (const id of letGo) {
				const a = byId0.get(id)
				const b = s2.items.find((i) => i.id === id)
				if (a && b) madeRoom.push(`${a.name ?? id} moved ${fmt((b.x ?? 0) - (a.x ?? 0))} ${(b.x ?? 0) >= (a.x ?? 0) ? "right" : "left"}${Math.abs((b.y ?? 0) - (a.y ?? 0)) > 0.001 ? ` and ${fmt((b.y ?? 0) - (a.y ?? 0))} ${(b.y ?? 0) > (a.y ?? 0) ? "up" : "down"}` : ""} to make room`)
			}
		}
	}
	// (v 2) a changed or new thing that starts inside a safety wall is slid off it (the solver puts its walls in last)
	if (v >= 2) {
		const walls = scene1.items.filter(safety)
		const ww = (F.sim.layout(scene1).warnings ?? []).filter((w) => !before.has(w.text) && (w.items ?? []).some((id) => walls.some((x) => x.id === id)))
		if (ww.length) {
			const d1 = await F.sceneDigest.sceneDigest(scene1, cat.index)
			const boxOf = new Map(d1.items.map((r) => [r.id, r.box]))
			for (const w of ww) {
				const wall = walls.find((x) => (w.items ?? []).includes(x.id))
				const id = (w.items ?? []).find((x) => x !== wall?.id)
				const it = scene1.items.find((i) => i.id === id)
				const b = boxOf.get(id)
				const wb = boxOf.get(wall?.id)
				if (!it || !b || !wb || !(touched.has(id) || dependents.has(id))) continue
				const left = (wb.x0 + wb.x1) / 2 < (b.x0 + b.x1) / 2
				const shift = left ? wb.x1 - b.x0 + 0.003 : -(b.x1 - wb.x0 + 0.003)
				it.x = r6((it.x ?? 0) + shift)
				madeRoom.push(`${it.name ?? id} slid ${fmt(shift)} off the ${left ? "left" : "right"} safety wall`)
			}
		}
	}
	const warnings = (F.sim.layout(scene1).warnings ?? []).filter((w) => !before.has(w.text))
	return { scene: scene1, plan: plan1, changes: r.changes, skipped: r.skipped, touched: [...touched], followers: [...followers], dependents: [...dependents], pinned: [...pinned], madeRoom, warnings, issues: solved.issues?.filter((i) => i.level !== "info" && (touched.has(i.item) || dependents.has(i.item))) ?? [], notes, patches }
}
