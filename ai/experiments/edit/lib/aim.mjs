// "Make it work": aim a container at where the thing actually flies. For a failing "in" goal with a static container: run the scene without
// the container, take the item's free path, and try the container where that path comes down through its rim height (and a few rim heights
// lower or higher, for a container in the air), each tried in the engine; the passing one that moves the container least wins.
//   const r = await aimContainer({scene, plan}, goal, { apply, simulate, F })   // {patches: [move...], moved_m, runs} | null
const clone = (o) => JSON.parse(JSON.stringify(o))

/** The item's path in a run: [{t, x, y}] of its first solid. */
function pathOf(sim, item) {
	const frames = sim?.track?.frames ?? []
	let sid = null
	const out = []
	let last = null
	for (const f of frames) {
		const pl = f.placements ?? {}
		if (!sid) sid = Object.keys(pl).find((k) => k.split("/")[0] === item) ?? null
		const p = sid ? pl[sid] ?? last : null
		if (p) out.push({ t: f.t, x: p.x, y: p.y })
		last = p ?? last
	}
	return out
}

export async function aimContainer(base, goal, { apply, simulate, F, maxRuns = 16 }) {
	const scene = base.scene
	const box = scene.items.find((i) => i.id === goal.container)
	const thing = scene.items.find((i) => i.id === goal.item)
	if (!box || !thing || !F.solver.isStaticItem(box.type, box.fixed === true)) return null
	const cat = await F.catalog.getCatalog()
	const d = await F.sceneDigest.sceneDigest(scene, cat.index)
	const row = d.items.find((r) => r.id === box.id)
	if (!row?.box) return null
	const onTable = row.rests_on && !/^nothing/.test(row.rests_on)
	// the free path: the scene without the container
	const free = clone(scene)
	free.items = free.items.filter((i) => i.id !== box.id)
	free.goals = (free.goals ?? []).filter((g) => g.container !== box.id && g.item !== box.id)
	const sim0 = await simulate(free)
	const path = pathOf(sim0, thing.id)
	if (path.length < 3) return null
	const cx = (row.box.x0 + row.box.x1) / 2
	const rim = row.box.y1
	const heights = onTable ? [rim] : [rim, rim - 0.1, rim - 0.2, rim + 0.1, rim - 0.3].filter((h) => h - (row.box.y1 - row.box.y0) > 0.005)
	const cands = []
	for (const h of heights)
		for (let k = 1; k < path.length; k++) {
			const a = path[k - 1]
			const b = path[k]
			if (a.y >= h + 0.01 && b.y < h + 0.01 && b.y < a.y) {
				const x = a.x + ((h + 0.01 - a.y) / (b.y - a.y)) * (b.x - a.x)
				cands.push({ dx: x - cx, dy: h - rim, t: b.t })
			}
		}
	// nearest first; at most maxRuns tried
	cands.sort((p, q) => Math.hypot(p.dx, p.dy) - Math.hypot(q.dx, q.dy))
	let runs = 0
	for (const c of cands.slice(0, maxRuns)) {
		const patches = [{ op: "move", id: box.id, dx: Math.round(c.dx * 1e4) / 1e4, ...(c.dy && !onTable ? { dy: Math.round(c.dy * 1e4) / 1e4 } : {}), why: "aimed at where the ball comes down" }]
		const r = await apply(patches)
		if (!r || r.error || r.overlaps?.length) continue
		const s = clone(r.scene)
		s.goals = [...(s.goals ?? []).filter((g) => !(g.item === goal.item && g.container === goal.container)), { kind: "in", item: goal.item, container: goal.container, label: goal.label }]
		const sim = await simulate(s)
		runs++
		const ok = (sim.summary?.goals ?? []).find((g) => g.item === goal.item && g.container === goal.container)?.ok
		if (ok) return { patches, moved_m: Math.hypot(c.dx, c.dy), runs }
	}
	return { patches: null, runs }
}
