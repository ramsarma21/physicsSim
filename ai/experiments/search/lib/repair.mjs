// The stage repair: when the tuner cannot make a stage's check pass, the model is shown exactly what the engine's run did around that stage
// (which checks pass, where the stage's things started and ended, their speeds, the hits, how close the mover came to its target, what the
// tuner tried) and asked to fix THAT stage only, with patches (the app's edit step, at medium effort: the same prompt, validator and patch
// semantics as a follow-up edit). The repaired plan is kept only when every earlier stage still passes and the stage got closer.
import { isObj, num, orch, runStep } from "./infra.mjs"
import { evaluate, stagesOf } from "./physics.mjs"

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : "?")
const fmt = (v) => (Math.abs(v) >= 1 ? `${r2(v)} m` : `${Math.round(v * 1000) / 10} cm`)

/** Where an item's moving parts are (their mean), frame by frame. */
function pathOf(doc, track, id) {
	const sids = doc.solids.filter((s) => s.item === id && s.kind === "dynamic").map((s) => s.id)
	if (!sids.length) return null
	return track.frames.map((f) => {
		let x = 0
		let y = 0
		let n = 0
		for (const s of sids) {
			const p = f.placements[s]
			if (p) (x += p.x, (y += p.y), n++)
		}
		return n ? { t: f.t, x: x / n, y: y / n } : null
	})
}

/** The run around stage k (0-based) in plain lines with numbers. */
export function stageFacts(ev, k, tuneLog = null) {
	const S = ev.stages
	const st = S[k]
	const lines = ["The machine's checks, in order, in the physics engine's run (exact results, not estimates):"]
	for (const s of S) if (s.check) lines.push(`- Stage ${s.stage} “${s.label}”: ${s.res?.ok === true ? "WORKS" : "FAILS"} (${s.res?.detail ?? "?"})`)
	const { doc, track, summary } = ev.sim
	const names = new Map(ev.scene.items.map((i) => [i.id, i.name ?? i.type]))
	const ids = [...new Set([...(st.items ?? []), ...[st.check?.item, ...(st.check?.items ?? []), st.check?.target, st.check?.container].filter(Boolean)])]
	lines.push(`\nStage ${st.stage} “${st.label}” is the first that fails${st.does ? ` (it must: ${st.does})` : ""}. Its things in the run:`)
	const stories = new Map((summary?.stories ?? []).map((s) => [s.item, s]))
	for (const id of ids) {
		const it = ev.scene.items.find((i) => i.id === id)
		if (!it) continue
		const P = pathOf(doc, track, id)
		const story = stories.get(id)
		if (!P) {
			lines.push(`- ${names.get(id)} (${id}, ${it.type}): static, anchor at x ${r2(it.x)}, y ${r2(it.y)}`)
			continue
		}
		const a = P.find(Boolean)
		const z = [...P].reverse().find(Boolean)
		const low = P.filter(Boolean).reduce((m, p) => (p.y < m.y ? p : m), a)
		lines.push(`- ${names.get(id)} (${id}, ${it.type}): starts at x ${r2(a.x)}, y ${r2(a.y)}; ${story?.moved_at != null ? `first moves at ${r2(story.moved_at)} s; top speed ${story.max_speed} m/s` : "never moves"}; ends at x ${r2(z.x)}, y ${r2(z.y)} (${fmt(Math.hypot(z.x - a.x, z.y - a.y))} from its start; lowest at x ${r2(low.x)}, y ${r2(low.y)} at ${r2(low.t)} s)${story?.text ? `; ${story.text}` : ""}`)
	}
	const c = st.check ?? {}
	const mover = c.item ?? c.items?.[0]
	const to = c.container ?? c.target
	if (mover && to) {
		const P = pathOf(doc, track, mover)
		const T = ev.scene.items.find((i) => i.id === to)
		if (P && T) {
			const pts = P.filter(Boolean)
			const near = pts.reduce((m, p) => (Math.hypot(p.x - T.x, p.y - T.y) < Math.hypot(m.x - T.x, m.y - T.y) ? p : m), pts[0])
			lines.push(`- ${names.get(mover)} comes closest to ${names.get(to)} (anchor x ${r2(T.x)}, y ${r2(T.y)}) at ${r2(near.t)} s, at x ${r2(near.x)}, y ${r2(near.y)}${c.container ? `; it must come down INTO ${names.get(to)}'s opening from above` : ""}.`)
			// where it was each 0.25 s around then
			const around = pts.filter((p) => Math.abs(p.t - near.t) <= 0.6 && Math.round(p.t * 100) % 25 === 0).slice(0, 6)
			if (around.length) lines.push(`  its path then: ${around.map((p) => `${r2(p.t)} s (${r2(p.x)}, ${r2(p.y)})`).join(" → ")}`)
		}
	}
	const evs = (summary?.events ?? []).filter((e) => ids.includes(e.a) || ids.includes(e.b)).slice(0, 10)
	if (evs.length) lines.push(`Hits with them: ${evs.map((e) => `${e.text} at ${r2(e.t)} s${e.speed ? ` (${r2(e.speed)} m/s)` : ""}`).join("; ")}.`)
	else lines.push("Nothing hits them during the run.")
	if (k > 0) {
		const prev = S.slice(0, k).reverse().find((s) => s.check)
		if (prev) lines.push(`The stage before (“${prev.label}”) ${prev.res?.ok ? "works" : "fails"}: ${prev.res?.detail ?? ""}.`)
	}
	if (tuneLog?.knobs?.length) lines.push(`The tuner already tried ${tuneLog.runs} runs turning ${tuneLog.knobs.map((kn) => `${kn.id}.${kn.param} in ${r2(kn.min)}…${r2(kn.max)}`).join(", ")}, and the check still failed: a bigger change is needed.`)
	return lines.join("\n")
}

/** Ask for a fix of stage k (0-based). -> {ok, plan?, reply, patches, changes, ms, error?} */
export async function repairStage(L, request, ev, k, tuneLog, { round = 1 } = {}) {
	const st = ev.stages[k]
	const earlier = ev.stages.slice(0, k).filter((s) => s.check)
	const keepIds = [...new Set(earlier.flatMap((s) => s.items ?? []))].filter((id) => !(st.items ?? []).includes(id))
	const text = [
		`A physics check of the machine built for this request: "${request}"`,
		stageFacts(ev, k, tuneLog),
		"",
		`Fix stage ${st.stage} with patches so that its check passes in the engine.${earlier.length ? ` Stages ${earlier.map((s) => s.stage).join(", ")} work: keep their things exactly as they are${keepIds.length ? ` (${keepIds.join(", ")})` : ""}.` : ""} Change stage ${st.stage}'s own things (${(st.items ?? []).join(", ") || "see the check"}): move them, resize them, change their props, use another catalog type, or add a helper (a backstop wall right behind a target, a guide ramp, a block or books to raise a ledge, a wider container, a funnel above an opening). Work the numbers out from the run above (where things really go, how fast), not from hopes. Move later stages' things along when they are in the way. Keep what the request names. Reply in one sentence saying what you changed.`
	].join("\n")
	const plan = ev.plan
	let out
	try {
		out = await runStep(L, "edit", { text: text.slice(0, 7900), scene: ev.scene, plan }, { label: `repair stage ${st.stage} #${round}`, params: { reasoning_effort: "medium" } })
	} catch (e) {
		return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
	}
	const ans = out.result ?? {}
	if (ans.mode === "plan" && isObj(ans.plan) && Array.isArray(ans.plan.items)) return { ok: true, plan: ans.plan, reply: ans.reply ?? "", whole: true, patches: [], changes: ["a whole new plan"], ms: out.ms }
	const patches = Array.isArray(ans.patches) ? ans.patches : []
	if (!patches.length) return { ok: false, reply: ans.reply ?? "", error: "no patches", ms: out.ms }
	const r = orch.applyPatches(plan, patches, ev.scene)
	if (!r.changes.length) return { ok: false, reply: ans.reply ?? "", error: `patches changed nothing (${r.skipped.join("; ").slice(0, 200)})`, ms: out.ms }
	const np = r.plan
	for (const kk of ["missing", "notes", "assumptions"]) if (ans[kk] !== undefined) np[kk] = ans[kk]
	// things the fix added belong to this stage (later tuning may move them)
	const added = patches.filter((p) => p?.op === "add" && isObj(p.item) && typeof p.item.id === "string").map((p) => p.item.id)
	if (added.length && Array.isArray(np.stages) && np.stages[st.stage - 1] && !st.synthetic) {
		const s = np.stages[st.stage - 1]
		s.items = [...new Set([...(Array.isArray(s.items) ? s.items : []), ...added])]
	}
	return { ok: true, plan: np, reply: ans.reply ?? "", patches, changes: r.changes, skipped: r.skipped, added, ms: out.ms }
}

/** Is the repaired version kept: it builds, no earlier stage broke, and stage k passes or got closer (or more later checks pass). */
export function repairAccepted(before, after, k) {
	if (!after?.ok) return false
	if (after.f.errors + after.f.through > before.f.errors + before.f.through) return false
	const ka = after.stages.findIndex((s) => s.label === before.stages[k].label && s.check)
	const kk = ka >= 0 ? ka : k
	for (let j = 0; j < k; j++) if (before.stages[j].check && before.stages[j].res?.ok === true) {
		const same = after.stages.find((s) => s.label === before.stages[j].label)
		if (same && same.res?.ok !== true) return false
	}
	const okNow = after.stages[kk]?.res?.ok === true
	const closer = (after.stages[kk]?.d ?? 9) < (before.stages[k].d ?? 9) - 1e-6
	return okNow || closer || after.f.stagesOk > before.f.stagesOk
}

/**
 * v3 (r1 showed 4 of 10 repairs rejected only because the fix left one thing passing through another, although more checks passed): a repair
 * that makes more checks pass is kept even with ONE new pass-through, and that pass-through then gets its own small fix (fixOverlaps).
 * -> {ok, overlapFix: bool}
 */
export function repairVerdict(before, after, k) {
	if (!after?.ok) return { ok: false }
	for (let j = 0; j < k; j++)
		if (before.stages[j].check && before.stages[j].res?.ok === true) {
			const same = after.stages.find((s) => s.label === before.stages[j].label)
			if (same && same.res?.ok !== true) return { ok: false }
		}
	const dBad = after.f.errors + after.f.through - (before.f.errors + before.f.through)
	const gain = after.f.stagesOk + after.f.goalsOk - (before.f.stagesOk + before.f.goalsOk)
	if (dBad > 0) return { ok: gain >= 1 && dBad <= 1 && after.f.errors <= before.f.errors, overlapFix: true }
	return { ok: repairAccepted(before, after, k), overlapFix: false }
}

/** A small fix for things passing through each other (the edit step at its shipped low effort): kept when fewer pass through and no check is lost. */
export async function fixOverlaps(L, ev) {
	const bad = (ev.solved?.issues ?? []).filter((i) => i.level !== "info" && ["overlap", "stand_through"].includes(i.code)).map((i) => i.text)
	if (!bad.length) return { ok: false, error: "nothing passes through" }
	const text = `In this scene things pass through each other: ${bad.slice(0, 4).join("; ")}. Move them clear of each other with the smallest change (set_place with a new x or y_m, or move), keeping everything else exactly as it is and keeping what happens in the run.`
	let out
	try {
		out = await runStep(L, "edit", { text, scene: ev.scene, plan: ev.plan }, { label: "overlap fix" })
	} catch (e) {
		return { ok: false, error: String(e?.message ?? e).slice(0, 200) }
	}
	const patches = Array.isArray(out.result?.patches) ? out.result.patches : []
	if (!patches.length) return { ok: false, error: "no patches" }
	const r = orch.applyPatches(ev.plan, patches, ev.scene)
	const ev2 = await evaluate(r.plan)
	const kept = ev2.ok && ev2.f.through + ev2.f.errors < ev.f.through + ev.f.errors && ev2.f.stagesOk + ev2.f.goalsOk >= ev.f.stagesOk + ev.f.goalsOk
	return { ok: kept, ev: ev2, changes: r.changes }
}

export { evaluate, stagesOf }
