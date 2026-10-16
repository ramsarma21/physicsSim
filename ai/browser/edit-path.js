// The edit path for web/ai/orchestrator.js (the browser), ai/DESIGN.md §14.2 (1)-(7): measured in ai/experiments/edit as arm n7, repaired
// 2026-10-15 night (applyEdit v4, the aim rule, shortfalls). It replaces, for mode "edit", "applyPatches -> solve -> quick path | tuner |
// critic with renders". Browser-ready, deps injected.
//   import { runEdit } from "./edit-path.js"
//   const out = await runEdit(request, deps)
//   // {replyOnly, scene, plan, sim, reply, kind, targets, heads (what stopped happening in the run), won, failing, madeRoom, shortfalls,
//   //  diffWords, answer, calls} | {replyOnly: true, reply, kind, targets, undo?, answer, calls}
// request: {text, scene, plan (only when the scene on screen is that plan's result; applyEdit checks it again), history ([{role, text}], the
//   last ≤ 20 turns as shown), lastChange? ({patches, targets} of the previous AI change: "make it work again" never undoes it; else the
//   last assistant turn's own `patches` / `targets` when the client keeps them there), sim (the run of the scene on screen)}
// deps: {
//   edit(payload) -> the edit step's answer (POST /api/ai/edit; payload {text, scene, plan, history, intent: "edit", feedback?}),
//   simulate(scene) -> a run, applyDeps (apply-edit.js deps: solve, planFromScene, isStaticItem, applyPatches, digestScene, layout),
//   goalResults, lostStages, tune, goalDistance (orchestrator.js), describeDiff (orchestrator.js: the exact change in words), propSpec,
//   propDefault (solver.js) }
// The flow:
//  1. one edit call (kind + targets); ask / answer / undo / new -> the reply only, nothing rebuilt;
//  2. applyEdit: the change and nothing else (untouched items byte for byte), every changed thing exactly where its patch asked;
//  3. things that now start inside each other, stand past the table's end, or that the solver could not place -> ONE repair call naming
//     them (and how far the solver could move the thing), kept when it is no worse; if they remain and the solver could have made room by
//     placing the thing a little short of the asked spot, that version is used and the card says so ("Seesaw moved only 6.9 cm left (not
//     10.0 cm left): to clear Dominoes"); a thing the solver still cannot place is not applied (the reply says why);
//  4. one physics run; what stopped happening (goals, stages, hits) is appended to the reply ("Heads-up, in the new run: ...") with an
//     offer to make it work again; plain changes never get the critic, the tuner or renders (the fast path for every change);
//  5. kind "fix": (a) a container aimed at where the thing now comes down, alone, unless the user's last turn or the previous AI change
//     touched that container; (b) else ≤ 2 more edit calls told the run's result; (c) the tuner (≤ 120 runs, 45 s) on the answers' knobs
//     (option widen: ranges widened to include the scene's own values, and a start from the scene as it was); the best version is kept and
//     the reply says honestly what still fails (option neverWorse: versions ranked by goalDistance, and nothing applied when nothing beats
//     no change).
import { applyEdit } from "./apply-edit.js"
import { aimContainer } from "./aim-container.js"

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)))
const and = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const FIRM = 0.3
const FIX_RE = /\b(make (it|this|them|everything) work|works? again|fix|so (that|it)|get it (to )?work|still work)\b/i
const fmt = (m) => (Math.abs(m) >= 1 ? `${Math.abs(m).toFixed(2)} m` : `${(Math.abs(m) * 100).toFixed(1)} cm`)
// (words of a name that do not name the thing: "the red ball" is not the "Red cup"; "Wicker basket" is named by "basket" or "wicker")
const NAME_STOP = new Set(["the", "and", "with", "for", "big", "small", "large", "little", "tall", "short", "wide", "long", "left", "right", "top", "bottom", "middle", "new", "old", "one", "two", "three", "first", "second", "last", "red", "blue", "green", "yellow", "white", "black", "orange", "purple", "pink", "grey", "gray", "brown", "silver", "gold", "clear", "dark", "light", "wooden", "wood", "metal", "steel", "plastic", "paper", "glass"])

/** The app's goals: the plan's (every kind), else the scene's own "in" goals. */
const appGoals = (scene, plan) => (plan?.goals?.length ? plan.goals : (scene.goals ?? []).map((g) => ({ ...g, kind: g.kind ?? "in" })))

function withGoals(scene, goals) {
	const s = clone(scene)
	const ids = new Set(s.items.map((i) => i.id))
	s.goals = (s.goals ?? []).filter((g) => ids.has(g.item) && ids.has(g.container))
	for (const g of goals ?? []) if ((g.kind ?? "in") === "in" && ids.has(g.item) && ids.has(g.container) && !s.goals.some((x) => x.item === g.item && x.container === g.container)) s.goals.push({ kind: "in", item: g.item, container: g.container, label: g.label })
	return s
}

/** What stopped happening between two runs: goals, stages, firm hits between things that are still there. */
function runDelta(before, beforeScene, after, afterScene, goals, deps) {
	const lost = []
	const won = []
	const ra = deps.goalResults(before, goals)
	const rb = deps.goalResults(after, goals)
	for (const g of rb) {
		const w = ra.find((x) => x.label === g.label)
		if (w?.ok === true && g.ok !== true) lost.push(`“${g.label}” no longer happens${g.detail ? ` (${g.detail})` : ""}`)
		if (w && w.ok !== true && g.ok === true) won.push(`“${g.label}” now happens`)
	}
	const goalsLost = lost.length
	lost.push(...deps.lostStages(before, after, afterScene))
	const ids = new Set(afterScene.items.map((i) => i.id))
	const nameOf = (id) => afterScene.items.find((i) => i.id === id)?.name ?? beforeScene.items.find((i) => i.id === id)?.name ?? id
	const scenery = (id) => id === "table" || /^wall-/.test(id)
	const pairs = (sim) => {
		const m = new Map()
		for (const e of sim?.summary?.events ?? []) if (!scenery(e.a) && !scenery(e.b) && (e.speed ?? 1) >= FIRM) m.set([e.a, e.b].sort().join("|"), e)
		return m
	}
	const pb = pairs(after)
	for (const [k, e] of pairs(before)) if (!pb.has(k) && ids.has(e.a) && ids.has(e.b)) lost.push(`${nameOf(e.a)} no longer hits ${nameOf(e.b)}`)
	const all = [...new Set(lost)]
	return { lost: all.slice(0, 6), headline: all.slice(0, Math.max(3, goalsLost)), won, results: rb }
}

/** The ids the previous AI change touched (its patches and targets): "make it work again" never undoes them by aiming. */
function lastChangeIds(request) {
	const last = request.lastChange ?? [...(request.history ?? [])].reverse().find((h) => h?.role === "assistant" && (Array.isArray(h.patches) || Array.isArray(h.targets)))
	const ids = new Set()
	for (const p of Array.isArray(last?.patches) ? last.patches : []) for (const id of Array.isArray(p?.ids) ? p.ids : [p?.id, p?.item?.id]) if (typeof id === "string") ids.add(id)
	for (const t of Array.isArray(last?.targets) ? last.targets : []) for (const id of Array.isArray(t?.ids) ? t.ids : []) if (typeof id === "string") ids.add(id)
	return ids
}
/** Does the user's turn name this item: any word of its name (≥ 3 letters) or its kind's word ("basket" for "Wicker basket", "cup" for a plastic-cup)? */
export function namedInTurn(item, turn) {
	if (!item || !turn) return false
	const words = new Set(
		String(item.name ?? "")
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((w) => w.length >= 3 && !NAME_STOP.has(w))
	)
	const kind = String(item.type ?? "").toLowerCase().split("-").at(-1)
	if (kind && kind.length >= 3) words.add(kind)
	const t = String(turn).toLowerCase()
	return [...words].some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(e?s)?\\b`, "u").test(t))
}

export async function runEdit(request, deps, { widen = false, neverWorse = false } = {}) {
	// (defaults = the measured arm n7; widen + neverWorse = arm n9: 17/20 against 16/20 on the "make it work" samples, a tie at this n)
	const calls = []
	const base = { scene: request.scene, plan: request.plan ?? null }
	const goals = appGoals(request.scene, request.plan)
	const history = (request.history ?? []).filter((h) => isObj(h) && typeof h.text === "string").slice(-20).map((h) => ({ role: h.role, text: h.text }))
	const call = async (feedback = null) => {
		const t0 = Date.now()
		const a = await deps.edit({ text: request.text, scene: request.scene, plan: request.plan ?? undefined, history, intent: "edit", ...(feedback ? { feedback } : {}) })
		calls.push({ step: feedback ? "edit-again" : "edit", ms: Date.now() - t0 })
		return a
	}
	const ans = await call()
	const kind = ans.kind ?? (ans.undo ? "undo" : Array.isArray(ans.patches) && !ans.patches.length ? "answer" : FIX_RE.test(request.text) ? "fix" : "change")
	if (ans.mode === "new" || !Array.isArray(ans.patches) || !ans.patches.length) return { replyOnly: true, reply: ans.reply ?? "", kind, targets: ans.targets ?? null, undo: ans.undo === true, answer: ans, calls }

	const diffWords = (scene) => (deps.describeDiff ? deps.describeDiff(request.scene, scene) : [])
	const version = async (a, opts = {}) => {
		const r = applyEdit(base, a.patches, deps.applyDeps, opts)
		if (r.error) return { error: r.error, ans: a, r }
		const sim = await deps.simulate(withGoals(r.scene, r.plan?.goals?.length ? r.plan.goals : goals))
		const g = r.plan?.goals?.length ? r.plan.goals : goals
		const delta = runDelta(request.sim, request.scene, sim, r.scene, g, deps)
		const failing = delta.results.filter((x) => x.ok !== true)
		const problems = [...(r.overlaps ?? []), ...(r.errors ?? [])]
		return { ans: a, r, sim, delta, failing, overlaps: r.overlaps ?? [], errors: r.errors ?? [], problems, bad: failing.length + problems.length, diff: diffWords(r.scene) }
	}
	const score = (x) => (x.error ? Infinity : x.bad * 10 + (deps.goalDistance?.(x.r.scene, x.sim, x.r.plan?.goals?.length ? x.r.plan.goals : goals) || 0))
	const better = (a, b) => (neverWorse ? score(a) < score(b) - 1e-9 : a.bad < b.bad || (a.bad === b.bad && a.diff.length < b.diff.length))
	let v = await version(ans)
	if (v.error) return { replyOnly: true, reply: `${ans.reply ?? ""} (It couldn't be placed: ${v.error})`, kind, error: v.error, answer: ans, calls }

	// ---- 3. a change that makes things start inside each other, stand off the table, or that the solver cannot place: one repair turn
	if (v.problems.length) {
		const short = (v.r.shortfalls ?? []).map((f) => `- ${f.name} could go only ${fmt(f.solver.dx)} ${f.solver.dx >= 0 ? "right" : "left"} of where it was${f.why ? ` (${f.why})` : ""}, not the ${fmt(f.asked.dx)} asked.`)
		const lines = [
			...v.overlaps.map((w) => `- ${w.text}: they must not start inside each other (or off the table). Make the asked change fit (e.g. its spacing, size or place) or move the neighbour the least that makes room, and say so.`),
			...v.errors.map((e) => `- ${e.text}: it cannot be placed like that. Make the asked change in a way that can be placed, or say why it cannot.`),
			...short
		]
		const fb = `# A check of your last answer found problems\nYou sent: ${JSON.stringify(v.ans.patches)}\nWhat it changed in the scene: ${v.diff.join("; ") || "nothing"}\nProblems:\n${lines.join("\n")}\nAnswer again: the WHOLE set of patches against the scene above (the scene before your first answer), doing exactly what the request asks${kind === "fix" ? " (and making it work)" : ""}. If the request is a question or truly ambiguous, change nothing.`
		const a2 = await call(fb)
		if (Array.isArray(a2.patches) && a2.patches.length) {
			const v2 = await version(a2)
			if (!v2.error && !(kind === "fix" && v2.failing.length > v.failing.length) && v2.problems.length <= v.problems.length) v = v2
		} else if (a2.kind === "ask" || a2.kind === "answer") return { replyOnly: true, reply: a2.reply ?? "", kind: a2.kind, targets: a2.targets ?? null, answer: a2, calls }
		// still there: where the solver could put the thing, said on the card, when that clears it
		if (v.overlaps.length && v.r.shortfalls?.length) {
			const vy = await version(v.ans, { exact: false })
			if (!vy.error && vy.problems.length < v.problems.length) v = vy
		}
		// a thing the solver cannot place at all is never put on the table
		if (v.errors.length) return { replyOnly: true, reply: `I couldn't make that change: ${and(v.errors.map((e) => e.text.replace(/\.$/, "")))}. Nothing was changed.`, kind, failing: [], answer: v.ans, calls }
	}

	// ---- 5. make it work
	if (kind === "fix") {
		let fixed = null
		// (a) the container alone, aimed (never one the user's last turn named or the previous AI change touched)
		const lastTurn = [...history].reverse().find((h) => h.role === "user")?.text ?? ""
		const theirs = lastChangeIds(request)
		const v0 = await version({ ...ans, patches: [] })
		if (!v0.error && v0.failing.length)
			for (const g of v0.failing.filter((x) => (x.kind ?? "in") === "in" && x.container)) {
				const it = request.scene.items.find((i) => i.id === g.container)
				const name = it?.name ?? g.container
				if (theirs.has(g.container) || namedInTurn(it, lastTurn)) continue
				const r = await aimContainer(base, g, { simulate: deps.simulate, apply: (ps) => applyEdit(base, ps, deps.applyDeps), isStaticItem: deps.applyDeps.isStaticItem, digestScene: deps.applyDeps.digestScene })
				if (r?.patches) {
					const p = r.patches[0]
					const words = [p.dx ? `${Math.abs(p.dx * 100).toFixed(0)} cm ${p.dx > 0 ? "right" : "left"}` : null, p.dy ? `${Math.abs(p.dy * 100).toFixed(0)} cm ${p.dy > 0 ? "up" : "down"}` : null].filter(Boolean).join(" and ")
					const v3 = await version({ ...ans, patches: r.patches, reply: `I moved ${/^the /i.test(name) ? name : `the ${name.toLowerCase()}`} ${words}, to where the ball now comes down, so “${g.label}” works again. Nothing else changed.` })
					if (!v3.error && v3.bad < v0.bad) {
						fixed = v3
						break
					}
				}
			}
		if (fixed) v = fixed
		else {
			// (b) ≤ 2 more edit calls, told the run's result
			let last = v
			for (let round = 0; round < 2 && v.bad; round++) {
				const hits = (last.sim.summary?.events ?? []).slice(0, 16).map((e) => `${e.t.toFixed(2)} s ${e.text}${e.speed != null ? ` (${e.speed.toFixed(2)} m/s)` : ""}`).join("; ")
				const fb = `# Your last answer was applied and run\nYou sent: ${JSON.stringify(last.ans.patches)}\nWhat changed: ${last.diff.join("; ") || "nothing"}\nIn its run: ${last.failing.map((g) => `FAILED: ${g.label}${g.detail ? ` (${g.detail})` : ""}`).join("; ") || "every goal met"}.${last.problems.length ? ` At the start: ${last.problems.map((w) => w.text).join("; ")} (not allowed: things must not start inside each other).` : ""} Hits in order: ${hits || "none"}.\nIt still does not work. Answer again with the WHOLE set of patches against the scene above (the scene before your first answer), changing what the run shows is wrong, by enough to make it work; keep the things the user chose. Give set_tune knobs (with ranges) on what you change, so a tuner can finish the job.`
				const a2 = await call(fb)
				if (!Array.isArray(a2.patches) || !a2.patches.length) break
				const v2 = await version(a2)
				if (v2.error) continue
				last = v2
				if (better(v2, v)) v = v2
			}
			// (c) the tuner, knobs widened to include the scene's own values, from the answer and from the scene as it was
			const widened = (plan) => {
				const p = clone(plan)
				p.tune = (p.tune ?? []).map((k) => {
					const it0 = request.scene.items.find((i) => i.id === k.id)
					const was = !it0 ? null : k.param === "x" ? it0.x : k.param === "y" || k.param === "y_m" ? it0.y : k.param === "angle" || k.param === "angle_deg" ? it0.angle ?? 0 : it0.props?.[k.param] ?? deps.propDefault?.(it0.type, k.param)
					if (typeof was !== "number") return k
					const span = Math.max(Math.abs(k.max - k.min), Math.abs(was) * 0.5, 0.05)
					const spec = deps.propSpec?.(it0.type, k.param)
					const lo = Math.max(Math.min(k.min, was - span / 2), spec?.min ?? -Infinity)
					const hi = Math.min(Math.max(k.max, was + span / 2), spec?.max ?? Infinity)
					return lo < hi ? { ...k, min: lo, max: hi } : k
				})
				return p
			}
			const from = [...new Set([v, last])]
			if (widen && v.failing.length) {
				const vb = await version({ ...v.ans, patches: (v.ans.patches ?? []).filter((p) => p.op === "set_tune") })
				if (!vb.error) from.push(vb)
			}
			for (const cand of from) {
				if (!v.failing.length || v.problems.length) break
				if (!cand.r.plan?.tune?.length) continue
				const tr = await deps.tune({ plan: widen ? widened(cand.r.plan) : cand.r.plan, scene: cand.r.scene, sim: cand.sim, goals: cand.r.plan.goals?.length ? cand.r.plan.goals : goals, simulate: deps.simulate, maxRuns: 120, maxMs: 45000 })
				calls.push({ step: "tune", runs: tr.runs, changed: tr.changed?.length ?? 0 })
				if (!tr.changed?.length) continue
				const knob = tr.changed.map((k) => (k.param === "x" ? { op: "move", id: k.id, x: k.to } : k.param === "y" || k.param === "y_m" ? { op: "move", id: k.id, y_m: k.to } : k.param === "angle" || k.param === "angle_deg" ? { op: "move", id: k.id, angle_deg: k.to } : /\./.test(k.param) ? null : { op: "set_props", id: k.id, props: { [k.param]: k.to } })).filter(Boolean)
				const v3 = await version({ ...cand.ans, patches: [...cand.ans.patches, ...knob] })
				if (!v3.error && better(v3, v)) v = v3
			}
		}
		// (neverWorse) a fix that is not better than leaving the scene alone is not applied
		if (neverWorse && v.failing.length && !better(v, v0)) return { replyOnly: true, reply: `I tried several ways to make ${and(v0.failing.map((g) => `“${g.label}”`))} work again while keeping what you chose, and none of them did without making the run worse, so I left the scene as it was.`, kind, failing: v0.failing.map((g) => g.label), calls }
	}

	// ---- 4. the reply: the model's words, what moved to make room (or could not move as far as asked), and what changed in the run
	let reply = v.ans.reply ?? ""
	if (v.r.madeRoom.length) reply += ` (${and(v.r.madeRoom)}.)`
	if (v.delta.headline.length && kind !== "fix") reply += ` Heads-up, in the new run: ${and(v.delta.headline)}. Say “make it work again” and I’ll adjust the machine around your change.`
	if (kind === "fix" && v.failing.length) reply += ` It still doesn't fully work: ${and(v.failing.map((g) => g.label))} ${v.failing.length > 1 ? "fail" : "fails"} in the run.`
	return { replyOnly: false, scene: v.r.scene, plan: v.r.plan, sim: v.sim, reply: reply.trim(), kind, targets: v.ans.targets ?? null, heads: v.delta.lost, won: v.delta.won, failing: v.failing.map((g) => g.label), madeRoom: v.r.madeRoom, shortfalls: v.r.shortfalls ?? [], overlaps: v.overlaps, diffWords: v.diff, answer: v.ans, calls }
}
