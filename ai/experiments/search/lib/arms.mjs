// The four builds compared on each case. All start from the same plan calls (variant A = the shipped plan call; B-D = design directions), so
// the comparison is paired; each then ends in the shipped pipeline's own loop (frozen web/ai/orchestrator.js: renders -> refine <= 3 -> tune ->
// final check), handed the chosen plan where the app would have called the plan step.
//   base      plan A -> the shipped loop                                                                  (what the app does today)
//   bon       plans A-D -> each: solve, run, the shipped tuner -> render + rate (refine rate_only) -> the best -> the shipped loop
//   stage     plan A -> stage-by-stage tuning, a model repair of a stage the tuner cannot fix (<= 2 per stage, <= 4 in all) -> the shipped loop
//   bonstage  plans A-D -> each: stage-by-stage tuning -> render + rate -> the best -> its stage repairs -> the shipped loop
import { clone, isObj, log, now, orch, runStep, shots, simulate, wire } from "./infra.mjs"
import { evaluate } from "./physics.mjs"
import { fixOverlaps, repairAccepted, repairStage, repairVerdict } from "./repair.mjs"
import { shippedTune, stageTune } from "./stagetune.mjs"

const brief = (ev) => (ev?.ok ? { goals: `${ev.f.goalsOk}/${ev.f.goals}`, checks: `${ev.f.stagesOk}/${ev.f.stages}`, errors: ev.f.errors, warnings: ev.f.warnings, floating: ev.f.floating, through: ev.f.through } : { error: ev?.error ?? "not built" })

/** Stage-by-stage build with model repairs. -> {ev, log: {tune: [...], repairs: [...]}, runs, ms} */
export async function chainBuild(L, request, plan, { from = null, repairs = 4, perStageRepairs = 2, name = "", joint = process.env.SEARCH_JOINT === "1", v3 = process.env.SEARCH_REPAIR_V3 === "1" } = {}) {
	const t0 = now()
	let t = await stageTune(plan, { from })
	const logs = { tune: [{ round: 0, stages: t.stages, failStage: t.failStage, runs: t.runs, ms: t.ms }], repairs: [] }
	let runs = t.runs
	let left = repairs
	const per = new Map()
	while (t.ev.ok && t.failStage !== null && left > 0) {
		const k = t.ev.stages.findIndex((s) => s.stage === t.failStage)
		if (k < 0) break
		const label = t.ev.stages[k].label
		const n = per.get(label) ?? 0
		if (n >= perStageRepairs) break
		per.set(label, n + 1)
		left--
		const tl = t.stages.at(-1)?.stage === t.failStage ? t.stages.at(-1) : null
		const rep = await repairStage(L, request, t.ev, k, tl, { round: n + 1 })
		const entry = { stage: t.failStage, label, round: n + 1, ok: rep.ok, reply: rep.reply ?? null, changes: rep.changes ?? [], error: rep.error ?? null, ms: rep.ms ?? null }
		logs.repairs.push(entry)
		if (!rep.ok) continue
		let ev2 = await evaluate(rep.plan)
		entry.after = brief(ev2)
		if (v3) {
			const vd = repairVerdict(t.ev, ev2, k)
			if (!vd.ok) {
				entry.accepted = false
				continue
			}
			if (vd.overlapFix) {
				const fx = await fixOverlaps(L, ev2)
				entry.overlapFix = { kept: fx.ok, changes: fx.changes ?? [], error: fx.error ?? null }
				if (fx.ok) ev2 = fx.ev
			}
		} else if (!repairAccepted(t.ev, ev2, k)) {
			entry.accepted = false
			continue
		}
		entry.accepted = true
		const t2 = await stageTune(ev2.plan, { from: ev2 })
		runs += t2.runs
		logs.tune.push({ round: logs.repairs.length, stages: t2.stages, failStage: t2.failStage, runs: t2.runs, ms: t2.ms })
		entry.afterTune = brief(t2.ev)
		t = t2
	}
	// v2: whatever still fails gets the app's own joint tuner too (all of plan.tune's knobs at once, for the goals); kept only when more checks
	// pass and none that passed stops (r1: the stage tuner alone missed one case the joint tuner made, h02)
	if (joint && t.ev.ok && (t.ev.f.goalsOk < t.ev.f.goals || t.ev.f.stagesOk < t.ev.f.stages)) {
		const j = await shippedTune(t.ev.plan, { from: t.ev })
		runs += j.runs
		const a = t.ev
		const b = j.ev
		const kept = b.ok && b.f.goalsOk + b.f.stagesOk > a.f.goalsOk + a.f.stagesOk && a.stages.every((s, i) => !(s.res?.ok === true) || b.stages[i]?.res?.ok === true) && b.f.errors + b.f.through <= a.f.errors + a.f.through
		logs.joint = { runs: j.runs, kept, changed: j.changed }
		if (kept) t = { ...t, ev: b }
	}
	log(`${name} chain: ${brief(t.ev).checks} checks, goals ${brief(t.ev).goals}, ${logs.repairs.length} repairs (${logs.repairs.filter((r) => r.accepted).length} kept), ${runs} runs`)
	return { ev: t.ev, log: logs, runs, ms: now() - t0 }
}

/** Selection score of a candidate (higher is better): the rater's score, the share of its goals and checks that pass, minus build faults. */
export function selectionScore(c) {
	const f = c.ev?.f
	if (!c.ev?.ok || !f) return -Infinity
	const goalFrac = f.goals ? f.goalsOk / f.goals : 0.5
	const checkFrac = f.stages ? f.stagesOk / f.stages : goalFrac
	const rate = Number.isFinite(c.rate?.score) ? c.rate.score : 5
	return rate + 3 * goalFrac + 2 * checkFrac - 2 * f.errors - 1 * f.through - 0.5 * f.warnings - 0.5 * f.floating
}

/**
 * Best of N: each candidate plan is tuned (mode "shipped" | "stage"), rendered and rated by the app's rate-only check; the best by
 * selectionScore wins. -> {best, table: [{variant, ...}], ms, rateMs (the slowest rate call: they run side by side)}
 */
export async function selectBest(L, request, cands, { mode = "shipped", name = "" } = {}) {
	const t0 = now()
	const done = await Promise.all(
		cands.map(async (c) => {
			const ev0 = await evaluate(c.plan)
			if (!ev0.ok) return { ...c, ev: ev0, tuned: null }
			const tr = mode === "stage" ? await stageTune(c.plan, { from: ev0 }) : await shippedTune(c.plan, { from: ev0 })
			return { ...c, ev0, ev: tr.ev, tuned: { runs: tr.runs, ms: tr.ms, failStage: tr.failStage ?? null, stages: tr.stages ?? null, changed: tr.changed ?? null } }
		})
	)
	const tTuned = now()
	await Promise.all(
		done.map(async (c) => {
			if (!c.ev?.ok) return
			const t1 = now()
			const pics = await shots(c.ev.sim, c.ev.scene)
			c.renderMs = now() - t1
			try {
				const out = await runStep(
					L,
					"refine",
					{ text: request, plan: c.ev.plan, scene: c.ev.scene, sim: { summary: c.ev.sim.summary, warnings: c.ev.sim.warnings }, renders: pics.map((s) => wire(s, `the solved scene, ${s.label === "close-up" ? "close-up at the end" : `at ${Number(s.t).toFixed(1)} s (${s.label})`}`)), rate_only: true, round: 1, rounds: 1 },
					{ label: `rate ${c.variant}`, routeStep: "rate" }
				)
				c.rate = { score: Number(out.result?.score_0_10), issues: (out.result?.issues ?? []).map((i) => (typeof i === "string" ? i : i?.text)).slice(0, 4), ms: out.ms }
			} catch (e) {
				c.rate = { score: null, error: String(e?.message ?? e).slice(0, 200) }
			}
		})
	)
	for (const c of done) c.sel = selectionScore(c)
	const ranked = done.filter((c) => Number.isFinite(c.sel)).sort((a, b) => b.sel - a.sel)
	const best = ranked[0] ?? null
	const table = done.map((c) => ({ variant: c.variant, sel: Number.isFinite(c.sel) ? Math.round(c.sel * 100) / 100 : null, rate: c.rate?.score ?? null, before: brief(c.ev0), after: brief(c.ev), tuneRuns: c.tuned?.runs ?? 0, failStage: c.tuned?.failStage ?? null, issues: c.rate?.issues ?? [], chosen: c === best }))
	log(`${name} select (${mode}): ${table.map((r) => `${r.variant}=${r.sel}${r.chosen ? "*" : ""} (rate ${r.rate}, goals ${r.after.goals}, checks ${r.after.checks})`).join(" | ")}`)
	return { best, table, ms: now() - t0, tuneMs: tTuned - t0, rateMs: Math.max(0, ...done.map((c) => (c.rate?.ms ?? 0) + (c.renderMs ?? 0))) }
}

/**
 * The shipped loop on a given plan (frozen orchestrator: solve -> run -> render -> refine <= 3 -> tune -> final check). The plan step's call is
 * answered with `plan` (its cost was counted where it was made). -> {report, ms, waitMs (the slot waits of its own calls), calls}
 */
export async function shippedLoop(L, request, plan) {
	const before = L.calls.length
	const api = async (p, body) => {
		const step = p.replace("/api/ai/", "")
		if (step === "plan") return { ok: true, result: clone(plan), model: "given", ms: 0, usage: {} }
		try {
			const out = await runStep(L, step, body.payload, { label: `loop ${step}` })
			return { ok: true, result: out.result, model: out.model, ms: out.ms, usage: out.usage }
		} catch (e) {
			return { ok: false, error: String(e?.message ?? e), code: e?.code ?? "gateway", retryable: false }
		}
	}
	const o = orch.createOrchestrator({ api, shot: { render: async (sim, { scene }) => shots(sim, scene) }, simulate: (s, sig) => simulate(s, sig) })
	const t0 = now()
	const job = o.build({ text: request }, { onEvent: () => {} })
	const report = await job.result
	const ms = now() - t0
	const mine = L.calls.slice(before)
	return { report, ms, waitMs: mine.reduce((s, c) => s + (c.waitMs ?? 0), 0), calls: mine.length }
}

/** Is a version verified by the physics: it has something to check, every goal and every stage check passes, and nothing builds badly. */
export const verified = (ev) => !!ev?.ok && ev.f.goals + ev.f.stages > 0 && ev.f.goalsOk === ev.f.goals && ev.f.stagesOk === ev.f.stages && ev.f.errors === 0 && ev.f.through === 0 && ev.f.floating === 0

/**
 * The verified gate: a version the physics verifies gets ONE rate-only look (the app's final check, effort low) instead of the critic's rounds;
 * a score of 8 or more puts it on the table as it is. Otherwise (not verified, or rated below 8, with its issues passed on) the shipped loop
 * runs, and its result is kept only if it does not lose a goal or a stage check the verified version had (the guard).
 * -> {gate: {verified, rate, issues, ms}, loop?: shippedLoop result, final: {plan, scene, from: "gate" | "loop" | "guard"}}
 */
export async function gatedFinish(L, request, ev) {
	const gate = { verified: verified(ev) }
	if (gate.verified) {
		const t0 = now()
		const pics = await shots(ev.sim, ev.scene)
		try {
			const out = await runStep(
				L,
				"refine",
				{ text: request, plan: ev.plan, scene: ev.scene, sim: { summary: ev.sim.summary, warnings: ev.sim.warnings }, renders: pics.map((x) => wire(x, `the solved scene, ${x.label === "close-up" ? "close-up at the end" : `at ${Number(x.t).toFixed(1)} s (${x.label})`}`)), rate_only: true, round: 1, rounds: 1 },
				{ label: "gate rate", routeStep: "rate" }
			)
			gate.rate = Number(out.result?.score_0_10)
			gate.issues = (out.result?.issues ?? []).map((i) => (typeof i === "string" ? i : i?.text)).slice(0, 4)
		} catch (e) {
			gate.error = String(e?.message ?? e).slice(0, 200)
		}
		gate.ms = now() - t0
		if (gate.rate >= 8) return { gate, final: { plan: ev.plan, scene: ev.scene, from: "gate" } }
	}
	const loop = await shippedLoop(L, request, ev.plan)
	const rep = loop.report
	if (gate.verified) {
		const after = await evaluate(rep.plan)
		const lost = !after.ok || after.f.goalsOk < ev.f.goalsOk || after.f.stagesOk < ev.f.stagesOk
		if (lost) return { gate, loop, final: { plan: ev.plan, scene: ev.scene, from: "guard" } }
	}
	return { gate, loop, final: { plan: rep.plan, scene: rep.scene, from: "loop" } }
}
