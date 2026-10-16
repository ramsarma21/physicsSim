// "Make it work again", the least change first (ai/DESIGN.md §14.2 (6a); a port of ai/experiments/edit/integrate/aim-container.js, arm n7):
// for a failing "in" goal whose container is static, run the scene WITHOUT the container, take the thing's free path, and try the container
// where that path comes down through its rim height (for a container in the air also a few rim heights lower and higher), each tried in the
// engine; the first that passes (nearest first) wins. Measured: the two broken starter scenes it applies to were fixed in 1 engine run each
// (~0.3 s), moving only the box; aimed boxes 10/10 on the make-it-work samples.
//   import { aimContainer, freePath } from "./aim.js"
//   const r = await aimContainer({ scene }, goal, { simulate, apply, isStaticItem, digestScene, signal })
//   // {patches: [{op: "move", id, dx, dy?}], moved_m, runs} | {patches: null, runs} | null (not applicable)
// deps: simulate(scene, signal) -> a run; apply(patches) -> {scene, overlaps, error?} (sync or async: the app's own placement of those
// patches on the scene on screen); isStaticItem (solver.js); digestScene (orchestrator.js).
// The caller's rule (the experiment's): never aim a container the user's last request changed (that would undo what they just asked for).
const clone = (o) => JSON.parse(JSON.stringify(o))
const abortError = () => Object.assign(new Error("Cancelled"), { name: "AbortError" })

/** The item's path in a run: [{t, x, y}] of its first solid. */
export function freePath(sim, item) {
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

export async function aimContainer(base, goal, { simulate, apply, isStaticItem, digestScene, maxRuns = 16, signal = null }) {
	const scene = base.scene
	const box = scene.items.find((i) => i.id === goal.container)
	const thing = scene.items.find((i) => i.id === goal.item)
	if (!box || !thing || !isStaticItem(box.type, box.fixed === true)) return null
	const row = digestScene(scene).items.find((r) => r.id === box.id)
	if (!row?.box) return null
	const onSomething = row.rests_on && !/^(nothing|held)/.test(row.rests_on)
	// the free path: the scene without the container
	const free = clone(scene)
	free.items = free.items.filter((i) => i.id !== box.id)
	free.goals = (free.goals ?? []).filter((g) => g.container !== box.id && g.item !== box.id)
	if (signal?.aborted) throw abortError()
	const path = freePath(await simulate(free, signal), thing.id)
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
	// nearest first; at most maxRuns tried. (Live engine, 15 Oct: a bouncy ball dropped dead centre can bounce back out where 2 cm either
	// side stays in — the starter's box 12 cm right: the crossing itself fails, 2 cm off it passes — so each crossing is also tried 2 and 4 cm
	// either side of it, the side nearer where the container stands first.)
	cands.sort((p, q) => Math.hypot(p.dx, p.dy) - Math.hypot(q.dx, q.dy))
	const tries = []
	for (const c of cands)
		for (const o of [0, 0.02, 0.04]) {
			const pair = o ? [c.dx + o, c.dx - o].sort((a, b) => Math.abs(a) - Math.abs(b)) : [c.dx]
			for (const dx of pair) if (!tries.some((t) => Math.abs(t.dx - dx) < 0.005 && Math.abs(t.dy - c.dy) < 0.005)) tries.push({ dx, dy: c.dy })
		}
	let runs = 0
	for (const c of tries.slice(0, maxRuns)) {
		if (signal?.aborted) throw abortError()
		const patches = [{ op: "move", id: box.id, dx: Math.round(c.dx * 1e4) / 1e4, ...(c.dy && !onSomething ? { dy: Math.round(c.dy * 1e4) / 1e4 } : {}), why: "aimed at where the ball comes down" }]
		let r
		try {
			r = await apply(patches)
		} catch (e) {
			if (e?.name === "AbortError") throw e
			continue
		}
		if (!r || r.error || r.overlaps?.length) continue
		const s = clone(r.scene)
		s.goals = [...(s.goals ?? []).filter((g) => !(g.item === goal.item && g.container === goal.container)), { kind: "in", item: goal.item, container: goal.container, label: goal.label }]
		const sim = await simulate(s, signal)
		runs++
		if ((sim.summary?.goals ?? []).find((g) => g.item === goal.item && g.container === goal.container)?.ok) return { patches, moved_m: Math.hypot(c.dx, c.dy), runs, scene: r.scene, sim }
	}
	return { patches: null, runs }
}
