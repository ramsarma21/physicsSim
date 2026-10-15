// Physics verification of a plan: solve it (frozen web/ai/solver.js), run it (the engine pool), and check every goal of the plan and every
// stage's check on that run (frozen ai/goals.mjs, the same functions the critic, the card and the tuner use), with a distance for each failing
// check ("how far from happening": the search's objective) and the features a candidate is ranked by.
import { clone, goalsMod, isObj, num, orch, simulate, solver, steps } from "./infra.mjs"

const { checkGoals, goalKind, goalItems, goalRefs } = goalsMod

/**
 * The plan's stages as checks, in order. A plan without stages (or whose stages have no check) gets one stage per goal (in the plan's
 * order), so every build is verified stage by stage: [{stage (1-based), label, check, items, knobs, synthetic?}].
 */
export function stagesOf(plan) {
	const ids = new Set((plan.items ?? []).map((i) => i?.id))
	const own = (Array.isArray(plan.stages) ? plan.stages : []).map((st, i) => ({
		stage: i + 1,
		label: String(st?.label ?? `Stage ${i + 1}`),
		does: st?.does ?? null,
		check: isObj(st?.check) ? { ...st.check, label: st.check.label ?? `Stage ${i + 1}: ${st?.label ?? ""}`.trim() } : null,
		items: (Array.isArray(st?.items) ? st.items : []).filter((id) => ids.has(id)),
		knobs: (Array.isArray(st?.tune) ? st.tune : []).filter((k) => isObj(k) && ids.has(k.id))
	}))
	const hasOwn = own.some((s) => s.check)
	const base = hasOwn ? own : []
	// the plan's goals that no stage checks become stages of their own, after the plan's stages (a plan without stages: one stage per goal)
	const same = (a, b) => goalKind(a) === goalKind(b) && JSON.stringify(goalItems(a).sort()) === JSON.stringify(goalItems(b).sort()) && (a.container ?? null) === (b.container ?? null) && (a.target ?? null) === (b.target ?? null)
	const stageKnobs = new Set(base.flatMap((s) => s.knobs.map((k) => `${k.id}|${k.param}`)))
	const goals = (Array.isArray(plan.goals) ? plan.goals : []).filter(isObj).filter((g) => !base.some((s) => s.check && same(s.check, g)))
	return [
		...base,
		...goals.map((g, i) => {
			const refs = goalRefs(g).filter((id) => ids.has(id))
			return { stage: base.length + i + 1, label: String(g.label ?? `Goal ${i + 1}`), check: { ...g }, items: refs, knobs: (plan.tune ?? []).filter((k) => isObj(k) && ids.has(k.id) && !stageKnobs.has(`${k.id}|${k.param}`)).sort((a, b) => refs.includes(b.id) - refs.includes(a.id)), synthetic: true }
		})
	]
}

/** Hits between two items: the closest the two came during the run (m, ≥ 0; centre distance minus their own sizes), and when. */
function closest(doc, track, a, b) {
	const sa = doc.solids.filter((s) => s.item === a)
	const sb = doc.solids.filter((s) => s.item === b)
	if (!sa.length || !sb.length) return { d: Infinity, t: null }
	const r = (s) => (s.body?.kind === "ball" ? s.body.radius : Math.min(s.body?.width ?? 0.05, s.body?.height ?? 0.05) / 2)
	let best = { d: Infinity, t: null }
	const fr = track.frames
	for (let k = 0; k < fr.length; k += 2) {
		const P = fr[k].placements
		for (const x of sa)
			for (const y of sb) {
				const p = P[x.id]
				const q = P[y.id]
				if (!p || !q) continue
				const d = Math.max(0, Math.hypot(p.x - q.x, p.y - q.y) - r(x) - r(y))
				if (d < best.d) best = { d, t: fr[k].t }
			}
	}
	return best
}

/** How far a check is from happening in a run: 0 when it holds, else 1 + 0.9 × (how far, 0..1). */
export function checkDistance(check, res, run, scene) {
	if (res?.ok === true) return 0
	const kind = goalKind(check)
	if (kind === "falls" && res?.of > 0) return 1 + 0.9 * (1 - (res.fallen ?? 0) / res.of)
	if (kind === "moves" && Number.isFinite(res?.moved_m)) return 1 + 0.9 * Math.max(0, Math.min(1, 1 - res.moved_m / (num(check.min_m) ?? 0.05)))
	if (kind === "hits" && run?.doc && run?.track) {
		let best = Infinity
		for (const a of goalItems(check)) best = Math.min(best, closest(run.doc, run.track, a, check.target).d)
		return 1 + 0.9 * Math.min(1, Number.isFinite(best) ? best / 0.5 : 1)
	}
	if (kind === "in" && run?.summary) {
		const only = { ...run, summary: { ...run.summary, goals: (run.summary.goals ?? []).filter((g) => g.item === check.item && g.container === check.container) } }
		if (!only.summary.goals.length) return 1.9
		return Math.min(1.9, orch.goalDistance(scene, only))
	}
	return 1.9
}

const PASS_CODES = ["overlap", "stand_through"]
const FLOAT_CODES = ["floats", "floats_end", "leg_through"]
/**
 * Solve + run a plan and check it. -> {ok (it built and ran), plan, solved, scene, sim, goals: [results], stages: [{...stage, res, d}], f
 * (features)} or {ok: false, error}. Every "in" check (of a goal or a stage) is added to the run's scene goals so the engine checks it; the
 * returned `scene` is the solver's own (as the app would put it on the table).
 */
export async function evaluate(plan, { stages = null } = {}) {
	let solved
	try {
		solved = solver.solve(plan)
	} catch (e) {
		return { ok: false, plan, error: `solve: ${e.message}` }
	}
	const real = solved.scene.items.filter((i) => i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d))
	if (!real.length) return { ok: false, plan, error: "nothing built" }
	const st = stages ?? stagesOf(plan)
	const goals = solved.goals ?? []
	const runScene = clone(solved.scene)
	runScene.goals = Array.isArray(runScene.goals) ? runScene.goals : []
	for (const g of [...goals, ...st.map((s) => s.check).filter(Boolean)])
		if (goalKind(g) === "in" && typeof g.item === "string" && typeof g.container === "string" && !runScene.goals.some((x) => x?.item === g.item && x?.container === g.container))
			runScene.goals.push({ item: g.item, container: g.container, label: String(g.label ?? "").slice(0, 200) })
	let sim
	try {
		sim = await simulate(runScene)
	} catch (e) {
		return { ok: false, plan, solved, error: `engine: ${e.message}` }
	}
	const goalRes = checkGoals(goals, sim)
	const stageRes = st.map((s) => {
		if (!s.check) return { ...s, res: null, d: 0 }
		let res
		try {
			res = checkGoals([s.check], sim)[0]
		} catch (e) {
			res = { ok: null, detail: String(e.message) }
		}
		return { ...s, res, d: checkDistance(s.check, res, sim, runScene) }
	})
	const issues = solved.issues ?? []
	const f = {
		errors: (solved.errors ?? []).length,
		warnings: (sim.warnings ?? []).length,
		floating: issues.filter((i) => FLOAT_CODES.includes(i.code)).length,
		through: issues.filter((i) => i.level !== "info" && PASS_CODES.includes(i.code)).length,
		goals: goalRes.length,
		goalsOk: goalRes.filter((g) => g.ok === true).length,
		stages: stageRes.filter((s) => s.check).length,
		stagesOk: stageRes.filter((s) => s.check && s.res?.ok === true).length,
		firstFail: (stageRes.find((s) => s.check && s.res?.ok !== true)?.stage ?? null),
		goalDist: goalRes.reduce((s, g, i) => s + checkDistance(goals[i], g, sim, runScene), 0)
	}
	return { ok: true, plan, solved, scene: solved.scene, runScene, sim, goals: goalRes, goalDefs: goals, stages: stageRes, f }
}

/** The plan's stage checks met in a run (own stages only; null when the plan has no stage checks). */
export function ownStageResults(plan, sim) {
	const checks = steps.stageChecks(plan).filter(Boolean)
	if (!checks.length) return null
	return checkGoals(checks, sim).map((r, i) => ({ stage: checks[i].stage, label: r.label, ok: r.ok, detail: r.detail }))
}
