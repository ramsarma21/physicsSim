// Stands in for ai/experiments/edit/lib/step.mjs (the experiment's own edit call) when edit-integrated.mjs runs the experiment's arms:
// the same editStep(payload, opts) -> {result, ms, usage, model, warnings, attempts, user}, but the call is the INTEGRATED server step,
// runStep("edit", ...) of a byte-identical copy of the live ai/ (EDIT_TREE), with the experiment's `extra` sent as the payload's `feedback`.
// Each call also builds the experiment's own request text for the same payload (its lib/step.mjs editUser, digest "rich") and logs whether
// the integrated step sent the same text (user-turns.jsonl in the run's folder): the comparison is then the server change only.
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const EXP = new URL("../../experiments/edit/", import.meta.url)
const { frozen, OUT } = await import(new URL("lib/env.mjs", EXP).href)
const { withSlot } = await import(new URL("lib/pool.mjs", EXP).href)
const orig = await import(new URL("lib/step.mjs", EXP).href) // (not swapped: only arms.mjs's import of it is)
export const KINDS = orig.KINDS
export const editUser = orig.editUser

const F = await frozen()
const TREE = process.env.EDIT_TREE
if (!TREE) throw new Error("EDIT_TREE is not set (edit-integrated.mjs sets it)")
// the tree's catalog digest keeps its own cache (catalog-digest.mjs reads AI_CACHE_DIR once, when it is imported)
const before = process.env.AI_CACHE_DIR
process.env.AI_CACHE_DIR = path.join(TREE, ".cache")
const T = await import(pathToFileURL(path.join(TREE, "ai", "steps.mjs")).href)
await (await import(pathToFileURL(path.join(TREE, "ai", "catalog-digest.mjs")).href)).getCatalog()
process.env.AI_CACHE_DIR = before

const INTENT = process.env.EDIT_INTENT || null // "edit": as the app's "Edit with AI" sends it (§13.8); unset: as the experiment called it
const firstUser = (body) => {
	const m = (body?.messages ?? []).find((x) => x.role === "user")
	const c = m?.content
	return typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x?.type === "text").map((x) => x.text).join("\n") : null
}
function firstDiff(a, b) {
	const la = String(a ?? "").split("\n")
	const lb = String(b ?? "").split("\n")
	const out = []
	for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) out.push({ line: i + 1, experiment: (la[i] ?? "(none)").slice(0, 400), integrated: (lb[i] ?? "(none)").slice(0, 400) })
	return out
}

export async function editStep(payload, { prompt = "v2", digest = "rich", effort = null, signal, extra = null } = {}) {
	if (prompt !== "v2" || digest !== "rich") throw new Error("the integrated step is configuration n7's (prompt v2, rich digest)")
	const feedback = extra ?? payload.extra ?? null
	let sent = null
	const fetchRec = (url, init) => {
		if (sent === null)
			try {
				sent = firstUser(JSON.parse(String(init?.body ?? ""))) ?? ""
			} catch {}
		return F.fetchH1(url, init)
	}
	const p = { text: payload.text, scene: payload.scene, ...(payload.plan ? { plan: payload.plan } : {}), history: payload.history ?? [], ...(payload.sim ? { sim: payload.sim } : {}), ...(feedback ? { feedback } : {}), ...(INTENT ? { intent: INTENT } : {}) }
	const out = await withSlot(() => T.runStep("edit", p, { fetch: fetchRec, signal, noEscalate: true, ...(effort ? { params: { reasoning_effort: effort } } : {}) }))
	// the experiment's own request text for this payload, for the record
	try {
		const exp = (await orig.editUser({ ...payload, scene: F.sim.clean(payload.scene), extra: feedback }, { digest: "rich" })).user
		const diffs = exp === sent ? [] : firstDiff(exp, sent)
		const file = path.join(OUT, process.env.EDIT_RUN ?? "run", "user-turns.jsonl")
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.appendFileSync(file, JSON.stringify({ text: payload.text, scene: payload.scene?.id ?? payload.scene?.name ?? null, again: !!feedback, intent: INTENT, same: exp === sent, lines: diffs.length, diffs: diffs.slice(0, 6) }) + "\n")
	} catch (e) {
		console.log(`(user-turn comparison failed: ${e?.message ?? e})`)
	}
	return { result: out.result, ms: out.ms, usage: out.usage, model: out.model, warnings: out.warnings, attempts: out.attempts?.length ?? 1, user: sent }
}
