// The goals on an applied fix's card (./panel.js applyFix): each as the fix's own checked run has it, never as the run before the fix did. Pure.
//   import { fixedGoals } from "./fix-card.js"
//   fixedGoals(goals, results, okAll) -> [{label, ok, kind, detail?, was}]

/** "no", "no (at 0.95 s)", "no: nothing went over its rim": the words a goal's check gives a run where it did not happen. */
const MISS_RE = /^no\b/i
const YES_RE = /^yes\b/i
/** A result's ✓ or ✗ read from its own words when it has no mark: "yes (…)" or "no (…)", else null. */
const markOf = (detail) => (typeof detail !== "string" ? null : YES_RE.test(detail.trim()) ? true : MISS_RE.test(detail.trim()) ? false : null)
/**
 * The goals on an applied fix's card, each as the fix's own checked run has it (results: the offer's [{label, ok, detail?, implicit?}]): its ✓
 * and what that run shows ("survives · yes"), never the detail of the run before the fix (FR1 t2: "Goals · 2/2" over "survives · no (at 0.954
 * s)"). okAll: the fix that works (every goal ✓); else the closest miss, each goal as its run has it. A goal matched by its label, else (a goal
 * the run gave no label, "the goal") by its place among the goals; one the run has no words for shows its ✓ or ✗ alone, and never words that
 * say the other way ("✓ … · no"); an "in" goal's mark says it all, as on every card.
 */
export function fixedGoals(goals, results, okAll) {
	const list = Array.isArray(goals) ? goals : []
	const rs = (Array.isArray(results) ? results : []).filter((r) => r && typeof r === "object")
	const explicit = rs.filter((r) => !r.implicit)
	const unmatched = list.filter((g) => !rs.some((r) => r.label === g?.label))
	return list.map((g) => {
		let r = rs.find((x) => x.label === g?.label)
		// (a goal without a label of its own: the fix's run calls it "the goal", the card by its kind's words; matched when it is the only one)
		if (!r && unmatched.length === 1) {
			const loose = explicit.filter((x) => !list.some((y) => y?.label === x.label))
			if (loose.length === 1) r = loose[0]
		}
		const { detail: _was, ...rest } = g ?? {}
		const ok = okAll ? true : r?.ok ?? g?.ok ?? null
		const kind = g?.kind ?? r?.kind ?? "in"
		const said = r && typeof r.detail === "string" && r.detail.trim() ? r.detail.trim() : null
		// (its run's words only when they agree with its mark: never "✓ … · no")
		const agree = said !== null && r.ok === ok && markOf(said) !== (ok === true ? false : ok === false ? true : undefined)
		const words = kind !== "in" && agree ? said : null
		return { ...rest, ok, ...(words ? { detail: words } : {}), was: g?.ok ?? null }
	})
}
