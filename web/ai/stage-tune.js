// Physics first (ai/DESIGN.md §13.2; the round-3 search experiment's winner, ai/experiments/search/integration/physics-first.js): a new scene's
// plan is tuned STAGE BY STAGE in the engine right after its first run, before the AI critic looks at it. For the first stage whose check fails,
// only that stage's knobs are searched (its own `tune` knobs plus knobs made from its things: where the receiver stands or its gap, a held
// thing's height, a ramp's top), so that its check passes without breaking an earlier stage, preferring versions where later checks come closer;
// the best is kept and the next failing stage is tuned. Then the app's joint tuner (orchestrator tune()) gets what still fails, kept only when it
// loses no check that passed. A plan without stages is tuned goal by goal the same way. Measured (26 cases × 2 runs): plans that work before any
// critic 52 % → 88 %, final success 0.87 → 0.92, build p50 51 → 44 s, about 0.5 s (p90 8 s) of engine runs and no model call.
//   import { createStageTuner } from "./stage-tune.js"
//   const st = createStageTuner({ solve, simulate, evalRun?, goalDistance, setKnob, tune?, safe?, parallel?, onProgress? })
//   const ev = await st.evaluate(plan, { pre: {solved, sim} })   // every goal and stage check on that run, with how far each failing one is
//   const t = await st.stageTune(plan, { from: ev })              // -> {ev, failStage, runs, ms, log}
//   st.verified(ev), st.lostChecks(a, b), st.stageFacts(ev, k, logEntry)
// The engine is deterministic: the same plan gives the same run. evalRun (optional, ./fix-pool.js workers) runs a candidate off the page's thread
// and sends back only its judgement ({goals, checks: [{res, d}], warnings}); the version kept is always run again on the app's own engine.
// stageTune always ends, even when a run never comes back (a fix worker's lost job hung every balanced-forces Build with AI of the video
// pipeline's batch, 19 Oct): each run it waits for is raced with a deadline, and at the deadline the runs still out are stopped (their signal).
// The stage search stops at maxMs; the joint tuner, when it starts before then, has jointMs of its own (as before that fix). So a stage tune
// takes about maxMs, or, when the joint tuner runs, about jointMs and a run or two from its start when that ends later (never more than
// maxMs + jointMs + 16 s), plus however late the page's thread is: the candidates are solved there, and the deadlines are its timers (at load
// 100–290, 12 of the 33 stored plans that needed tuning ran 0.5–10 s past a 30 s stage search, 20 Oct).
// Pure apart from the injected deps (no DOM), so ./fix-worker.js and node tests import it as is.
import { checkGoals, goalKind, goalItems, goalRefs } from "./goals.js"

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
const abortError = () => (typeof DOMException !== "undefined" ? new DOMException("Cancelled", "AbortError") : Object.assign(new Error("Cancelled"), { name: "AbortError" }))
const CUT = Symbol("cut") // (a run the tuner stopped waiting for: its time was up)
const JOINT_MS = 20000 // (the joint tuner's own time once it starts: the orchestrator's TUNE_MS, which it passes)
// (the joint tuner starts no run in the last JOINT_SLACK_MS of its time, so the ones it has out can come back: on a busy machine one of the
// app's runs can take seconds, and on origin/dev they were waited for however long they took)
const JOINT_SLACK_MS = 5000
const GRACE_MS = 500 // (the joint tuner, stopped at the end of its time, hands back what it found at once: this long, or it is left out)
const RUN_MS = 5000 // (one run the joint tuner's work needs (the whole run it starts from, the re-check of its answer) when its time is over by then)

/**
 * The tuner's time on top of the caller's signal. signal: aborts at the deadline, or with the caller's (a fix worker busy with that run is then
 * replaced). wait(promise, graceMs = 0): the promise's value, or CUT once the deadline has passed (and graceMs more, for a promise that settles
 * soon after its signal stops it: the joint tuner handing back its best), even when the promise never settles; the caller's own abort still
 * throws (AbortError). end(): stops the clock.
 */
function timeLimit(outer, deadline) {
	const ctl = new AbortController()
	let expire
	const expired = new Promise((r) => (expire = r))
	const stop = () => (expire(), ctl.abort())
	if (outer?.aborted) stop()
	else outer?.addEventListener?.("abort", stop, { once: true })
	const ms = deadline - now()
	const timer = ms < 2 ** 31 - 1 ? setTimeout(stop, Math.max(0, ms)) : 0
	return {
		signal: ctl.signal,
		async wait(p, graceMs = 0) {
			let r
			let late = 0
			let over = false
			const cut = expired.then(() => (graceMs > 0 && !over && !outer?.aborted ? new Promise((res) => (late = setTimeout(res, graceMs, CUT))) : CUT))
			try {
				r = await Promise.race([p, cut])
			} catch (e) {
				if (outer?.aborted || e?.name !== "AbortError" || !ctl.signal.aborted) throw e
				r = CUT // (stopped by the deadline)
			} finally {
				over = true
				clearTimeout(late)
			}
			if (outer?.aborted) throw abortError()
			return r
		},
		end() {
			clearTimeout(timer)
			outer?.removeEventListener?.("abort", stop)
		}
	}
}
/** f(signal)'s value in a time of its own (timeLimit(outer, deadline).wait), or CUT. */
async function within(outer, deadline, f, graceMs = 0) {
	const limit = timeLimit(outer, deadline)
	try {
		return await limit.wait(f(limit.signal), graceMs)
	} finally {
		limit.end()
	}
}

/** The closest two items came during a run (m, ≥ 0: centre distance minus their own sizes). */
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
/**
 * How far a check is from happening in a run: 0 when it holds, else 1 + 0.9 × how far (0..1). run: a whole run ({doc, track, summary}); scene:
 * the scene that ran; goalDistance: the orchestrator's (an "in" check: the item's distance to its container's inside over the run).
 */
export function checkDistance(check, res, run, scene, goalDistance) {
	if (res?.ok === true) return 0
	const kind = goalKind(check)
	if (kind === "falls" && res?.of > 0) return 1 + 0.9 * (1 - (res.fallen ?? 0) / res.of)
	if (kind === "moves" && Number.isFinite(res?.moved_m)) return 1 + 0.9 * Math.max(0, Math.min(1, 1 - res.moved_m / (num(check.min_m) ?? 0.05)))
	if (kind === "hits" && run?.doc && run?.track) {
		let best = Infinity
		for (const a of goalItems(check)) best = Math.min(best, closest(run.doc, run.track, a, check.target))
		return 1 + 0.9 * Math.min(1, Number.isFinite(best) ? best / 0.5 : 1)
	}
	if (kind === "in" && run?.summary && goalDistance) {
		const only = { ...run, summary: { ...run.summary, goals: (run.summary.goals ?? []).filter((g) => g.item === check.item && g.container === check.container) } }
		return only.summary.goals.length ? Math.min(1.9, goalDistance(scene, only)) : 1.9
	}
	return 1.9
}
/** A run judged for the stage tuner: the plan's goals and each stage's check on it ({goals, checks: [{res, d}], warnings}). Used in the page and
 *  in the fix workers alike, so both judge a run the same way. */
export function judgeRun(run, scene, goals, checks, goalDistance) {
	const g = checkGoals(goals ?? [], run)
	const c = (checks ?? []).map((check) => {
		const res = checkGoals([check], run)[0] ?? null
		return { res, d: checkDistance(check, res, run, scene, goalDistance) }
	})
	return { goals: g, checks: c, warnings: (run?.warnings ?? []).length }
}
/** The scene a version is judged on: its own, plus each "in" check of a goal or stage that the engine must check (never shown as a goal). */
export function runSceneOf(scene, checks) {
	const s = clone(scene)
	s.goals = Array.isArray(s.goals) ? s.goals : []
	for (const g of checks) if (g && goalKind(g) === "in" && typeof g.item === "string" && typeof g.container === "string" && !s.goals.some((x) => x?.item === g.item && x?.container === g.container)) s.goals.push({ item: g.item, container: g.container, label: String(g.label ?? "").slice(0, 200) })
	return s
}

export function createStageTuner(deps) {
	const { solve, simulate, goalDistance, setKnob, tune } = deps
	const evalRun = deps.evalRun ?? null
	const safe = deps.safe ?? ((knobs) => knobs)
	const PAR = Math.max(1, deps.parallel ?? 6)

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

	/**
	 * Solve + run a plan, every goal and stage check on that run. pre: {solved, sim} of this very plan (its run on the app's engine), reused when
	 * the checks need no more of the engine than that run gave; full: a whole run is wanted (for stageFacts or the joint tuner), else a candidate
	 * may be judged in a fix worker (evalRun) and come back without its track.
	 */
	async function evaluate(plan, { stages = null, signal, pre = null, full = false } = {}) {
		let solved = pre?.solved ?? null
		if (!solved)
			try {
				solved = solve(plan)
			} catch (e) {
				return { ok: false, plan, error: `solve: ${e.message}` }
			}
		const st = stages ?? stagesOf(plan)
		const goals = solved.goals ?? []
		const checks = st.map((s) => s.check).filter(Boolean)
		const runScene = runSceneOf(solved.scene, [...goals, ...checks])
		const sameRun = pre?.sim && JSON.stringify(runScene.goals) === JSON.stringify(solved.scene.goals ?? [])
		let sim = sameRun ? pre.sim : null
		let judged
		try {
			if (!sim && evalRun && !full) judged = await evalRun(runScene, goals, checks, signal)
			else {
				sim ??= await simulate(runScene, signal)
				judged = judgeRun(sim, runScene, goals, checks, goalDistance)
			}
		} catch (e) {
			if (e?.name === "AbortError") throw e
			return { ok: false, plan, solved, error: `engine: ${e.message}` }
		}
		let j = 0
		const stageRes = st.map((s) => {
			if (!s.check) return { ...s, res: null, d: 0 }
			const r = judged.checks[j++] ?? { res: null, d: 1.9 }
			return { ...s, res: r.res, d: r.d }
		})
		const issues = solved.issues ?? []
		const f = {
			errors: (solved.errors ?? []).length,
			warnings: judged.warnings,
			floating: issues.filter((i) => FLOAT_CODES.includes(i.code)).length,
			through: issues.filter((i) => i.level !== "info" && PASS_CODES.includes(i.code)).length,
			goals: judged.goals.length,
			goalsOk: judged.goals.filter((g) => g.ok === true).length,
			stages: stageRes.filter((s) => s.check).length,
			stagesOk: stageRes.filter((s) => s.check && s.res?.ok === true).length
		}
		return { ok: true, plan, solved, scene: solved.scene, runScene, sim, goals: judged.goals, goalDefs: goals, stages: stageRes, f }
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
	async function searchStage(base, k, knobs, { maxRuns, deadline, signal, limit, onRun }) {
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
			const ev = await limit.wait(evaluate(p, { stages, signal: limit.signal }))
			// (it didn't come back in the tuner's time: not a run, and nothing is known of that version)
			if (ev === CUT) return runs--, null
			const e = { v, f: objective(ev, k, base), ev }
			cache.set(key, e)
			if (e.f < best.f) best = e
			onRun?.(runs, best.ev.stages[k]?.res?.ok === true)
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
	 * Stage by stage: for the first failing stage, search its knobs (its own + auto) so its check passes without breaking an earlier one; keep the
	 * best; go on. Then the app's joint tuner (deps.tune) on what still fails, kept only when it loses no passing check.
	 * onProgress({runs, stage, of, label, passed}) after each engine run. -> {ev, failStage (1-based or null), runs, ms, log}
	 * The stage search ends at maxMs: a run still out then is stopped and left out (not counted), and the best found so far is kept. The joint
	 * tuner, when it starts before then, has jointMs of its own (or what is left of maxMs when that is more; the module's head says how long the
	 * whole may take). The caller's signal still cancels it (AbortError).
	 */
	async function stageTune(plan, { from = null, maxRuns = 150, perStage = 30, maxMs = 90000, jointMs = JOINT_MS, fromStage = 1, joint = true, signal, onProgress } = {}) {
		const t0 = now()
		const deadline = t0 + maxMs
		const limit = timeLimit(signal, deadline)
		try {
			let cur = from ?? (await limit.wait(evaluate(plan, { signal: limit.signal })))
			const log = []
			let runs = 0
			let failStage = null
			if (cur === CUT) cur = { ok: false, plan, error: `the stage tuner's ${Math.round(maxMs / 1000)} s ran out` }
			if (!cur.ok) return { ev: cur, failStage, runs, ms: now() - t0, log }
			const of = cur.stages.filter((s) => s.check).length
			for (let k = fromStage - 1; k < cur.stages.length; k++) {
				const st = cur.stages[k]
				if (!st.check || st.res?.ok === true) continue
				const own = safe(st.knobs ?? [], cur).filter((kn) => num(kn.min) !== null && num(kn.max) !== null && kn.max > kn.min)
				const knobs = [...own.slice(0, 4), ...autoKnobs(cur.plan, cur.scene, st, { max: Math.max(0, 3 - own.length), have: own })].slice(0, 4).map((kn) => ({ id: kn.id, param: String(kn.param), min: num(kn.min), max: num(kn.max), auto: !!kn.auto }))
				if (!knobs.length || runs >= maxRuns || now() >= deadline) {
					failStage = st.stage
					log.push({ stage: st.stage, label: st.label, knobs, runs: 0, passed: false })
					break
				}
				const before = runs
				const r = await searchStage(cur, k, knobs, { maxRuns: Math.min(perStage, maxRuns - runs), deadline, signal, limit, onRun: (n, ok) => onProgress?.({ runs: before + n, stage: st.stage, of, label: st.label, passed: ok }) })
				runs += r.runs
				const ok = r.best.stages[k]?.res?.ok === true && objective(r.best, k, cur) < 1000
				log.push({ stage: st.stage, label: st.label, knobs, runs: r.runs, passed: ok, changed: r.changed })
				if (r.best !== cur && objective(r.best, k, cur) < objective(cur, k, cur)) cur = r.best
				if (!ok) {
					failStage = st.stage
					break
				}
			}
			if (joint && tune && cur.ok && (cur.f.goalsOk < cur.f.goals || cur.f.stagesOk < cur.f.stages) && (cur.plan.tune?.length ?? 0) > 0 && now() < deadline && !signal?.aborted) {
				// (the joint tuner has a time of its own, as before the hang fix: jointMs from its start (+ the slack for its last runs), or what is
				// left of maxMs when that is more. 20 Oct: given only what was left of maxMs, it ran in 1 of 33 stored plans that needed tuning
				// against 9 on origin/dev, and the chains lost what it found there. First the whole run of the version it starts from: in the stage
				// tuner's time, or RUN_MS when that is over)
				const whole = cur.sim ? cur : await within(signal, Math.max(deadline, now() + RUN_MS), (sg) => evaluate(cur.plan, { stages: cur.stages.map(({ res, d, ...s }) => s), signal: sg, full: true }))
				if (whole !== CUT && whole.ok) {
					cur = whole
					// (it starts no run in the last JOINT_SLACK_MS, so the ones out can come back; at the end those still out are stopped, and it hands
					// back the best it found (keep): a version that passes, found before the end, is not lost)
					const jEnd = Math.max(deadline, now() + jointMs + JOINT_SLACK_MS)
					const tr = await within(signal, jEnd, (sg) => tune({ plan: cur.plan, scene: cur.scene, sim: cur.sim, goals: cur.goalDefs, simulate, signal: sg, keep: true, maxMs: Math.max(0, Math.min(jointMs, jEnd - now() - JOINT_SLACK_MS)) }), GRACE_MS)
					if (tr !== CUT) runs += tr.runs ?? 0
					// (its answer run once more, judged as the stage search's were: in the joint tuner's time, or RUN_MS when that is over)
					const b = tr !== CUT && tr.changed?.length ? await within(signal, Math.max(jEnd, now() + RUN_MS), (sg) => evaluate(tr.plan, { signal: sg })) : CUT
					if (b !== CUT) {
						const kept = b.ok && b.f.goalsOk + b.f.stagesOk > cur.f.goalsOk + cur.f.stagesOk && !lostChecks(cur, b).length && b.f.errors + b.f.through <= cur.f.errors + cur.f.through
						log.push({ joint: true, runs: tr.runs, kept, changed: tr.changed })
						if (kept) {
							cur = b
							failStage = cur.stages.find((s) => s.check && s.res?.ok !== true)?.stage ?? null
						}
					}
				}
			}
			if (failStage === null) failStage = cur.stages.find((s) => s.check && s.res?.ok !== true)?.stage ?? null
			return { ev: cur, failStage, runs, ms: now() - t0, log }
		} finally {
			limit.end()
		}
	}

	/** Verified by the physics: it has something to check, every goal and stage check passes, nothing builds badly. */
	const verified = (ev) => !!ev?.ok && ev.f.goals + ev.f.stages > 0 && ev.f.goalsOk === ev.f.goals && ev.f.stagesOk === ev.f.stages && ev.f.errors === 0 && ev.f.through === 0 && ev.f.floating === 0
	/** The loop guard: labels of goals and stage checks that pass in `a` and fail in `b` (a critic's or tuner's version that loses one is not taken). */
	function lostChecks(a, b) {
		if (!a?.ok) return []
		if (!b?.ok) return ["the new version does not build"]
		const out = []
		a.goals.forEach((g) => {
			if (g.ok === true && b.goals.find((x) => x.label === g.label)?.ok !== true) out.push(g.label)
		})
		a.stages.forEach((s) => {
			if (s.check && s.res?.ok === true && b.stages.find((x) => x.label === s.label)?.res?.ok !== true) out.push(s.label)
		})
		return [...new Set(out)]
	}

	/** The run around stage k (0-based), for the critic: which checks pass, where the stage's things went, the hits, what the tuner tried. Needs a whole run (ev.sim). */
	function stageFacts(ev, k, tuneLog = null) {
		const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : "?")
		const S = ev.stages
		const st = S[k]
		const lines = ["The machine's checks, in order, in the physics engine's run (exact results, not estimates):"]
		for (const s of S) if (s.check) lines.push(`- Stage ${s.stage} “${s.label}”: ${s.res?.ok === true ? "WORKS" : "FAILS"} (${s.res?.detail ?? "?"})`)
		if (!ev.sim?.doc || !ev.sim?.track) return lines.join("\n")
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
		for (const id of ids.slice(0, 8)) {
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

	return { stagesOf, evaluate, autoKnobs, stageTune, verified, lostChecks, stageFacts }
}
