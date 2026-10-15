// The server's edit step, as measured in ai/experiments/edit (arm n5/h5): a drop-in for `edit()` in ai/steps.mjs.
// Changes against today's step:
//  1. the scene digest is the rich one (rich-digest.mjs: looks, sizes, places in words, supports, the LAST RUN's events and each item's part
//     in them, look-alike groups), built from a run of the scene made right here (runScene: the same run as /api/simulate, ~0.2-0.4 s), so the
//     client sends nothing new;
//  2. the prompt is edit.md from this folder (targets first, ask when truly ambiguous, questions change nothing, exact numbers, no collateral
//     changes unless asked to make it work, swaps and resizes keep their seat);
//  3. the answer carries `kind` ("change" | "ask" | "answer" | "fix" | "undo" | "new") and `targets` ([{says, ids, because}]), set aside while
//     validateEdit checks the rest (editSchema needs: kind: {enum: [...]}, targets: {type: "array", maxItems: 20, items: {type: "object"}});
//  4. an optional payload `feedback` (text ≤ 4000) is appended to the request: the client's repair turn ("Ball 1 starts inside Ramp 1: ...")
//     and the "make it work" rounds ("In its run: FAILED: Ball 2 lands in the box ...").
// Wire-up in steps.mjs (sketch):
//   import { editStepV2 } from "../path/edit-step.mjs"  (or copy this file and rich-digest.mjs into ai/)
//   async function edit(p, o) { return editStepV2(p, o, { getCatalog, sceneDigest, runScene, layout: (s) => sim().then((m) => m.layout(s)), loadPrompt, call, validateEdit: VALIDATORS.edit, clean: scene }) }
import { richDigestFrom } from "./rich-digest.mjs"

export const KINDS = ["change", "ask", "answer", "fix", "undo", "new"]
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const fenced = (label, s) => `${label}:\n"""\n${s}\n"""`
const f3 = (v) => Number(v).toFixed(3).replace(/\.?0+$/, "")
function stageText(s) {
	const stage = s?.stage ?? { x0: -0.559, x1: 3.191, y0: -0.156, y1: 2.344 }
	const t = s?.items?.find((i) => i.type === "table")
	const w = Number(t?.props?.width ?? 3.7)
	const x = Number(t?.x ?? 1.3)
	return `The stage runs x ${f3(stage.x0)}…${f3(stage.x1)} and y ${f3(stage.y0)}…${f3(stage.y1)} m. The table top is y = 0 and runs from x ${f3(x - w / 2)} to ${f3(x + w / 2)} (${f3(w)} m long).`
}

/** The edit request's user turn (the same text the experiment measured: lib/step.mjs editUser with digest "rich"). */
export function editUserText({ scene, plan, history = [], text, feedback = null }, digestText) {
	const parts = [`# The current scene\n${digestText}`, `# The stage\n${stageText(scene)}`]
	parts.push(
		plan
			? `# Its plan (patches change this plan; the scene above is what it builds)\n${JSON.stringify(plan)}`
			: "# Its plan\nThis scene was made by hand and has no plan: patches refer to its items by id, and each item's place is where it is now (on \"air\" at its anchor's x and y_m, so give x / y_m / dx / dy, or set_place to rest it on something)."
	)
	const turns = history.map((h) => `${h.role === "user" ? "User" : "You"}: ${String(h.text).slice(0, 2000)}`)
	if (turns.length) parts.push(`# The conversation so far\n${turns.join("\n")}`)
	if (feedback) parts.push(String(feedback).slice(0, 4000))
	parts.push(fenced("# The user's request now", text), "Answer as one JSON object.")
	return parts.join("\n\n")
}

/** A validator for the edit answer: kind/targets checked here, the rest by the app's validateEdit. */
export function editValidator(validateEdit, ctx) {
	return (v) => {
		if (!isObj(v)) return validateEdit(v, ctx)
		const { kind, targets, ...rest } = v
		const errors = []
		if (!KINDS.includes(kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`)
		if (!Array.isArray(targets)) errors.push("targets must be a list ([] when the request names nothing)")
		if (["ask", "answer", "undo"].includes(kind) && Array.isArray(rest.patches) && rest.patches.length) errors.push(`kind "${kind}" changes nothing: "patches": []`)
		const r = validateEdit(rest, ctx)
		return { ...r, ok: r.ok && !errors.length, errors: [...errors, ...r.errors], value: { ...r.value, ...(kind !== undefined ? { kind } : {}), ...(targets !== undefined ? { targets } : {}) } }
	}
}

/** deps: {getCatalog, sceneDigest, runScene, layout, loadPrompt (reads THIS folder's edit.md as "edit.md"), call, validateEdit, clean}. */
export async function editStepV2(p, o, deps) {
	const cat = await deps.getCatalog()
	const cur = await deps.clean(p.scene)
	const d = await deps.sceneDigest(cur, cat.index)
	let run = null
	try {
		run = { ...(await deps.runScene(cur)), resolved: (await deps.layout(cur))?.resolved ?? null }
	} catch {}
	const rich = richDigestFrom(cur, d, { sim: run, plan: p.plan ?? null, cat })
	const user = editUserText({ scene: cur, plan: p.plan ?? null, history: p.history ?? [], text: p.text, feedback: p.feedback ?? null }, rich.text)
	const system = deps.loadPrompt("edit.md").replace("{{CATALOG}}", cat.text)
	const ctx = { catalog: cat.index, plan: p.plan ?? undefined, scene: cur, stage: cur.stage }
	return deps.call("edit", { system, user, imgs: [], ctx, validate: editValidator(deps.validateEdit, ctx) }, o, cat)
}
