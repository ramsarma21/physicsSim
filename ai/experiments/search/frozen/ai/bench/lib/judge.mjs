// The blinded rubric judge. It sees what a user would see: the request (and the reference picture), the scene that was built (its item list
// with true sizes and places, renders at the start and the end, and a close-up of a goal), what happened in the physics run, and the honesty
// report (what the library lacks and what stands in for it). It never sees which model, prompt or config made the result, nor the plan's
// reasoning text. Deterministic checks (score.mjs) carry most of the benchmark; the judge covers what they cannot: "is this what was asked?".
//   const j = await judge(theCase, { scene, plan, sim, shots, refs, base }, configOf("judge", "opus-high"))   // {ok, result: {score_0_10,...}, ms}
import { getCatalog } from "../../catalog-digest.mjs"
import { sceneDigest, simText } from "../../scene-digest.mjs"
import { callConfig } from "./gateway.mjs"

const SYSTEM = `You are a strict, impartial judge of a physics-sandbox scene builder. A user asked for a scene (in words, and sometimes with a reference picture). An automatic builder chose real objects from a fixed library of 113 catalog items (true sizes, masses and materials), placed them on a 3.7 m table, and ran a real rigid-body physics engine (all motion in one vertical plane: left-right along the table and up-down; nothing moves towards the camera). You judge the RESULT only: the built scene, the renders and what happened in the run.

What the library cannot do (so do not punish its absence when the builder says so honestly): no fluids (water, sand), no cloth, no people or animals, no breaking, melting, magnets or fire, nothing larger than the table. Honest substitutes that are clearly reported (e.g. a bucket standing in for a flower pot) are GOOD; silently pretending (calling a toy car "a dog" without reporting it) is BAD. Reporting as missing something the library obviously has is also bad.

The builder always adds two see-through safety walls (type "wall") at the table's two ends so nothing rolls off the stage; they are scenery: never count them as added items or as a problem. A plank used as a ramp is drawn with thin support legs under its raised end; those legs are part of the plank.

Judge these, then give one overall score:
1. request_fidelity (0-10): every requested thing is present as the right kind of object, in the requested number, size, material, order and arrangement; nothing unrelated added; for an edit: exactly the requested change, everything else kept.
2. outcome (0-10): the run really tells the requested story (chain steps fire in order; stated outcomes such as "lands in the cup" actually happen in the run results). If the request states no outcome, judge whether the scene behaves as such a scene naturally should.
3. physical_sense (0-10): things rest on real supports or are deliberately held/hanging; nothing starts inside anything else or floats without reason; believable proportions; tidy, readable layout within the table.
4. honesty (0-10): the missing/substitute report is truthful and complete (10 when nothing was missing and nothing is claimed missing).
5. reference_match (0-10, or null when there is no reference picture): left-right order, which things rest on which, counts, rough proportions and angles compared with the reference picture. Ignore background, lighting, colours of the room and camera angle; the sandbox renders its own table.

Overall score_0_10 anchors: 10 = exactly what was asked and every stated outcome happens; 8-9 = right scene that works, small cosmetic differences only; 6-7 = recognisable but one requested element or outcome is wrong, or a clear layout problem; 4-5 = partly right, a major element is missing or the main event fails; 1-3 = wrong or broken scene; 0 = nothing usable. Weigh outcome and fidelity most. Be calibrated and consistent: do not reward effort or length, and do not invent problems that the renders and run do not show. rubric_met is true only if the case's "what a good answer looks like" is satisfied in substance.

Answer with ONE JSON object only (no prose, no code fences):
{"request_fidelity": 0-10, "outcome": 0-10, "physical_sense": 0-10, "honesty": 0-10, "reference_match": 0-10 or null, "score_0_10": 0-10, "rubric_met": true|false, "issues": ["short concrete problems, most important first (at most 6)"], "summary": "one sentence"}`

const num = (v) => typeof v === "number" && Number.isFinite(v)
function validateJudge(v, { hasRef }) {
	const errors = []
	for (const k of ["request_fidelity", "outcome", "physical_sense", "honesty", "score_0_10"]) if (!num(v?.[k]) || v[k] < 0 || v[k] > 10) errors.push(`${k} must be a number 0-10`)
	if (hasRef && !(num(v?.reference_match) && v.reference_match >= 0 && v.reference_match <= 10)) errors.push("reference_match must be a number 0-10 (there is a reference picture)")
	if (!hasRef && v?.reference_match !== null && v?.reference_match !== undefined && !num(v?.reference_match)) errors.push("reference_match must be null (there is no reference picture)")
	if (typeof v?.rubric_met !== "boolean") errors.push("rubric_met must be true or false")
	if (!Array.isArray(v?.issues)) errors.push("issues must be a list of strings")
	return { ok: !errors.length, errors, warnings: [], value: { ...v, reference_match: hasRef ? v?.reference_match : null } }
}

const missingText = (plan) => {
	const m = Array.isArray(plan?.missing) ? plan.missing : []
	if (!m.length) return "The builder reported nothing missing."
	return m.map((x) => `- asked: ${x?.asked ?? "?"} — ${x?.reason ?? ""}${x?.substitute_type ? ` (stand-in: ${x.substitute_type}${x.substitute_id ? `, item ${x.substitute_id}` : ""})` : " (no stand-in)"}`).join("\n")
}

/**
 * c: the bench case ({prompt|text, expect.rubric, description?, kind?}); r: {scene, plan, sim, shots: [{label, t, dataUrl}], refs: [dataUrl],
 * base?: {scene, shots} (edit cases: the scene before), reply? (edit: the chat reply)}. -> {ok, result, ms, usage, model} | {ok: false, error}
 */
export async function judge(c, r, cfg, { text } = {}) {
	const cat = await getCatalog()
	const hasRef = (r.refs ?? []).length > 0
	const parts = []
	const request = text ?? c.prompt ?? c.text ?? ""
	parts.push(`# The request\n"""\n${request || "(no words: the reference picture is the request)"}\n"""`)
	if (c.mode === "edit") parts.push("This is a follow-up EDIT of an existing scene: judge whether exactly the requested change was made and everything else was kept as it was (unless it had to move to make the change work).")
	const rubric = c.expect?.rubric ?? c.rubric
	if (rubric) parts.push(`# What a good answer looks like (the benchmark's rubric)\n${rubric}`)
	if (c.description && hasRef) parts.push(`# What the reference picture really shows (written by the benchmark's author)\n${c.description}`)
	if (r.base?.scene) {
		const bd = await sceneDigest(r.base.scene, cat.index)
		parts.push(`# The scene BEFORE the edit\n${bd.text}`)
	}
	if (r.reply) parts.push(`# The builder's chat reply\n${r.reply}`)
	if (r.scene) {
		const d = await sceneDigest(r.scene, cat.index)
		parts.push(`# The built scene${c.mode === "edit" ? " AFTER the edit" : ""} (items with their true outline boxes in metres; the table top is y = 0)\n${d.text}`)
	} else parts.push("# The built scene\nNOTHING was built (the builder failed).")
	parts.push(`# What the builder reported as not in the library\n${missingText(r.plan)}`)
	if (r.sim) parts.push(`# What happened in the physics run\n${simText({ summary: r.sim.summary, warnings: r.sim.warnings })}`)
	const imgs = []
	const labels = []
	for (const ref of r.refs ?? []) {
		labels.push(`picture ${imgs.length}: the user's REFERENCE picture`)
		imgs.push(ref)
	}
	for (const s of r.base?.shots ?? []) {
		if (s.label !== "start") continue
		labels.push(`picture ${imgs.length}: the scene BEFORE the edit, at the start`)
		imgs.push(s.dataUrl)
	}
	for (const s of r.shots ?? []) {
		labels.push(`picture ${imgs.length}: render of the built scene, ${s.label === "close-up" ? "close-up of the goal at the end" : `${s.label} (t = ${Number(s.t).toFixed(1)} s)`}`)
		imgs.push(s.dataUrl)
	}
	parts.push(imgs.length ? `# Pictures\n${labels.join("\n")}` : "# Pictures\nNone (judge from the item list and the run).")
	parts.push("Judge the result now, as one JSON object.")
	return callConfig("judge", cfg, { system: SYSTEM, content: parts.join("\n\n"), images: imgs, validate: (v) => validateJudge(v, { hasRef }) })
}
