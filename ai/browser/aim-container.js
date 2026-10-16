// "Make it work again", the least change first: for a failing "in" goal whose container is static, run the scene WITHOUT the container,
// take the thing's free path, and try the container where that path comes down through its rim height (for a container in the air also a
// few rim heights lower and higher), each tried in the engine; the first that passes (nearest first) wins. Browser-ready (web/ai/).
//   import { aimContainer } from "./aim-container.js"
//   const r = await aimContainer({ scene }, goal, { simulate, apply, isStaticItem, digestScene })
//   // {patches: [{op: "move", id, dx, dy?}], moved_m, runs} | {patches: null, runs} | null (not applicable)
// deps: simulate(scene) -> a run (the app's /api/simulate or its pool); apply(patches) -> {scene, overlaps, error?} (apply-edit.js on the
// scene on screen); isStaticItem (solver.js); digestScene (orchestrator.js). Measured in ai/experiments/edit (arm n7): the two broken
// starter scenes it applies to were fixed in 1 engine run each (~0.3 s), moving only the box.
// Rule from the experiment: never aim a container the user's last request changed (that would undo what they just asked for).
const clone = (o) => JSON.parse(JSON.stringify(o))

function pathOf(sim, item) {
	const frames = sim?.track?.frames ?? []
	let sid = null
	let last = null
	const out = []
	for (const f of frames) {
		const pl = f.placements ?? {}
		if (!sid) sid = Object.keys(pl).find((k) => k.split("/")[0] === item) ?? null
		const p = sid ? pl[sid] ?? last : null
		if (p) out.push({ t: f.t, x: p.x, y: p.y })
		last = p ?? last
	}
	return out
}

export async function aimContainer(base, goal, { simulate, apply, isStaticItem, digestScene, maxRuns = 16 }) {
	const scene = base.scene
	const box = scene.items.find((i) => i.id === goal.container)
	const thing = scene.items.find((i) => i.id === goal.item)
	if (!box || !thing || !isStaticItem(box.type, box.fixed === true)) return null
	const row = digestScene(scene).items.find((r) => r.id === box.id)
	if (!row?.box) return null
	const onSomething = row.rests_on && !/^(nothing|held)/.test(row.rests_on)
	const free = clone(scene)
	free.items = free.items.filter((i) => i.id !== box.id)
	free.goals = (free.goals ?? []).filter((g) => g.container !== box.id && g.item !== box.id)
	const path = pathOf(await simulate(free), thing.id)
	if (path.length < 3) return null
	const cx = (row.box.x0 + row.box.x1) / 2
	const rim = row.box.y1
	const tall = row.box.y1 - row.box.y0
	const heights = onSomething ? [rim] : [rim, rim - 0.1, rim - 0.2, rim + 0.1, rim - 0.3].filter((h) => h - tall > 0.005)
	const cands = []
	for (const h of heights)
		for (let k = 1; k < path.length; k++) {
			const a = path[k - 1]
			const b = path[k]
			if (a.y >= h + 0.01 && b.y < h + 0.01 && b.y < a.y) cands.push({ dx: a.x + ((h + 0.01 - a.y) / (b.y - a.y)) * (b.x - a.x) - cx, dy: h - rim })
		}
	cands.sort((p, q) => Math.hypot(p.dx, p.dy) - Math.hypot(q.dx, q.dy))
	let runs = 0
	for (const c of cands.slice(0, maxRuns)) {
		const patches = [{ op: "move", id: box.id, dx: Math.round(c.dx * 1e4) / 1e4, ...(c.dy && !onSomething ? { dy: Math.round(c.dy * 1e4) / 1e4 } : {}), why: "aimed at where the ball comes down" }]
		const r = await apply(patches)
		if (!r || r.error || r.overlaps?.length) continue
		const s = clone(r.scene)
		s.goals = [...(s.goals ?? []).filter((g) => !(g.item === goal.item && g.container === goal.container)), { kind: "in", item: goal.item, container: goal.container, label: goal.label }]
		const sim = await simulate(s)
		runs++
		if ((sim.summary?.goals ?? []).find((g) => g.item === goal.item && g.container === goal.container)?.ok) return { patches, moved_m: Math.hypot(c.dx, c.dy), runs }
	}
	return { patches: null, runs }
}
