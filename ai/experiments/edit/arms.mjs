// The arms of the edit A/B. Each: (case, prepared base, record) -> {scene (what ends on the table; null = unchanged), reply, notes, report}
//   base  the frozen app pipeline exactly as the AI panel runs an edit (web/ai/orchestrator.js + ai/steps.mjs edit + refine ≤ 2 with
//         real renders + the tuner + the quick path)
//   d1    base, but the edit step reads the rich scene digest (lib/rich-digest.mjs) instead of the app's        [digest, in the app pipeline]
//   a1    the app's edit step (prompt and digest) -> deterministic application (lib/apply.mjs) -> one physics run -> the reply plus what
//         changed in the run; no critic, no renders (the fast path for every change)                          [application + fast path]
//   a1d   a1 with the rich digest                                                                              [digest, new application]
//   n1    the new edit prompt (prompts/edit-v2.md: targets first, ask when truly ambiguous, questions change nothing, exact numbers, no
//         collateral changes unless asked to make it work) + rich digest + a1's application; "make it work" requests get up to 2 more
//         rounds driven by the run's goal results                                                               [prompt]
//   n2    n1 + the post-edit verifier (lib/verify.mjs: exact diff + a fast Opus-low check) with one repair turn  [verifier]
//   n2s   n2 with the edit step on Sonnet 5.5 (low)                                                             [fast model]
import { frozen } from "./lib/env.mjs"
import { simPool, withSlot } from "./lib/pool.mjs"
import { editStep } from "./lib/step.mjs"
import { applyEdit } from "./lib/apply.mjs"
import { exactDiff, verifyEdit } from "./lib/verify.mjs"
import { resolveRefs } from "./lib/resolve.mjs"
import { richDigest } from "./lib/rich-digest.mjs"

const clone = (o) => (o === undefined || o === null ? o : JSON.parse(JSON.stringify(o)))
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const and = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

// ---------------------------------------------------------------- the app's api(), as the panel calls it, recording every step
export function makeApi(F, rec, { routing, edit = null } = {}) {
	return async (p, body, signal) => {
		const step = p.replace("/api/ai/", "")
		const t0 = Date.now()
		try {
			const out = step === "edit" && edit ? await edit(body.payload, signal) : await withSlot(() => F.steps.runStep(step, body.payload, { routing, fetch: F.fetchH1, signal }))
			rec.calls.push({ step, ms: out.ms, wallMs: Date.now() - t0, model: out.model, usage: out.usage, warnings: out.warnings?.slice?.(0, 8) })
			rec.answers.push({ step, result: out.result, ...(out.goals ? { goals: out.goals } : {}) })
			return { ok: true, result: out.result, model: out.model, ms: out.ms, usage: out.usage }
		} catch (e) {
			rec.calls.push({ step, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 300), code: e?.code })
			return { ok: false, error: String(e?.message ?? e), code: e?.code ?? "error", retryable: false }
		}
	}
}

let rendererP = null
async function renderer() {
	if (process.env.EDIT_NO_RENDER) return null
	rendererP ??= (async () => {
		const { createRenderer } = await import("../../bench/lib/render.mjs")
		return createRenderer({ pages: 2 })
	})().catch((e) => {
		console.log(`renders off: ${e.message}`)
		return null
	})
	return rendererP
}
export async function closeRenderer() {
	if (rendererP) (await rendererP)?.close()
}
const shot = {
	render: async (sim, { scene }) => {
		const r = await renderer()
		return r ? (await r.render(sim, scene)).shots : []
	}
}

/** What the user ends with, from an orchestrator report. */
export function fromReport(rep) {
	const notes = [...(rep.issues ?? []).map((i) => i.text), rep.quickNote, ...(rep.edit?.changes ?? []), ...(rep.tune?.changes ?? []).map((t) => `tuner: ${t}`)].filter((x) => typeof x === "string" && x)
	return {
		scene: rep.replyOnly ? null : rep.scene,
		reply: rep.reply ?? rep.edit?.reply ?? "",
		notes,
		report: { replyOnly: !!rep.replyOnly, undo: !!rep.undo, quick: !!rep.quick, refine: (rep.refine ?? []).length, tuned: !!rep.tune?.changed?.length, timings: rep.timings, edit: rep.edit ? { mode: rep.edit.mode, changes: rep.edit.changes } : null, issues: rep.issues, goals: rep.goals, missing: rep.missing }
	}
}

async function orchestrated(c, B, rec, { edit = null } = {}) {
	const F = await frozen()
	const orch = F.orch.createOrchestrator({ api: makeApi(F, rec, { edit }), shot, simulate: (scene, signal) => simPool().simulate(scene, signal) })
	const req = { text: c.text, mode: "edit", scene: clone(B.scene), plan: clone(B.plan) ?? undefined, planScene: B.plan ? clone(B.scene) : undefined, history: c.history ?? [], sim: B.sim }
	return fromReport(await orch.build(req, { onEvent: () => {} }).result)
}

// ---------------------------------------------------------------- the new edit path
/** The goals the app knows for a scene (its plan's, every kind; a hand-made scene's own "in" goals). */
const appGoals = (B, plan) => (plan?.goals?.length ? plan.goals : (B.scene.goals ?? []).map((g) => ({ ...g, kind: g.kind ?? "in" })))
const FIRM = 0.3

/** How the run changed: goals lost or won, rows that stopped part way, hits that no longer happen. -> {lost: [words], won: [words]} */
async function runDelta(B, sceneB, simB, goals) {
	const F = await frozen()
	const lost = []
	const won = []
	const ra = F.orch.goalResults(B.sim, goals)
	const rb = F.orch.goalResults(simB, goals)
	for (const g of rb) {
		const w = ra.find((x) => x.label === g.label)
		if (w?.ok === true && g.ok !== true) lost.push(`“${g.label}” no longer happens${g.detail ? ` (${g.detail})` : ""}`)
		if (w && w.ok !== true && g.ok === true) won.push(`“${g.label}” now happens`)
	}
	const goalsLost = lost.length
	lost.push(...F.orch.lostStages(B.sim, simB, sceneB))
	const ids = new Set(sceneB.items.map((i) => i.id))
	const nameOf = (id) => sceneB.items.find((i) => i.id === id)?.name ?? B.scene.items.find((i) => i.id === id)?.name ?? id
	const scenery = (id) => id === "table" || /^wall-/.test(id)
	const pairs = (sim) => {
		const m = new Map()
		for (const e of sim?.summary?.events ?? []) if (!scenery(e.a) && !scenery(e.b) && (e.speed ?? 1) >= FIRM) m.set([e.a, e.b].sort().join("|"), e)
		return m
	}
	const pa = pairs(B.sim)
	const pb = pairs(simB)
	for (const [k, e] of pa) if (!pb.has(k) && ids.has(e.a) && ids.has(e.b)) lost.push(`${nameOf(e.a)} no longer hits ${nameOf(e.b)}`)
	// (the goals first, then the stages and hits that stopped: at most 3 in the reply, the rest on the card)
	return { lost: [...new Set(lost)].slice(0, 6), headline: [...new Set(lost)].slice(0, Math.max(3, goalsLost)), won, results: rb }
}

/** Run a scene with the app's goals in it (as the app's solver puts "in" goals in the scene). */
async function runWithGoals(scene, goals) {
	const s = clone(scene)
	const ids = new Set(s.items.map((i) => i.id))
	s.goals = (s.goals ?? []).filter((g) => ids.has(g.item) && ids.has(g.container))
	for (const g of goals ?? []) if ((g.kind ?? "in") === "in" && ids.has(g.item) && ids.has(g.container) && !s.goals.some((x) => x.item === g.item && x.container === g.container)) s.goals.push({ kind: "in", item: g.item, container: g.container, label: g.label })
	return simPool().simulate(s)
}

const FIX_RE = /\b(make (it|this|them|everything) work|works? again|fix|so (that|it)|get it (to )?work|still work)\b/i

export async function newEdit(c, B, rec, { prompt = "v2", digest = "rich", verify = false, effort = null, fixRounds = 2, editModel = null, resolver = false, applyV = 1, overlapRepair = false, fixVia = "loop" } = {}) {
	const F = await frozen()
	const payload = { text: c.text, scene: clone(B.scene), plan: clone(B.plan) ?? undefined, history: c.history ?? [], sim: B.sim }
	// a separate reference-resolution pass first: a truly ambiguous request gets its question at once; else the edit call is told the targets
	let resolved = null
	if (resolver) {
		const cat = await F.catalog.getCatalog()
		const d = await richDigest(B.scene, { sim: B.sim, plan: B.plan, F, cat })
		const t0 = Date.now()
		resolved = await resolveRefs({ text: c.text, history: c.history ?? [], digestText: d.text })
		rec.calls.push({ step: "resolve", ms: resolved.ms, wallMs: Date.now() - t0, model: resolved.model, usage: resolved.usage })
		rec.answers.push({ step: "resolve", result: { targets: resolved.targets, kind: resolved.kind, ambiguous: resolved.ambiguous, question: resolved.question } })
		if (resolved.ambiguous && resolved.kind !== "question" && resolved.question) return { scene: null, reply: resolved.question, notes: [], report: { replyOnly: true, kind: "ask", targets: resolved.targets } }
	}
	const resolvedText = resolved ? `# Which items the request means (a first look resolved this; use it unless it is clearly wrong)\n${resolved.targets.map((t) => `- “${t.says}” → ${(t.ids ?? []).join(", ")}${t.because ? ` (${t.because})` : ""}`).join("\n") || "(nothing named)"}${resolved.kind === "question" ? "\nIt reads as a question: change nothing, answer it." : ""}` : null
	const call = async (extra = null) => {
		const t0 = Date.now()
		const out = await editStep(payload, { prompt, digest, effort, extra: [resolvedText, extra].filter(Boolean).join("\n\n") || null, ...(editModel ? { model: editModel } : {}) })
		rec.calls.push({ step: extra ? "edit-again" : "edit", ms: out.ms, wallMs: Date.now() - t0, model: out.model, usage: out.usage, warnings: out.warnings?.slice?.(0, 8) })
		rec.answers.push({ step: extra ? "edit-again" : "edit", result: out.result })
		return out.result
	}
	let ans = await call()
	const kind = ans.kind ?? (ans.undo ? "undo" : Array.isArray(ans.patches) && !ans.patches.length ? "answer" : FIX_RE.test(c.text) ? "fix" : "change")
	const goals = appGoals(B, B.plan)
	const replyOnly = (a) => ({ scene: null, reply: a.reply ?? "", notes: [], report: { replyOnly: true, kind: a.kind ?? kind, targets: a.targets ?? null } })
	if (ans.mode === "new" || !Array.isArray(ans.patches) || !ans.patches.length) return replyOnly(ans)
	// "make it work": the app's own loop (the critic with real renders, ≤ 2 rounds, and the tuner), starting from this answer
	if (kind === "fix" && fixVia === "orchestrator") {
		let first = true
		const out = await orchestrated(c, B, rec, {
			edit: async (pl, signal) => {
				if (first) {
					first = false
					return { result: ans, ms: 0, model: "(the answer above)", usage: {} }
				}
				return editStep({ ...pl, sim: B.sim }, { prompt, digest, signal })
			}
		})
		return { ...out, report: { ...(out.report ?? {}), kind, via: "orchestrator" } }
	}

	/** One version: apply, run, and what changed in the run. */
	const version = async (a) => {
		const r = await applyEdit({ scene: B.scene, plan: B.plan, sim: B.sim }, a.patches, { v: applyV })
		if (r.error) return { error: r.error, ans: a, r }
		const sim = await runWithGoals(r.scene, r.plan?.goals ?? goals)
		const delta = await runDelta(B, r.scene, sim, r.plan?.goals?.length ? r.plan.goals : goals)
		const failing = delta.results.filter((g) => g.ok !== true)
		return { ans: a, r, sim, delta, failing, overlaps: r.warnings ?? [], bad: failing.length + (r.warnings?.length ?? 0), diff: await exactDiff(B.scene, r.scene) }
	}
	let v = await version(ans)
	// "make it work": up to fixRounds more rounds, told what the run did (the goals that still fail, the order of hits)
	if (kind === "fix" && !v.error) {
		let last = v
		for (let round = 0; round < fixRounds && v.bad; round++) {
			const runText = (last.sim.summary?.events ?? []).slice(0, 16).map((e) => `${e.t.toFixed(2)} s ${e.text}${e.speed != null ? ` (${e.speed.toFixed(2)} m/s)` : ""}`).join("; ")
			const extra = `# Your last answer was applied and run\nYou sent: ${JSON.stringify(last.ans.patches)}\nWhat changed: ${last.diff.join("; ") || "nothing"}\nIn its run: ${last.failing.map((g) => `FAILED: ${g.label}${g.detail ? ` (${g.detail})` : ""}`).join("; ") || "every goal met"}.${last.overlaps.length ? ` At the start: ${last.overlaps.map((w) => w.text).join("; ")} (not allowed: things must not start inside each other).` : ""} Hits in order: ${runText || "none"}.\nIt still does not work. Answer again with the WHOLE set of patches against the scene above (the scene before your first answer), changing what the run shows is wrong, by enough to make it work; keep the things the user chose. Give set_tune knobs (with ranges) on what you change, so a tuner can finish the job.`
			const a2 = await call(extra)
			if (!Array.isArray(a2.patches) || !a2.patches.length) break
			const v2 = await version(a2)
			if (v2.error) continue
			last = v2
			if (v2.bad < v.bad || (v2.bad === v.bad && v2.diff.length < v.diff.length)) v = v2
		}
		// the tuner (the app's own: a bounded search over the knobs the answer gave) when the run still fails
		for (const cand of [...new Set([v, last])]) {
			if (!v.failing.length || v.overlaps.length) break
			if (!(cand.r.plan?.tune?.length)) continue
			const t0 = Date.now()
			const tr = await F.orch.tune({ plan: cand.r.plan, scene: cand.r.scene, sim: cand.sim, goals: cand.r.plan.goals?.length ? cand.r.plan.goals : goals, simulate: (sc, sig) => simPool().simulate(sc, sig), maxRuns: 120, maxMs: 45000 })
			rec.calls.push({ step: "tune", ms: Date.now() - t0, runs: tr.runs, changed: tr.changed })
			if (!tr.changed?.length) continue
			const knobPatches = tr.changed.map((k) => (k.param === "x" ? { op: "move", id: k.id, x: k.to } : k.param === "y" || k.param === "y_m" ? { op: "move", id: k.id, y_m: k.to } : k.param === "angle" || k.param === "angle_deg" ? { op: "move", id: k.id, angle_deg: k.to } : /\./.test(k.param) ? null : { op: "set_props", id: k.id, props: { [k.param]: k.to } })).filter(Boolean)
			const v3 = await version({ ...cand.ans, patches: [...cand.ans.patches, ...knobPatches] })
			if (!v3.error && v3.bad < v.bad) {
				v = v3
				v.tuned = tr.changed
			}
		}
	}
	// the verifier: did it do exactly what was asked? (a fast model check of the exact diff) and, deterministic, does anything now start inside
	// something else? One repair turn when either finds a problem
	let verdict = null
	if (!v.error && (verify || (overlapRepair && v.overlaps?.length))) {
		const problems = []
		if (verify) {
			verdict = await verifyEdit({ text: c.text, history: c.history ?? [], targets: v.ans.targets ?? [], diff: v.diff, reply: v.ans.reply, kind })
			rec.calls.push({ step: "verify", ms: verdict.ms, model: verdict.model, usage: verdict.usage })
			rec.answers.push({ step: "verify", result: { ok: verdict.ok, problems: verdict.problems } })
			if (!verdict.ok) problems.push(...(verdict.problems ?? []))
		}
		if (overlapRepair && v.overlaps?.length) problems.push(...v.overlaps.map((w) => `${w.text}: they must not start inside each other. Make the asked change fit (e.g. its spacing, size or place) or move the neighbour the least that makes room, and say so.`))
		if (problems.length) {
			verdict = { ...(verdict ?? {}), ok: false, problems }
			const extra = `# A check of your last answer found problems\nYou sent: ${JSON.stringify(v.ans.patches)}\nWhat it changed in the scene: ${v.diff.join("; ") || "nothing"}\nProblems:\n${problems.map((p) => `- ${p}`).join("\n")}\nAnswer again: the WHOLE set of patches against the scene above (the scene before your first answer), doing exactly what the request asks${kind === "fix" ? " (and making it work)" : ""}. If the request is a question or truly ambiguous, change nothing.`
			const a2 = await call(extra)
			if (!Array.isArray(a2.patches) || !a2.patches.length) {
				if (a2.kind === "ask" || a2.kind === "answer") return { ...replyOnly(a2), extra: { verdict, repaired: true } }
			} else {
				const v2 = await version(a2)
				if (!v2.error && !(kind === "fix" && v2.failing.length > v.failing.length) && !(overlapRepair && v2.overlaps.length > v.overlaps.length)) {
					v = v2
					verdict.repaired = true
				}
			}
		}
	}
	if (v.error) return { scene: null, reply: `${ans.reply ?? ""} (Couldn't place it: ${v.error})`, notes: [v.error], report: { error: v.error } }
	// the reply: the model's words, what had to move to make room, and what changed in the run
	const notes = [...v.r.madeRoom, ...(v.r.skipped ?? []).map((s) => `Not done: ${s}`)]
	const heads = v.delta.headline ?? v.delta.lost
	let reply = v.ans.reply ?? ""
	if (v.r.madeRoom.length) reply += ` (${and(v.r.madeRoom)}.)`
	if (heads.length && kind !== "fix") reply += ` Heads-up, in the new run: ${and(heads)}. Say “make it work again” and I’ll adjust the machine around your change.`
	if (kind === "fix" && v.failing.length) reply += ` It still doesn't fully work: ${and(v.failing.map((g) => g.label))} ${v.failing.length > 1 ? "fail" : "fails"} in the run.`
	notes.push(...v.delta.lost.map((h) => `Run: ${h}`), ...v.delta.won)
	return { scene: v.r.scene, reply: reply.trim(), notes, report: { kind, targets: v.ans.targets ?? null, diff: v.diff, madeRoom: v.r.madeRoom, lost: heads, failing: v.failing.map((g) => g.label), verdict, pinned: v.r.pinned?.length, touched: v.r.touched } }
}

export const ARMS = {
	noop: async () => ({ scene: null, reply: "" }),
	base: (c, B, rec) => orchestrated(c, B, rec),
	d1: (c, B, rec) =>
		orchestrated(c, B, rec, {
			edit: (payload, signal) => editStep({ ...payload, sim: B.sim }, { prompt: "old", digest: "rich", signal })
		}),
	a1: (c, B, rec) => newEdit(c, B, rec, { prompt: "old", digest: "old" }),
	a1d: (c, B, rec) => newEdit(c, B, rec, { prompt: "old", digest: "rich" }),
	n1: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich" }),
	n1o: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "old" }),
	n2: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: true }),
	n4: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: true, applyV: 2, overlapRepair: true }),
	n5: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: true, applyV: 3, overlapRepair: true }),
	h5: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: true, applyV: 3, overlapRepair: true, fixVia: "orchestrator" }),
	n5r: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: true, applyV: 3, overlapRepair: true, resolver: true }),
	n5d: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: false, applyV: 3, overlapRepair: true }),
	h5d: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: false, applyV: 3, overlapRepair: true, fixVia: "orchestrator" }),
	n5x: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: false, applyV: 3, overlapRepair: false }),
	n3: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: true, resolver: true }),
	n2m: (c, B, rec) => newEdit(c, B, rec, { prompt: "v2", digest: "rich", verify: true, effort: "medium" })
}
