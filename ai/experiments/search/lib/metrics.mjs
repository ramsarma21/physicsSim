// What a build achieved, measured the same way for every arm: the bench's deterministic scorer (frozen ai/bench/score.mjs: hard checks, the
// request's outcomes on the engine's track), the case's key outcome (the request's point: "ends in the cup"), checks score.mjs lacks
// (bounces before landing, touching each of several things), the plan's own goals and stage checks, and (separately) the blinded judge.
import { judgeLib, gateway, isObj, modelCall, score, simulate } from "./infra.mjs"
import { evaluate } from "./physics.mjs"

let BENCH = null
export const bench = (dir) => (BENCH ??= score.loadBench(dir))

function matchType(spec, type, groups) {
	if (Array.isArray(spec)) return spec.some((s) => matchType(s, type, groups))
	if (typeof spec !== "string") return false
	if (spec.startsWith("@")) return (groups[spec] ?? []).includes(type)
	return spec === type
}
/** score.mjs lacks these: bounces {of, on, min, max} (separate impacts of `of` on `on` before it ends inside a container, or in all), hits_each {of, each, min}. */
export function extraChecks(c, scene, sim, groups) {
	const out = []
	for (const x of c.expect?.extra ?? []) {
		const itemsOf = (spec) => scene.items.filter((i) => matchType(spec, i.type, groups)).map((i) => i.id)
		const solidItem = new Map(sim.doc.solids.map((s) => [s.id, s.item]))
		const imp = sim.track.impacts ?? []
		if (x.kind === "bounces") {
			const A = new Set(itemsOf(x.of))
			const B = new Set(x.on === "table" ? ["table"] : itemsOf(x.on))
			// the moment it is first inside a container (frames: its centre between the container's walls, below its rim), if ever
			const conts = scene.items.filter((i) => ["cup", "bucket", "basket", "box", "plastic-cup", "glass-jar"].includes(i.type)).map((i) => i.id)
			let tIn = Infinity
			for (const ev of imp) {
				const a = solidItem.get(ev.a)
				const b = solidItem.get(ev.b)
				if ((A.has(a) && conts.includes(b)) || (A.has(b) && conts.includes(a))) {
					tIn = Math.min(tIn, ev.t)
					break
				}
			}
			const times = imp.filter((ev) => ((A.has(solidItem.get(ev.a)) && B.has(solidItem.get(ev.b))) || (A.has(solidItem.get(ev.b)) && B.has(solidItem.get(ev.a)))) && ev.t < tIn && (ev.speed ?? 1) > 0.15).map((ev) => ev.t).sort((p, q) => p - q)
			const n = times.filter((t, i) => i === 0 || t - times[i - 1] > 0.06).length
			out.push({ kind: "bounces", ok: n >= (x.min ?? 1) && n <= (x.max ?? Infinity), detail: `${n} bounces on ${x.on} before reaching a container`, n })
		} else if (x.kind === "hits_each") {
			const A = new Set(itemsOf(x.of))
			const E = itemsOf(x.each)
			const hit = E.filter((e) => imp.some((ev) => (A.has(solidItem.get(ev.a)) && solidItem.get(ev.b) === e) || (A.has(solidItem.get(ev.b)) && solidItem.get(ev.a) === e)))
			out.push({ kind: "hits_each", ok: hit.length >= (x.min ?? E.length), detail: `touches ${hit.length} of ${E.length} ${x.each}` })
		}
	}
	return out
}

/** The deterministic measures of a (plan, scene). */
export async function measure(c, plan, scene) {
	const B = bench()
	const out = { ok: false }
	if (!plan || !scene) return { ...out, error: "nothing built" }
	let sim
	try {
		sim = await simulate(scene)
	} catch (e) {
		return { ...out, error: `engine: ${e.message}` }
	}
	const sc = await score.scoreCase(c, { plan, scene, sim }, { simulate: false, bench: B })
	const outs = Array.isArray(sc.checks?.outcomes) ? sc.checks.outcomes : []
	const key = c.expect?.key
	const extra = extraChecks(c, scene, sim, B.groups)
	const ev = await evaluate(plan)
	const own = ev.ok ? ev.stages.filter((s) => s.check && !s.synthetic) : []
	const items = scene.items.filter((i) => i.type !== "table" && !(i.type === "wall" && i.props?.invisible_in_3d)).length
	return {
		ok: true,
		pass: !!sc.pass,
		score: sc.score,
		failed: sc.failed ?? [],
		outcomes: outs.map((o) => ({ kind: o.kind, ok: !!o.ok, soft: !!o.soft, detail: o.detail })),
		outcomesOk: outs.filter((o) => o.ok).length,
		outcomesN: outs.length,
		keyOk: Number.isInteger(key) && outs[key] ? !!outs[key].ok : null,
		extra,
		// the request's point: the key outcome AND every extra check
		success: (Number.isInteger(key) && outs[key] ? !!outs[key].ok : outs.every((o) => o.ok)) && extra.every((x) => x.ok),
		ownGoals: ev.ok ? ev.f.goals : null,
		ownGoalsOk: ev.ok ? ev.f.goalsOk : null,
		ownStages: own.length,
		ownStagesOk: own.filter((s) => s.res?.ok === true).length,
		items,
		hasStages: Array.isArray(plan.stages) && plan.stages.length > 0,
		stageCount: Array.isArray(plan.stages) ? plan.stages.length : 0,
		missing: (plan.missing ?? []).map((m) => m?.asked).filter(Boolean),
		sim: { summary: sim.summary, warnings: sim.warnings }
	}
}

/** The blinded judge (frozen ai/bench/lib/judge.mjs, Opus 5.5 high) on a final scene with its renders. */
export async function judgeIt(L, c, { plan, scene, sim, shots }, id = "opus-high") {
	const cfg = gateway.configOf("judge", id)
	const out = await modelCall(L, "judge", `judge ${id}`, async () => {
		const r = await judgeLib.judge(c, { scene, plan, sim, shots, refs: [] }, cfg, { text: c.prompt })
		if (!r.ok) throw Object.assign(new Error(r.error?.message ?? "judge failed"), { code: r.error?.code ?? "gateway", status: r.error?.status })
		return r
	})
	return isObj(out?.result) ? { ...out.result, ms: out.ms } : null
}
