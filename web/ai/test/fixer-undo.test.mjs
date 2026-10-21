// The make-it-work search never undoes a module's switch, pick-from-list or link that the edit set for a request that only states its outcome
// (web/ai/fixer.js knobCandidates `undoes`): a flip, a choice or a link put back as it was before the edit is the whole way back, which such a
// request never goes (a number may go back at most a quarter of the way). It is kept aside, so the card says honestly when only undoing the
// change would work. A switch the AI changed on its own in a plain edit may still be put back, as before.
//   node --test web/ai/test/fixer-undo.test.mjs
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const PG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "flow,fluids,heat"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const { findFix } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const bundle = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)

const run = (scene) => {
	const p = sim.prepare(scene)
	const track = JSON.parse(JSON.stringify(bundle.run(p.doc, 120)))
	const fin = sim.finish(p.scene, p.doc, p.resolved, track)
	return { scene: p.scene, doc: p.doc, track, summary: fin.summary, resolved: p.resolved, warnings: fin.warnings ?? [] }
}
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, goals = [], seconds = 2) => ({ version: 2, id: "t", name: "t", seconds, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, ...items], goals })
const hasType = (t) => sim.catalog().types.some((x) => x.key === t)
/** A search whose engine is a stand-in: every candidate scene it would run is kept, and `works(scene)` says which pass (no engine runs). */
async function search(ctx, works) {
	const tried = []
	const evaluate = async (sc, tg) => {
		tried.push(sc)
		const ok = works(sc)
		return { ok, results: tg.map((t) => ({ label: t.label, ok })), f: ok ? 0 : 1, warn: 0 }
	}
	const fr = await findFix(ctx, { evaluate, budgetMs: 20000, maxRuns: 400, parallel: 1 })
	return { fr, tried }
}
const capOf = (sc) => sc.items.find((i) => i.id === "b")?.props?.cap === true

test("a request that only states its outcome: the cap it put on is never taken off by the fix search (only undoing it would work: said)", { skip: !hasType("leaky-bottle") && "no flow module" }, async () => {
	const before = scene([{ id: "b", type: "leaky-bottle", name: "Bottle", x: 0.5, y: 0, props: { kept_full: true } }], [{ kind: "jet_farthest", item: "b", hole: 1 }])
	const B = run(before)
	assert.equal(B.summary.goals[0].ok, true, "the jets spurt")
	const capped = { ...before, items: before.items.map((i) => (i.id === "b" ? { ...i, props: { ...i.props, cap: true } } : i)) }
	const R = run(capped)
	assert.equal(R.summary.goals[0].ok, false, "with the cap on nothing comes out")
	const ctx = { scene: R.scene, sim: R, goals: R.scene.goals, touched: new Map([["b", new Set(["cap"])]]), before: { scene: B.scene, sim: B }, flex: true }
	const { fr, tried } = await search(ctx, (sc) => !capOf(sc))
	assert.notEqual(fr.status, "found", JSON.stringify(fr.fix?.changes))
	assert.ok(fr.undoOnly && /cap/.test(JSON.stringify(fr.undoOnly)), `the card can say only undoing it would work: ${JSON.stringify(fr.undoOnly)}`)
	// (the one run with the cap off is the check, after the search, that undoing it alone would work: never a candidate offered)
	assert.deepEqual(tried.map((sc, i) => (!capOf(sc) ? i : -1)).filter((i) => i >= 0), [tried.length - 1], "no candidate the search runs takes the cap off")
	// (and the same request in a plain edit where the AI put the cap on of its own accord, its words naming no cap: the search may take it off)
	const plain = { ...ctx, flex: false, relaxed: true, hard: new Map(), forward: new Map() }
	const p = await search(plain, (sc) => !capOf(sc))
	assert.equal(p.fr.status, "found", "a switch the person never chose may be put back")
	assert.ok(p.fr.fix.changes.some((c) => c.key === "cap" && c.to === false), JSON.stringify(p.fr.fix.changes))
})

test("a pick-from-list setting the outcome request changed is never put back as it was; another choice may still be tried", { skip: !hasType("meltable") && "no heat module" }, async () => {
	const before = scene([{ id: "m", type: "meltable", name: "Block", x: 1.2, y: 0.005, props: { material: "butter" } }], [{ kind: "melts", item: "m" }], 1)
	const B = run(before)
	const wax = { ...before, items: before.items.map((i) => (i.id === "m" ? { ...i, props: { ...i.props, material: "wax" } } : i)) }
	const R = run(wax)
	assert.equal(R.summary.goals[0].ok, false, "the wax block does not melt in a room")
	const ctx = { scene: R.scene, sim: R, goals: R.scene.goals, touched: new Map([["m", new Set(["material"])]]), before: { scene: B.scene, sim: B }, flex: true }
	const materialOf = (sc) => sc.items.find((i) => i.id === "m")?.props?.material ?? "butter"
	const { tried } = await search(ctx, () => false)
	const cands = tried.slice(1, -1)
	assert.ok(!cands.some((sc) => materialOf(sc) === "butter"), "never back to butter")
	assert.ok(cands.some((sc) => materialOf(sc) === "chocolate"), "another material may still be tried")
})

test("a link the outcome request made (the lamp aimed at the other cube) is never put back to what it named before", { skip: !hasType("lamp") && "no heat module" }, async () => {
	const before = scene(
		[
			{ id: "lamp", type: "lamp", name: "Desk lamp", x: 0.9, y: 0, props: { target: "a" } },
			{ id: "a", type: "ice-cube", name: "Cube A", x: 1.15, y: 0.02 },
			{ id: "b", type: "ice-cube", name: "Cube B", x: 1.45, y: 0.02 }
		],
		[{ kind: "melts_first", a: "b", b: "a" }],
		1
	)
	const B = run(before)
	const aimed = { ...before, items: before.items.map((i) => (i.id === "lamp" ? { ...i, props: { ...i.props, target: "b" } } : i)) }
	const R = run(aimed)
	if (!R.summary.goals?.length || R.summary.goals[0].ok !== false) return // (a catalog whose heat says otherwise: nothing to search)
	const ctx = { scene: R.scene, sim: R, goals: R.scene.goals, touched: new Map([["lamp", new Set(["target"])]]), before: { scene: B.scene, sim: B }, flex: true }
	const targetOf = (sc) => sc.items.find((i) => i.id === "lamp")?.props?.target ?? null
	const { tried } = await search(ctx, () => false)
	assert.ok(tried.length > 2, "the search ran")
	assert.ok(!tried.slice(1, -1).some((sc) => targetOf(sc) === "a"), "the lamp is never aimed back at cube A")
})
