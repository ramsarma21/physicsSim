// The goals on an applied fix's card (web/ai/fix-card.js fixedGoals, used by web/ai/panel.js applyFix): each as the fix's own checked run has it,
// never the run before the fix ("Goals · 2/2" over "survives · no (at 0.954 s)": FR1 t2, the flow module's cap, fluids' e3-fan).
//   node --test web/ai/test/fix-card.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"
import { fixedGoals } from "../fix-card.js"

const cardLine = (g) => `${g.ok === true ? "✓" : g.ok === false ? "✗" : "?"} ${g.label}${g.detail ? ` · ${g.detail}` : ""}`

test("a checked fix: every goal ✓ with what the fix's own run shows, never the miss the run before it showed", () => {
	const before = [
		{ label: "The egg dropped on the bare table cracks", ok: true, kind: "cracks", detail: "yes (at 0.954 s)" },
		{ label: "The egg dropped on the thick foam survives", ok: false, kind: "survives", detail: "no (at 0.954 s)" }
	]
	const results = [
		{ label: "The egg dropped on the bare table cracks", ok: true, detail: "yes (at 0.954 s)" },
		{ label: "The egg dropped on the thick foam survives", ok: true, detail: "yes" }
	]
	const g = fixedGoals(before, results, true)
	assert.deepEqual(g.map(cardLine), ["✓ The egg dropped on the bare table cracks · yes (at 0.954 s)", "✓ The egg dropped on the thick foam survives · yes"])
	assert.deepEqual(g.map((x) => x.was), [true, false], "what each was before the fix is kept beside it")
	assert.ok(!g.some((x) => x.ok === true && /^no\b/.test(x.detail ?? "")), "no met goal says no")
})

test("a fix saved before its run's words were kept: the marks alone, never the old words", () => {
	const g = fixedGoals([{ label: "The cup fills to 200 mL", ok: false, kind: "fills", detail: "no (106 mL by the end)" }], [{ label: "The cup fills to 200 mL", ok: true }], true)
	assert.deepEqual(g.map(cardLine), ["✓ The cup fills to 200 mL"])
})

test("the closest miss: each goal as its own run has it, a goal that now works with its words, one that still fails with its own", () => {
	const before = [
		{ label: "The jar fills to 120 mL", ok: false, kind: "fills", detail: "no (106 mL)" },
		{ label: "Ball 2 lands in the box", ok: false, kind: "in" }
	]
	const results = [
		{ label: "The jar fills to 120 mL", ok: true, detail: "yes (at 2.78 s)" },
		{ label: "Ball 2 lands in the box", ok: false, detail: "it does not end inside" }
	]
	assert.deepEqual(fixedGoals(before, results, false).map(cardLine), ["✓ The jar fills to 120 mL · yes (at 2.78 s)", "✗ Ball 2 lands in the box"])
})

test("words that say the other way from a goal's mark are left out (never '✓ … · no'); a goal without a label of its own is matched to the run's 'the goal'", () => {
	const g = fixedGoals([{ label: "Cup overflows", ok: false, kind: "overflows", detail: "no: nothing went over its rim" }], [{ label: "Cup overflows", ok: true, detail: "no: nothing went over its rim" }], true)
	assert.deepEqual(g.map(cardLine), ["✓ Cup overflows"])
	const u = fixedGoals([{ label: "Sand timer runs out", ok: false, kind: "sand_runs_out", detail: "no (it jams)" }], [{ label: "the goal", ok: true, detail: "yes (ran out after 29.8 lesson s)" }], false)
	assert.deepEqual(u.map(cardLine), ["✓ Sand timer runs out · yes (ran out after 29.8 lesson s)"])
	assert.deepEqual(fixedGoals(null, null, true), [])
})
