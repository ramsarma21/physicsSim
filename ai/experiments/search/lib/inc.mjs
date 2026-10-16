// The incremental chain build ("inc"): the machine is built one stage at a time. Step k holds only the things of stages 1..k (plus whatever
// they rest on or are placed against, and things no stage names); stage k is tuned in that partial machine until its check passes, and when
// the tuner cannot make it pass the model re-plans stage k against the engine's run of the machine so far (the edit step, medium effort,
// seeing only the partial machine and the measured hand-off). Then stage k+1's things are added. The finished machine then goes to the
// shipped loop like the other arms.
import { clone, isObj, log, now } from "./infra.mjs"
import { evaluate, stagesOf } from "./physics.mjs"
import { repairAccepted, repairStage } from "./repair.mjs"
import { shippedTune, stageTune } from "./stagetune.mjs"

/** Ids an item's place refers to (what it rests on, is placed against or inside, its lean ends). */
function placeRefs(it) {
	const P = isObj(it?.place) ? it.place : {}
	const out = []
	const ref = (v) => (typeof v === "string" ? v : isObj(v) ? v.id ?? v.on : null)
	for (const v of [P.on, P.inside, ref(P.left_of), ref(P.right_of), P.lean?.from?.on, P.lean?.to?.on]) if (typeof v === "string" && !["table", "air"].includes(v)) out.push(v)
	return out
}

/** The partial plan of stages 0..k (0-based into the plan's own stages). */
function partialPlan(full, k, nOwn) {
	const own = Array.isArray(full.stages) ? full.stages : []
	const stageOf = new Map()
	own.forEach((s, i) => {
		for (const id of [...(Array.isArray(s?.items) ? s.items : []), s?.check?.item, ...(s?.check?.items ?? []), s?.check?.target, s?.check?.container].filter(Boolean)) if (!stageOf.has(id)) stageOf.set(id, i)
	})
	const byId = new Map(full.items.map((i) => [i.id, i]))
	const keep = new Set(full.items.filter((i) => !stageOf.has(i.id) || stageOf.get(i.id) <= k).map((i) => i.id))
	// what kept things rest on or are placed against comes along (transitively)
	let grew = true
	while (grew) {
		grew = false
		for (const id of [...keep]) for (const r of placeRefs(byId.get(id))) if (byId.has(r) && !keep.has(r)) (keep.add(r), (grew = true))
	}
	const last = k >= nOwn - 1
	const p = clone(full)
	p.items = p.items.filter((i) => keep.has(i.id))
	p.stages = own.slice(0, k + 1).map((s) => ({ ...s, items: (s.items ?? []).filter((id) => keep.has(id)) }))
	const refsIn = (g) => [g?.item, ...(g?.items ?? []), g?.target, g?.container].filter(Boolean).every((id) => keep.has(id))
	p.goals = last ? (p.goals ?? []).filter(refsIn) : []
	p.tune = (p.tune ?? []).filter((t) => keep.has(t.id))
	return { plan: p, keep }
}

/** Put a tuned/repaired partial plan back into the whole plan: its items (changed, added, removed) and the later stages' things as they were. */
function merge(full, part, keep) {
	const out = clone(full)
	const later = full.items.filter((i) => !keep.has(i.id))
	out.items = [...clone(part.items), ...clone(later)]
	const ownFull = Array.isArray(full.stages) ? full.stages : []
	out.stages = [...clone(part.stages ?? []), ...clone(ownFull.slice((part.stages ?? []).length))]
	const tuneLater = (full.tune ?? []).filter((t) => !keep.has(t.id))
	out.tune = [...clone(part.tune ?? []), ...clone(tuneLater)]
	for (const k of ["missing", "notes", "assumptions", "seconds", "release"]) if (part[k] !== undefined) out[k] = clone(part[k])
	if ((part.goals ?? []).length) out.goals = clone(part.goals)
	return out
}

export async function incrementalBuild(L, request, plan, { name = "", repairs = 4, perStageRepairs = 2 } = {}) {
	const t0 = now()
	const nOwn = Array.isArray(plan.stages) ? plan.stages.filter((s) => isObj(s?.check)).length : 0
	const logs = { steps: [], repairs: [] }
	if (nOwn < 2) return null // not a chain: the stage arm handles it
	let full = clone(plan)
	let left = repairs
	let runs = 0
	for (let k = 0; k < plan.stages.length; k++) {
		const { plan: part0, keep } = partialPlan(full, k, plan.stages.length)
		let ev = await evaluate(part0)
		if (!ev.ok) {
			logs.steps.push({ k: k + 1, error: ev.error })
			continue
		}
		// this step's own stage (the ones before it were handled by the steps before)
		let t = await stageTune(part0, { from: ev, fromStage: k + 1 })
		runs += t.runs
		const step = { k: k + 1, items: part0.items.length, failStage: t.failStage, runs: t.runs, repairs: 0 }
		const per = new Map()
		while (t.ev.ok && t.failStage !== null && left > 0) {
			const kk = t.ev.stages.findIndex((s) => s.stage === t.failStage)
			if (kk < 0) break
			const label = t.ev.stages[kk].label
			if ((per.get(label) ?? 0) >= perStageRepairs) break
			per.set(label, (per.get(label) ?? 0) + 1)
			left--
			step.repairs++
			const tl = t.stages.at(-1)?.stage === t.failStage ? t.stages.at(-1) : null
			const rep = await repairStage(L, request, t.ev, kk, tl, { round: per.get(label) })
			const entry = { step: k + 1, stage: t.failStage, label, ok: rep.ok, reply: rep.reply ?? null, changes: rep.changes ?? [], error: rep.error ?? null }
			logs.repairs.push(entry)
			if (!rep.ok) continue
			// a whole plan from the repair is not a partial one: only patches are used here
			if (rep.whole) {
				entry.accepted = false
				entry.error = "a whole new plan (not used in the incremental build)"
				continue
			}
			const ev2 = await evaluate(rep.plan)
			if (!repairAccepted(t.ev, ev2, kk)) {
				entry.accepted = false
				continue
			}
			entry.accepted = true
			const t2 = await stageTune(ev2.plan, { from: ev2, fromStage: k + 1 })
			runs += t2.runs
			t = t2
		}
		step.failAfter = t.failStage
		logs.steps.push(step)
		if (t.ev.ok) full = merge(full, t.ev.plan, keep)
	}
	// the whole machine: every stage and goal, tuned once more where something fails (the whole plan's goals now count)
	let ev = await evaluate(full)
	const t = ev.ok ? await stageTune(full, { from: ev }) : { ev, runs: 0 }
	runs += t.runs
	ev = t.ev
	if (process.env.SEARCH_JOINT === "1" && ev.ok && (ev.f.goalsOk < ev.f.goals || ev.f.stagesOk < ev.f.stages)) {
		const j = await shippedTune(ev.plan, { from: ev })
		runs += j.runs
		const b = j.ev
		if (b.ok && b.f.goalsOk + b.f.stagesOk > ev.f.goalsOk + ev.f.stagesOk && ev.stages.every((s, i) => !(s.res?.ok === true) || b.stages[i]?.res?.ok === true)) ev = b
	}
	log(`${name} inc: ${ev.ok ? `${ev.f.stagesOk}/${ev.f.stages} checks, goals ${ev.f.goalsOk}/${ev.f.goals}` : ev.error}, ${logs.repairs.length} repairs (${logs.repairs.filter((r) => r.accepted).length} kept), ${runs} runs`)
	return { ev, log: logs, runs, ms: now() - t0 }
}
