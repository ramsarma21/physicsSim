// Physics-first planning for the AI builder: a drop-in, browser-safe module (no node imports) with what the search experiment found worth
// integrating (ai/experiments/search; numbers in its results/). Everything is injected, so web/ai/orchestrator.js can use it as is:
//
//   import { createPhysicsFirst } from "./physics-first.js"
//   const pf = createPhysicsFirst({ solve, simulate, checkGoals, goalKind, goalItems, goalRefs, goalDistance, setKnob, tune })
//   const t = await pf.stageTune(plan)              // right after the first solve: stage by stage, then the joint tuner for what still fails
//   if (pf.verified(t.ev)) ...                      // every goal and stage check passes, nothing overlaps or floats: one rate-only look, no rounds
//   const text = pf.stageFacts(t.ev, k)             // the measured hand-off of a stage the tuner cannot fix, for an edit-step repair
//   pf.lostChecks(beforeEv, afterEv)                // the loop guard: checks a new version broke
//
// The engine is deterministic, so every evaluate() of the same plan gives the same run (the browser and the server engines are byte-identical).
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())
const PASS_CODES = ["overlap", "stand_through"]
const FLOAT_CODES = ["floats", "floats_end", "leg_through"]
const TABLE = { x0: -0.5, x1: 3.1 }
const halton = (i, b) => {
	let f = 1
	let r = 0
	while (i > 0) {
		f /= b
		r += f * (i % b)
		i = Math.floor(i / b)
	}
	return r
}

export function createPhysicsFirst(deps) {
	const { solve, simulate, checkGoals, goalKind, goalItems, goalRefs, goalDistance, setKnob, tune } = deps
	const PAR = deps.parallel ?? 6

	/** The plan's stages as checks (its own `stages`, then one stage per goal no stage checks; a plan without stages: one per goal). */
	function stagesOf(plan) {
		const ids = new Set((plan.items ?? []).map((i) => i?.id))
		const own = (Array.isArray(plan.stages) ? plan.stages : []).map((st, i) => ({
			stage: i + 1,
			label: String(st?.label ?? `Stage ${i + 1}`),
			does: st?.does ?? null,
			check: isObj(st?.check) ? { ...st.check, label: st.check.label ?? `Stage ${i + 1}: ${st?.label ?? ""}`.trim() } : null,
			items: (Array.isArray(st?.items) ? st.items : []).filter((id) => ids.has(id)),
			knobs: (Array.isArray(st?.tune) ? st.tune : []).filter((k) => isObj(k) && ids.has(k.id))
		}))
		const base = own.some((s) => s.check) ? own : []
		const same = (a, b) => goalKind(a) === goalKind(b) && JSON.stringify(goalItems(a).sort()) === JSON.stringify(goalItems(b).sort()) && (a.container ?? null) === (b.container ?? null) && (a.target ?? null) === (b.target ?? null)
		const owned = new Set(base.flatMap((s) => s.knobs.map((k) => `${k.id}|${k.param}`)))
		const goals = (Array.isArray(plan.goals) ? plan.goals : []).filter(isObj).filter((g) => !base.some((s) => s.check && same(s.check, g)))
		return [
			...base,
			...goals.map((g, i) => {
				const refs = goalRefs(g).filter((id) => ids.has(id))
				return { stage: base.length + i + 1, label: String(g.label ?? `Goal ${i + 1}`), check: { ...g }, items: refs, knobs: (plan.tune ?? []).filter((k) => isObj(k) && ids.has(k.id) && !owned.has(`${k.id}|${k.param}`)).sort((a, b) => refs.includes(b.id) - refs.includes(a.id)), synthetic: true }
			})
		]
	}

	function closest(doc, track, a, b) {
		const sa = doc.solids.filter((s) => s.item === a)
		const sb = doc.solids.filter((s) => s.item === b)
		if (!sa.length || !sb.length) return Infinity
		const r = (s) => (s.body?.kind === "ball" ? s.body.radius : Math.min(s.body?.width ?? 0.05, s.body?.height ?? 0.05) / 2)
		let best = Infinity
		const fr = track.frames
		for (let k = 0; k < fr.length; k += 2)
			for (const x of sa)
				for (const y of sb) {
					const p = fr[k].placements[x.id]
					const q = fr[k].placements[y.id]
					if (p && q) best = Math.min(best, Math.max(0, Math.hypot(p.x - q.x, p.y - q.y) - r(x) - r(y)))
				}
		return best
	}
	/** 0 when the check holds, else 1 + 0.9 × how far it is from happening (0..1). */
	function checkDistance(check, res, run, scene) {
		if (res?.ok === true) return 0
		const kind = goalKind(check)
		if (kind === "falls" && res?.of > 0) return 1 + 0.9 * (1 - (res.fallen ?? 0) / res.of)
		if (kind === "moves" && Number.isFinite(res?.moved_m)) return 1 + 0.9 * Math.max(0, Math.min(1, 1 - res.moved_m / (num(check.min_m) ?? 0.05)))
		if (kind === "hits" && run?.doc && run?.track) {
			let best = Infinity
			for (const a of goalItems(check)) best = Math.min(best, closest(run.doc, run.track, a, check.target))
			return 1 + 0.9 * Math.min(1, Number.isFinite(best) ? best / 0.5 : 1)
		}
		if (kind === "in" && run?.summary) {
			const only = { ...run, summary: { ...run.summary, goals: (run.summary.goals ?? []).filter((g) => g.item === check.item && g.container === check.container) } }
			return only.summary.goals.length ? Math.min(1.9, goalDistance(scene, only)) : 1.9
		}
		return 1.9
	}

	/** Solve + run a plan, every goal and stage check on that run (an "in" check is added to the run's scene goals so the engine checks it). */
	async function evaluate(plan, { stages = null, signal } = {}) {
		let solved
		try {
			solved = solve(plan)
		} catch (e) {
			return { ok: false, plan, error: `solve: ${e.message}` }
		}
		const st = stages ?? stagesOf(plan)
		const goals = solved.goals ?? []
		const runScene = clone(solved.scene)
		runScene.goals = Array.isArray(runScene.goals) ? runScene.goals : []
		for (const g of [...goals, ...st.map((s) => s.check).filter(Boolean)])
			if (goalKind(g) === "in" && typeof g.item === "string" && typeof g.container === "string" && !runScene.goals.some((x) => x?.item === g.item && x?.container === g.container))
				runScene.goals.push({ item: g.item, container: g.container, label: String(g.label ?? "").slice(0, 200) })
		let sim
		try {
			sim = await simulate(runScene, signal)
		} catch (e) {
			if (e?.name === "AbortError") throw e
			return { ok: false, plan, solved, error: `engine: ${e.message}` }
		}
		const goalRes = checkGoals(goals, sim)
		const stageRes = st.map((s) => {
			if (!s.check) return { ...s, res: null, d: 0 }
			const res = checkGoals([s.check], sim)[0]
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
			stagesOk: stageRes.filter((s) => s.check && s.res?.ok === true).length
		}
		return { ok: true, plan, solved, scene: solved.scene, runScene, sim, goals: goalRes, goalDefs: goals, stages: stageRes, f }
	}

	function knobValue(plan, scene, k) {
		const it = plan.items.find((i) => i.id === k.id)
		const s = scene?.items?.find((i) => i.id === k.id)
		const p = String(k.param)
		if (p === "x") return s?.x ?? num(it?.place?.x)
		if (p === "y" || p === "y_m") return s?.y ?? num(it?.place?.y_m)
		if (p === "angle" || p === "angle_deg") return s?.angle ?? num(it?.place?.angle_deg) ?? 0
		if (p === "gap" || p === "gap_m") return num(it?.place?.left_of?.gap_m ?? it?.place?.right_of?.gap_m) ?? 0
		if (p.includes(".")) return num(p.replace(/^place\./, "").split(".").reduce((o, key) => o?.[key], it?.place))
		return num(it?.props?.[p]) ?? num(s?.props?.[p])
	}
	/** Knobs made from a stage's own things when its plan gave too few: the receiver first, then the mover (±25 cm along, ±15 cm up). */
	function autoKnobs(plan, scene, stage, { max = 3, have = [] } = {}) {
		const out = []
		const c = stage.check ?? {}
		const order = [c.container, c.target, ...(Array.isArray(c.items) ? c.items : [c.item]), ...(stage.items ?? [])].filter((x) => typeof x === "string")
		const seen = new Set()
		const has = (id, param) => [...have, ...out].some((k) => k.id === id && String(k.param) === param)
		for (const id of order) {
			if (seen.has(id) || out.length >= max) continue
			seen.add(id)
			const it = plan.items.find((i) => i.id === id)
			const s = scene.items.find((i) => i.id === id)
			if (!it || !s || !isObj(it.place) || it.place.inside) continue
			const P = it.place
			if (isObj(P.lean)) {
				const fy = num(P.lean.from?.y)
				if (P.lean.from?.on === "air" && fy !== null && !has(id, "lean.from.y")) out.push({ id, param: "lean.from.y", min: Math.max(0.03, fy - 0.15), max: fy + 0.15, auto: true })
				continue
			}
			if (P.left_of || P.right_of) {
				const g = num((P.left_of ?? P.right_of)?.gap_m) ?? 0
				if (!has(id, "gap")) out.push({ id, param: "gap", min: 0, max: Math.max(0.3, g + 0.2), auto: true })
			} else if (!has(id, "x") && Number.isFinite(s.x)) out.push({ id, param: "x", min: Math.max(TABLE.x0, s.x - 0.25), max: Math.min(TABLE.x1, s.x + 0.25), auto: true })
			const inAir = P.on === "air" || (P.on === undefined && num(P.y_m) !== null)
			if (inAir && out.length < max && Number.isFinite(s.y) && !has(id, "y")) out.push({ id, param: "y", min: Math.max(0.02, s.y - 0.15), max: s.y + 0.15, auto: true })
		}
		return out.slice(0, max)
	}
	function objective(ev, k, base) {
		if (!ev?.ok) return Infinity
		const S = ev.stages
		let broken = 0
		for (let j = 0; j < k; j++) if (S[j].check && base.stages[j]?.res?.ok === true && S[j].res?.ok !== true) broken++
		const worse = Math.max(0, ev.f.errors + ev.f.through - base.f.errors - base.f.through)
		const noisy = Math.max(0, ev.f.warnings + ev.f.floating - base.f.warnings - base.f.floating)
		let later = 0
		for (let j = k + 1; j < S.length; j++) later += S[j].check ? S[j].d : 0
		return 1000 * broken + 30 * worse + 3 * noisy + 10 * (S[k]?.d ?? 0) + 0.5 * later
	}
	async function searchStage(base, k, knobs, { maxRuns, deadline, signal }) {
		const plan = base.plan
		const stages = base.stages.map(({ res, d, ...s }) => s)
		const start = knobs.map((kn) => {
			const v = knobValue(plan, base.scene, kn)
			return v === null ? (kn.min + kn.max) / 2 : Math.min(kn.max, Math.max(kn.min, v))
		})
		const span = knobs.map((kn) => kn.max - kn.min)
		const cache = new Map()
		let runs = 0
		let best = { v: start, f: objective(base, k, base), ev: base }
		cache.set(JSON.stringify(start.map((x) => Math.round(x * 1e5))), best)
		const left = () => runs < maxRuns && now() < deadline && !signal?.aborted
		const passed = () => best.ev.stages[k]?.res?.ok === true && best.f < 1000
		async function at(v) {
			v = v.map((x, i) => Math.min(knobs[i].max, Math.max(knobs[i].min, x)))
			const key = JSON.stringify(v.map((x) => Math.round(x * 1e5)))
			if (cache.has(key)) return cache.get(key)
			if (!left()) return null
			runs++
			const p = clone(plan)
			knobs.forEach((kn, i) => setKnob(p, kn, Math.round(v[i] * 1e5) / 1e5))
			const ev = await evaluate(p, { stages, signal })
			const e = { v, f: objective(ev, k, base), ev }
			cache.set(key, e)
			if (e.f < best.f) best = e
			return e
		}
		const n = knobs.length
		let coarse = []
		if (n === 1) coarse = Array.from({ length: 9 }, (_, i) => [knobs[0].min + (span[0] * i) / 8])
		else if (n === 2) for (const a of [0.1, 0.5, 0.9]) for (const b of [0.1, 0.5, 0.9]) coarse.push([knobs[0].min + span[0] * a, knobs[1].min + span[1] * b])
		else for (let i = 1; i <= 14; i++) coarse.push(knobs.map((kn, j) => kn.min + span[j] * halton(i, [2, 3, 5, 7][j])))
		const dist = (a) => Math.hypot(...a.map((x, i) => (x - start[i]) / (span[i] || 1)))
		coarse.sort((a, b) => dist(a) - dist(b))
		for (let i = 0; i < coarse.length && left(); i += PAR) {
			const before = best
			await Promise.all(coarse.slice(i, i + PAR).map((v) => at(v)))
			if (passed() && best === before) break
		}
		let step = span.map((s) => s / (n === 1 ? 16 : 8))
		while (left() && !passed() && step.some((s, i) => s > span[i] / 300)) {
			const was = best
			const tries = []
			for (let i = 0; i < n; i++) for (const sg of [1, -1]) tries.push(best.v.map((x, j) => (j === i ? x + sg * step[i] : x)))
			await Promise.all(tries.map((v) => at(v)))
			if (best === was) step = step.map((s) => s / 2)
		}
		return { best: best.ev, runs, changed: knobs.map((kn, i) => ({ id: kn.id, param: kn.param, from: start[i], to: best.v[i], auto: !!kn.auto })).filter((c) => Math.abs(c.to - c.from) > 1e-6) }
	}

	/**
	 * Stage by stage: for the first failing stage, search its knobs (its own + auto) so its check passes without breaking an earlier one;
	 * keep the best; go on. Then the app's joint tuner (deps.tune) on what still fails, kept only when it loses no passing check.
	 * -> {ev, failStage (1-based or null), runs, ms, log}
	 */
	async function stageTune(plan, { from = null, maxRuns = 150, perStage = 30, maxMs = 90000, fromStage = 1, joint = true, signal } = {}) {
		const t0 = now()
		const deadline = t0 + maxMs
		let cur = from ?? (await evaluate(plan, { signal }))
		const log = []
		let runs = 0
		let failStage = null
		if (!cur.ok) return { ev: cur, failStage, runs, ms: now() - t0, log }
		for (let k = fromStage - 1; k < cur.stages.length; k++) {
			const st = cur.stages[k]
			if (!st.check || st.res?.ok === true) continue
			const own = (st.knobs ?? []).filter((kn) => num(kn.min) !== null && num(kn.max) !== null && kn.max > kn.min)
			const knobs = [...own.slice(0, 4), ...autoKnobs(cur.plan, cur.scene, st, { max: Math.max(0, 3 - own.length), have: own })].slice(0, 4).map((kn) => ({ id: kn.id, param: String(kn.param), min: num(kn.min), max: num(kn.max), auto: !!kn.auto }))
			if (!knobs.length || runs >= maxRuns || now() >= deadline) {
				failStage = st.stage
				log.push({ stage: st.stage, label: st.label, knobs, runs: 0, passed: false })
				break
			}
			const r = await searchStage(cur, k, knobs, { maxRuns: Math.min(perStage, maxRuns - runs), deadline, signal })
			runs += r.runs
			const ok = r.best.stages[k]?.res?.ok === true && objective(r.best, k, cur) < 1000
			log.push({ stage: st.stage, label: st.label, knobs, runs: r.runs, passed: ok, changed: r.changed })
			if (r.best !== cur && objective(r.best, k, cur) < objective(cur, k, cur)) cur = r.best
			if (!ok) {
				failStage = st.stage
				break
			}
		}
		if (joint && tune && cur.ok && (cur.f.goalsOk < cur.f.goals || cur.f.stagesOk < cur.f.stages) && (cur.plan.tune?.length ?? 0) > 0) {
			const tr = await tune({ plan: cur.plan, scene: cur.scene, sim: cur.sim, goals: cur.goalDefs, simulate, signal })
			runs += tr.runs ?? 0
			if (tr.changed?.length) {
				const b = await evaluate(tr.plan, { signal })
				const kept = b.ok && b.f.goalsOk + b.f.stagesOk > cur.f.goalsOk + cur.f.stagesOk && !lostChecks(cur, b).length && b.f.errors + b.f.through <= cur.f.errors + cur.f.through
				log.push({ joint: true, runs: tr.runs, kept })
				if (kept) {
					cur = b
					failStage = cur.stages.find((s) => s.check && s.res?.ok !== true)?.stage ?? null
				}
			}
		}
		return { ev: cur, failStage, runs, ms: now() - t0, log }
	}

	/** Verified by the physics: it has something to check, every goal and stage check passes, nothing builds badly. */
	const verified = (ev) => !!ev?.ok && ev.f.goals + ev.f.stages > 0 && ev.f.goalsOk === ev.f.goals && ev.f.stagesOk === ev.f.stages && ev.f.errors === 0 && ev.f.through === 0 && ev.f.floating === 0
	/** The loop guard: labels of goals and stage checks that pass in `a` and fail in `b` (a critic's or tuner's version that loses one is not taken). */
	function lostChecks(a, b) {
		if (!a?.ok) return []
		if (!b?.ok) return ["the new version does not build"]
		const out = []
		a.goals.forEach((g, i) => {
			if (g.ok === true && b.goals.find((x) => x.label === g.label)?.ok !== true) out.push(g.label)
		})
		a.stages.forEach((s) => {
			if (s.check && s.res?.ok === true && b.stages.find((x) => x.label === s.label)?.res?.ok !== true) out.push(s.label)
		})
		return [...new Set(out)]
	}

	/** The run around stage k (0-based), for the edit step's repair request: which checks pass, where the stage's things went, the hits. */
	function stageFacts(ev, k, tuneLog = null) {
		const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : "?")
		const S = ev.stages
		const st = S[k]
		const lines = ["The machine's checks, in order, in the physics engine's run (exact results, not estimates):"]
		for (const s of S) if (s.check) lines.push(`- Stage ${s.stage} “${s.label}”: ${s.res?.ok === true ? "WORKS" : "FAILS"} (${s.res?.detail ?? "?"})`)
		const { doc, track, summary } = ev.sim
		const names = new Map(ev.scene.items.map((i) => [i.id, i.name ?? i.type]))
		const ids = [...new Set([...(st.items ?? []), ...[st.check?.item, ...(st.check?.items ?? []), st.check?.target, st.check?.container].filter(Boolean)])]
		const pathOf = (id) => {
			const sids = doc.solids.filter((s) => s.item === id && s.kind === "dynamic").map((s) => s.id)
			if (!sids.length) return null
			return track.frames
				.map((f) => {
					const ps = sids.map((s) => f.placements[s]).filter(Boolean)
					return ps.length ? { t: f.t, x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length } : null
				})
				.filter(Boolean)
		}
		lines.push(`\nStage ${st.stage} “${st.label}” is the first that fails${st.does ? ` (it must: ${st.does})` : ""}. Its things in the run:`)
		const stories = new Map((summary?.stories ?? []).map((s) => [s.item, s]))
		for (const id of ids) {
			const it = ev.scene.items.find((i) => i.id === id)
			if (!it) continue
			const P = pathOf(id)
			const story = stories.get(id)
			if (!P?.length) {
				lines.push(`- ${names.get(id)} (${id}, ${it.type}): static, anchor at x ${r2(it.x)}, y ${r2(it.y)}`)
				continue
			}
			const a = P[0]
			const z = P.at(-1)
			const low = P.reduce((m, p) => (p.y < m.y ? p : m), a)
			lines.push(`- ${names.get(id)} (${id}, ${it.type}): starts at x ${r2(a.x)}, y ${r2(a.y)}; ${story?.moved_at != null ? `first moves at ${r2(story.moved_at)} s; top speed ${story.max_speed} m/s` : "never moves"}; ends at x ${r2(z.x)}, y ${r2(z.y)}; lowest at x ${r2(low.x)}, y ${r2(low.y)} at ${r2(low.t)} s`)
		}
		const c = st.check ?? {}
		const mover = c.item ?? c.items?.[0]
		const to = c.container ?? c.target
		const P = mover ? pathOf(mover) : null
		const T = to ? ev.scene.items.find((i) => i.id === to) : null
		if (P?.length && T) {
			const near = P.reduce((m, p) => (Math.hypot(p.x - T.x, p.y - T.y) < Math.hypot(m.x - T.x, m.y - T.y) ? p : m), P[0])
			lines.push(`- ${names.get(mover)} comes closest to ${names.get(to)} (anchor x ${r2(T.x)}, y ${r2(T.y)}) at ${r2(near.t)} s, at x ${r2(near.x)}, y ${r2(near.y)}${c.container ? `; it must come down INTO ${names.get(to)}'s opening from above` : ""}.`)
		}
		const evs = (summary?.events ?? []).filter((e) => ids.includes(e.a) || ids.includes(e.b)).slice(0, 10)
		lines.push(evs.length ? `Hits with them: ${evs.map((e) => `${e.text} at ${r2(e.t)} s${e.speed ? ` (${r2(e.speed)} m/s)` : ""}`).join("; ")}.` : "Nothing hits them during the run.")
		if (tuneLog?.knobs?.length) lines.push(`The tuner already tried ${tuneLog.runs} runs turning ${tuneLog.knobs.map((kn) => `${kn.id}.${kn.param} in ${r2(kn.min)}…${r2(kn.max)}`).join(", ")}, and the check still failed: a bigger change is needed.`)
		return lines.join("\n")
	}

	return { stagesOf, evaluate, checkDistance, autoKnobs, stageTune, verified, lostChecks, stageFacts }
}
