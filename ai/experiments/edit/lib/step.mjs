// The edit step, in two prompt versions and two scene digests (for the A/B):
//   prompt "old": the frozen ai/prompts/edit.md (the app's)          digest "old": ai/scene-digest.mjs (the app's)
//   prompt "v2":  prompts/edit-v2.md (targets first, ask when truly    digest "rich": lib/rich-digest.mjs (looks, sizes, places in words,
//                 ambiguous, questions change nothing, exact numbers,                 supports, the last run's events, look-alike groups)
//                 no collateral changes unless asked to make it work)
//   const out = await editStep({text, scene, plan, history, sim, extra}, {prompt, digest, effort, signal})
//   // {result (the validated answer, with kind and targets kept), ms, usage, model, warnings, user (the request's text, for the record)}
// The model call is the app's own (frozen ai/core.mjs callModel through the frozen models.json "edit" route: Opus 5.5, its fallbacks),
// validated by the frozen ai/schemas.mjs validateEdit (kind/targets are set aside while it checks the rest).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FROZEN, HERE, frozen } from "./env.mjs"
import { withSlot } from "./pool.mjs"
import { richDigest } from "./rich-digest.mjs"

const PROMPTS = { old: null, v2: join(HERE, "prompts", "edit-v2.md") }
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
function load(file) {
	const t = readFileSync(file, "utf8")
	return t.replace(/\{\{include:([\w.-]+)\}\}/g, (_, f) => readFileSync(join(FROZEN, "ai", "prompts", f), "utf8").trim())
}
const fenced = (label, s) => `${label}:\n"""\n${s}\n"""`
const f3 = (v) => Number(v).toFixed(3).replace(/\.?0+$/, "")
function stageText(s) {
	const stage = s?.stage ?? { x0: -0.559, x1: 3.191, y0: -0.156, y1: 2.344 }
	const t = s?.items?.find((i) => i.type === "table")
	const w = Number(t?.props?.width ?? 3.7)
	const x = Number(t?.x ?? 1.3)
	return `The stage runs x ${f3(stage.x0)}…${f3(stage.x1)} and y ${f3(stage.y0)}…${f3(stage.y1)} m. The table top is y = 0 and runs from x ${f3(x - w / 2)} to ${f3(x + w / 2)} (${f3(w)} m long).`
}
export const KINDS = ["change", "ask", "answer", "fix", "undo", "new"]

/** The request's user turn. */
export async function editUser({ text, scene, plan, history = [], sim = null, extra = null }, { digest = "rich" } = {}) {
	const F = await frozen()
	const cat = await F.catalog.getCatalog()
	const d = digest === "rich" ? await richDigest(scene, { sim, plan, F, cat }) : await F.sceneDigest.sceneDigest(scene, cat.index)
	const parts = [`# The current scene\n${d.text}`, `# The stage\n${stageText(scene)}`]
	parts.push(
		plan
			? `# Its plan (patches change this plan; the scene above is what it builds)\n${JSON.stringify(plan)}`
			: "# Its plan\nThis scene was made by hand and has no plan: patches refer to its items by id, and each item's place is where it is now (on \"air\" at its anchor's x and y_m, so give x / y_m / dx / dy, or set_place to rest it on something)."
	)
	const turns = history.map((h) => `${h.role === "user" ? "User" : "You"}: ${String(h.text).slice(0, 2000)}`)
	if (turns.length) parts.push(`# The conversation so far\n${turns.join("\n")}`)
	if (extra) parts.push(extra)
	parts.push(fenced("# The user's request now", text), "Answer as one JSON object.")
	return { user: parts.join("\n\n"), digest: d }
}

export async function editStep(payload, { prompt = "v2", digest = "rich", effort = null, signal, extra = null } = {}) {
	const F = await frozen()
	const cat = await F.catalog.getCatalog()
	const scene = F.sim.clean(payload.scene)
	const { user } = await editUser({ ...payload, scene, extra: extra ?? payload.extra ?? null }, { digest })
	const system = (prompt === "old" ? F.steps.loadPrompt("edit.md") : load(PROMPTS[prompt])).replace("{{CATALOG}}", cat.text)
	const ctx = { catalog: cat.index, plan: payload.plan ?? undefined, scene, stage: scene.stage }
	const validate = (v) => {
		if (!isObj(v)) return F.schemas.validateEdit(v, ctx)
		const { kind, targets, ...rest } = v
		const errors = []
		if (prompt !== "old") {
			if (!KINDS.includes(kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`)
			if (!Array.isArray(targets)) errors.push("targets must be a list ([] when the request names nothing)")
			if (["ask", "answer", "undo"].includes(kind) && Array.isArray(rest.patches) && rest.patches.length) errors.push(`kind "${kind}" changes nothing: "patches": []`)
		}
		const r = F.schemas.validateEdit(rest, ctx)
		return { ...r, ok: r.ok && !errors.length, errors: [...errors, ...r.errors], value: { ...r.value, ...(kind !== undefined ? { kind } : {}), ...(targets !== undefined ? { targets } : {}) } }
	}
	const params = effort ? { reasoning_effort: effort } : undefined
	const out = await withSlot(() => F.core.callModel("edit", { system, content: user, validate, signal, fetch: F.fetchH1, params }))
	return { result: out.result, ms: out.ms, usage: out.usage, model: out.model, warnings: out.warnings, attempts: out.attempts?.length ?? 1, user }
}
