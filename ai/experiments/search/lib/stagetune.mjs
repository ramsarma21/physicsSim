// Tuning a plan against the physics.
//  shippedTune: the app's own tuner (frozen web/ai/orchestrator.js tune(): ≤ 4 of plan.tune's knobs, ≤ 40 runs, for the goals).
//  stageTune:   stage by stage (the hand-tuned starter's method, machines/search.py, made general): for the first stage whose check fails, search
//               only that stage's knobs (its own `tune` knobs plus knobs made from its items: where the receiver stands, a gap, a held thing's
//               height, a ramp's top) so that its check passes WITHOUT breaking an earlier stage, preferring versions where more later checks
//               pass; keep the best, go on to the next failing stage. A plan without stages is tuned goal by goal the same way.
//  Objective (lower is better), lexicographic in effect: 1000 × earlier stages broken + 30 × solver errors/pass-throughs added + 3 × run
//  warnings or floating things added + 10 × the stage's distance (0 when it passes, else 1..1.9) + 0.5 × the later stages' distances.
import { clone, isObj, log, num, now, orch, simulate } from "./infra.mjs"
import { evaluate, stagesOf } from "./physics.mjs"

const TABLE = { x0: -0.5, x1: 3.1 }
const PAR = 6

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

/** Knobs made from a stage's own items when its plan gave too few: the receiver first (where the target or container stands), then the mover. */
export function autoKnobs(plan, scene, stage, { max = 3, have = [] } = {}) {
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
		if (!it || !s || !isObj(it.place)) continue
		const P = it.place
		if (P.inside) continue
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

/** The objective of a version for stage index k (0-based into ev.stages), against the base version's counts. */
function objective(ev, k, base) {
	if (!ev?.ok) return Infinity
	const S = ev.stages
	let broken = 0
	for (let j = 0; j < k; j++) if (S[j].check && base.stages[j]?.res?.ok === true && S[j].res?.ok !== true) broken++
	const f = ev.f
	const worse = Math.max(0, f.errors + f.through - base.f.errors - base.f.through)
	const noisy = Math.max(0, f.warnings + f.floating - base.f.warnings - base.f.floating)
	let later = 0
	for (let j = k + 1; j < S.length; j++) later += S[j].check ? S[j].d : 0
	return 1000 * broken + 30 * worse + 3 * noisy + 10 * (S[k]?.d ?? 0) + 0.5 * later
}

/**
 * Search one stage's knobs. -> {best (an evaluate() result), runs, knobs}. `base` is the version the search starts from (its knobs' values are
 * the start; earlier stages that pass in it must keep passing).
 */
async function searchStage(base, k, knobs, { maxRuns = 30, deadline }) {
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
	const left = () => runs < maxRuns && now() < deadline
	const passed = () => best.ev.stages[k]?.res?.ok === true && best.f < 1000
	async function at(v) {
		v = v.map((x, i) => Math.min(knobs[i].max, Math.max(knobs[i].min, x)))
		const key = JSON.stringify(v.map((x) => Math.round(x * 1e5)))
		if (cache.has(key)) return cache.get(key)
		if (!left()) return null
		runs++
		const p = clone(plan)
		knobs.forEach((kn, i) => orch.setKnob(p, kn, Math.round(v[i] * 1e5) / 1e5))
		const ev = await evaluate(p, { stages })
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
	// the coarse sweep in parallel batches; it stops early once the stage passes and a batch found nothing better
	for (let i = 0; i < coarse.length && left(); i += PAR) {
		const before = best
		await Promise.all(coarse.slice(i, i + PAR).map((v) => at(v)))
		if (passed() && best === before) break
	}
	// a pattern search around the best, halving the step
	let step = span.map((s) => s / (n === 1 ? 16 : 8))
	while (left() && !passed() && step.some((s, i) => s > span[i] / 300)) {
		const was = best
		const tries = []
		for (let i = 0; i < n; i++)
			for (const sg of [1, -1]) {
				const v = [...best.v]
				v[i] += sg * step[i]
				tries.push(v)
			}
		await Promise.all(tries.map((v) => at(v)))
		if (best === was) step = step.map((s) => s / 2)
	}
	return { best: best.ev, runs, changed: knobs.map((kn, i) => ({ id: kn.id, param: kn.param, from: Math.round(start[i] * 1e4) / 1e4, to: Math.round(best.v[i] * 1e4) / 1e4, auto: !!kn.auto })).filter((c) => Math.abs(c.to - c.from) > 1e-6) }
}

/**
 * Stage-by-stage tuning. -> {ev (the best version), stages: [{stage, label, knobs, runs, passed, changed}], runs, ms, failStage (1-based, the
 * first stage that still fails, or null), firstEv}
 * opts: from (an evaluate() result to start from), maxRuns (all stages), perStage, maxMs, fromStage (1-based: earlier stages are taken as they are)
 */
export async function stageTune(plan, { from = null, maxRuns = 150, perStage = 30, maxMs = 90000, fromStage = 1, label = "" } = {}) {
	const t0 = now()
	const deadline = t0 + maxMs
	let cur = from ?? (await evaluate(plan))
	const firstEv = cur
	const log1 = []
	if (!cur.ok) return { ev: cur, stages: log1, runs: 0, ms: now() - t0, failStage: null, firstEv }
	let runs = 0
	for (let k = fromStage - 1; k < cur.stages.length; k++) {
		const st = cur.stages[k]
		if (!st.check || st.res?.ok === true) continue
		const own = (st.knobs ?? []).filter((kn) => isObj(kn) && num(kn.min) !== null && num(kn.max) !== null && kn.max > kn.min)
		const auto = autoKnobs(cur.plan, cur.scene, st, { max: Math.max(0, 3 - own.length), have: own })
		const knobs = [...own.slice(0, 4), ...auto].slice(0, 4).map((kn) => ({ id: kn.id, param: String(kn.param), min: num(kn.min), max: num(kn.max), auto: !!kn.auto }))
		if (!knobs.length || runs >= maxRuns || now() >= deadline) {
			log1.push({ stage: st.stage, label: st.label, knobs: [], runs: 0, passed: false, why: knobs.length ? "budget" : "no knobs" })
			return { ev: cur, stages: log1, runs, ms: now() - t0, failStage: st.stage, firstEv }
		}
		const r = await searchStage(cur, k, knobs, { maxRuns: Math.min(perStage, maxRuns - runs), deadline })
		runs += r.runs
		const ok = r.best.stages[k]?.res?.ok === true && objective(r.best, k, cur) < 1000
		log1.push({ stage: st.stage, label: st.label, knobs, runs: r.runs, passed: ok, changed: r.changed, detail: r.best.stages[k]?.res?.detail ?? null })
		if (r.best !== cur && objective(r.best, k, cur) < objective(cur, k, cur)) cur = r.best
		if (!ok) return { ev: cur, stages: log1, runs, ms: now() - t0, failStage: st.stage, firstEv }
	}
	return { ev: cur, stages: log1, runs, ms: now() - t0, failStage: null, firstEv }
}

/** The app's own tuner on a plan (as the pipeline runs it after the critic; here before). -> {ev, runs, ms, changed} */
export async function shippedTune(plan, { from = null } = {}) {
	const t0 = now()
	const ev = from ?? (await evaluate(plan))
	if (!ev.ok) return { ev, runs: 0, ms: 0, changed: [] }
	const failing = ev.goals.some((g) => g.ok !== true)
	if (!failing || !(plan.tune?.length > 0)) return { ev, runs: 0, ms: now() - t0, changed: [] }
	const tr = await orch.tune({ plan: ev.plan, scene: ev.scene, sim: ev.sim, goals: ev.goalDefs, simulate: (s, sig) => simulate(s, sig) })
	if (!tr.changed.length) return { ev, runs: tr.runs, ms: now() - t0, changed: [] }
	const ev2 = await evaluate(tr.plan)
	return { ev: ev2.ok ? ev2 : ev, runs: tr.runs, ms: now() - t0, changed: tr.changed }
}
