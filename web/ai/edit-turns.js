// Edit with AI, the n7 browser half (ai/DESIGN.md §14.2; ai/research/round3-plan.md §4.2): how an edit answer is read (kind first), the exact
// feedback texts of the measured repair and "make it work" turns (ai/experiments/edit/arms.mjs, arm n7), and the heads-up for what stopped
// happening in the run. Pure helpers; ./orchestrator.js makes the calls and runs.
//   import { routeKind, overlapFeedback, fixFeedback, headsUpLines } from "./edit-turns.js"

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const and = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

export const EDIT_KINDS = ["change", "fix", "ask", "answer", "undo", "new"]
/** Kinds that change nothing: the reply (and chips) only. */
export const REPLY_KINDS = new Set(["ask", "answer", "undo", "new"])
// (what the experiment read as "make it work" when an answer carried no kind)
const FIX_RE = /\b(make (it|this|them|everything) work|works? again|fix|so (that|it)|get it (to )?work|still work)\b/i

/**
 * The edit step's answer -> its kind, read first (§14.2 (2)): "ask" (one question, chips for the readings), "answer", "undo", "new" (a
 * different scene: offer New), "change" / "fix" (apply). An answer without a kind (an older server): mode "new" -> new, undo -> undo,
 * patches [] -> answer, else fix when the request states it ("make it work", "fix"), else change. A whole plan (an older server's answer)
 * is a change.
 */
export function routeKind(out, text = "") {
	if (!isObj(out)) return Array.isArray(out) && out.length ? (FIX_RE.test(text) ? "fix" : "change") : "answer"
	if (out.mode === "new" || out.kind === "new") return Array.isArray(out.patches) && out.patches.length && out.mode !== "new" ? "change" : "new"
	const k = typeof out.kind === "string" ? out.kind.trim().toLowerCase() : ""
	const hasPatches = Array.isArray(out.patches) && out.patches.length > 0
	const wholePlan = (isObj(out.plan) && Array.isArray(out.plan.items)) || Array.isArray(out.items)
	if (k === "undo" || out.undo === true) return "undo"
	if (EDIT_KINDS.includes(k)) {
		// (a question never changes the scene, even if changes came with it: the server refuses that answer, so this is only a guard)
		if ((k === "change" || k === "fix") && !hasPatches && !wholePlan) return "answer"
		return k
	}
	if (wholePlan) return FIX_RE.test(text) ? "fix" : "change"
	if (!hasPatches) return "answer"
	return FIX_RE.test(text) ? "fix" : "change"
}

/** The server's targets, tidied: [{says, ids, because?}] (≤ 20). */
export function cleanTargets(list) {
	return (Array.isArray(list) ? list : [])
		.filter(isObj)
		.map((t) => ({ says: String(t.says ?? "").trim(), ids: (Array.isArray(t.ids) ? t.ids : t.id !== undefined ? [t.id] : typeof t.ids === "string" ? [t.ids] : []).map(String), ...(typeof t.because === "string" && t.because.trim() ? { because: t.because.trim() } : {}) }))
		.filter((t) => t.says || t.ids.length)
		.slice(0, 20)
}
/** For Details: "“the yellow ball” → Ball 2" (names as on screen; an id not on screen as it is). */
export function targetWords(targets, scene) {
	const nameOf = new Map((scene?.items ?? []).map((i) => [i.id, String(i.name ?? i.id)]))
	return cleanTargets(targets).map((t) => `${t.says ? `“${t.says}”` : "(the request)"} → ${t.ids.length ? and(t.ids.map((id) => nameOf.get(id) ?? id)) : "nothing on the table"}`)
}

/**
 * §14.2 (4), as measured (arms.mjs): one repair turn when the applied change makes things start inside each other. patches: the answer's
 * patches; diff: what it changed in the scene (describeDiff lines); overlaps: [{text}] or strings; fix: the request is a "make it work".
 */
export function overlapFeedback({ patches, diff = [], overlaps = [], fix = false }) {
	const problems = overlaps.map((w) => `${typeof w === "string" ? w : w?.text ?? ""}: they must not start inside each other. Make the asked change fit (e.g. its spacing, size or place) or move the neighbour the least that makes room, and say so.`)
	return `# A check of your last answer found problems\nYou sent: ${JSON.stringify(patches ?? [])}\nWhat it changed in the scene: ${diff.join("; ") || "nothing"}\nProblems:\n${problems.map((p) => `- ${p}`).join("\n")}\nAnswer again: the WHOLE set of patches against the scene above (the scene before your first answer), doing exactly what the request asks${fix ? " (and making it work)" : ""}. If the request is a question or truly ambiguous, change nothing.`
}

/** The run's hits in order, for the model: "0.61 s Red ball hits Ramp 2 (1.20 m/s); …" (≤ 16). */
export function hitsInOrder(sim, max = 16) {
	return (sim?.summary?.events ?? [])
		.slice(0, max)
		.map((e) => `${Number(e.t ?? 0).toFixed(2)} s ${e.text}${typeof e.speed === "number" && Number.isFinite(e.speed) ? ` (${e.speed.toFixed(2)} m/s)` : ""}`)
		.join("; ")
}
/**
 * §14.2 (6b), as measured (arms.mjs): a "make it work" round, told how the last answer ran. failing: [{label, detail?}]; overlaps: [{text}].
 */
export function fixFeedback({ patches, diff = [], failing = [], overlaps = [], sim = null }) {
	const runText = hitsInOrder(sim)
	const ov = overlaps.map((w) => (typeof w === "string" ? w : w?.text ?? ""))
	return `# Your last answer was applied and run\nYou sent: ${JSON.stringify(patches ?? [])}\nWhat changed: ${diff.join("; ") || "nothing"}\nIn its run: ${failing.map((g) => `FAILED: ${g.label}${g.detail ? ` (${g.detail})` : ""}`).join("; ") || "every goal met"}.${ov.length ? ` At the start: ${ov.join("; ")} (not allowed: things must not start inside each other).` : ""} Hits in order: ${runText || "none"}.\nIt still does not work. Answer again with the WHOLE set of patches against the scene above (the scene before your first answer), changing what the run shows is wrong, by enough to make it work; keep the things the user chose. Give set_tune knobs (with ranges) on what you change, so a tuner can finish the job.`
}

/** Start-up overlaps of `after` that `before` did not have (sim/layout warnings: [{text, items}]). */
export function newOverlaps(beforeWarnings, afterWarnings) {
	const had = new Set((beforeWarnings ?? []).map((w) => w?.text))
	return (afterWarnings ?? []).filter((w) => isObj(w) && w.text && !had.has(w.text))
}

/**
 * The heads-up (§14.2 (5)), only for what the fixer's lead does not already say: stages that worked and no longer do, and firm hits (≥ 0.3
 * m/s, between things the edit left as they were) that no longer happen. lost: lostStages lines; contacts: runChanges' contact lines (the
 * "no longer hits" ones are taken); said: the lead's own words (a line it already tells is left out). -> ≤ max lines.
 */
export function headsUpLines({ lost = [], contacts = [], said = "", targets = [], max = 3 }) {
	const lead = ` ${String(said ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `
	// (the line's subject: "Dominoes: 3 of 7 fall (was 7 of 7)", "Seesaw no longer turns", "Ball 1 no longer hits Ramp 2": a thing the lead
	// already tells about is left out: the lead says what it does instead)
	const subject = (line) => String(line).split(/:| no longer | now /)[0].trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
	const told = (line) => {
		const sub = subject(line)
		return (sub.length >= 3 && lead.includes(` ${sub} `)) || targets.some((t) => t?.ok === false && String(t.label ?? "").length > 3 && String(line).toLowerCase().includes(String(t.label).toLowerCase().replace(/[.!]+$/, "")))
	}
	const out = []
	for (const l of lost) if (!told(l) && !out.includes(l)) out.push(String(l))
	for (const c of contacts) if (/ no longer hits /.test(c) && !told(c) && !out.includes(c)) out.push(String(c))
	return out.slice(0, max)
}
export const headsUpText = (lines) => (lines?.length ? `Heads-up, in the new run: ${and(lines)}.` : "")

/** The user's turn before this one (history: [{role, text}]). */
export const lastUserTurn = (history) => [...(Array.isArray(history) ? history : [])].reverse().find((h) => h?.role === "user")?.text ?? ""
/** Did that turn name the thing (by its name's first word, or its id)? A container the user just changed is never aimed. */
export function namedInTurn(item, turn) {
	if (!item || !turn) return false
	const words = [String(item.name ?? "").split(/\s+/)[0], String(item.id ?? "")].filter((w) => w.length >= 2)
	return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(turn))
}

/** "I moved the box 12 cm right (and 3 cm up), to where the ball now comes down, so “…” works again. Nothing else changed." */
export function aimReply(name, patch, label) {
	const nm = String(name ?? "the container")
	const words = [patch?.dx ? `${Math.abs(patch.dx * 100).toFixed(0)} cm ${patch.dx > 0 ? "right" : "left"}` : null, patch?.dy ? `${Math.abs(patch.dy * 100).toFixed(0)} cm ${patch.dy > 0 ? "up" : "down"}` : null].filter(Boolean).join(" and ")
	return `I moved ${nm.toLowerCase().startsWith("the ") ? nm : `the ${nm.toLowerCase()}`} ${words}, to where the ball now comes down, so “${String(label ?? "").replace(/[.!]+$/, "")}” works again. Nothing else changed.`
}
/** The honest ending of a "make it work" that still fails. */
export const stillFailsText = (labels) => (labels?.length ? `It still doesn't fully work: ${and(labels.map((l) => String(l).replace(/[.!]+$/, "")))} ${labels.length > 1 ? "fail" : "fails"} in the run.` : "")
