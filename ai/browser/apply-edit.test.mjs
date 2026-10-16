// node --test ai/browser/apply-edit.test.mjs      (APPLY_EDIT_ROOT=<a frozen copy> to test against one)
// The properties the browser contract (ai/DESIGN.md §14.2 (3)) relies on, against the live web/ai + web/sim (or a frozen copy): on the starter
// and two built-in scenes (hand-made: no plan) and on five AI-built scenes with the plans that made them (ai/browser/fixtures: leaning
// planks, solver-added stands, a layout the solver shifted to stand on the table).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applyEdit, rebuilds } from "./apply-edit.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")
const ROOT = process.env.APPLY_EDIT_ROOT || REPO
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href)
const solver = await imp("web/ai/solver.js")
const orch = await imp("web/ai/orchestrator.js")
const sim = await imp("web/sim/index.js")
const deps = { solve: solver.solve, planFromScene: solver.planFromScene, isStaticItem: solver.isStaticItem, applyPatches: orch.applyPatches, digestScene: orch.digestScene, layout: (s) => sim.layout(s) }
const scenario = (id) => ({ scene: JSON.parse(readFileSync(join(REPO, "web", "scenarios", `${id}.json`), "utf8")), plan: null })
const aiBuilt = (id) => {
	const r = JSON.parse(readFileSync(join(HERE, "fixtures", `${id}.json`), "utf8"))
	return { scene: r.scene, plan: r.plan }
}
const starter = scenario("rube-goldberg").scene
const item = (s, id) => s.items.find((i) => i.id === id)
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what ?? "value"}: ${a} vs ${b} (±${tol})`)
/** Every item but `except` is byte for byte what it was. */
function untouched(base, after, except = []) {
	for (const it of base.items) if (!except.includes(it.id)) same(item(after, it.id), it)
	assert.equal(after.items.length, base.items.length)
}

test("a move changes that item by exactly the asked amount; every other item stays byte for byte", () => {
	const r = applyEdit({ scene: starter }, [{ op: "move", id: "box", dx: -0.1 }], deps)
	assert.ok(!r.error, r.error)
	near(item(r.scene, "box").x, item(starter, "box").x - 0.1, 1e-6, "box x")
	assert.equal(item(r.scene, "box").y, item(starter, "box").y)
	untouched(starter, r.scene, ["box"])
	assert.equal(r.overlaps.length, 0)
	assert.equal(r.shortfalls.length, 0)
})

test("a swap keeps the seat: on its support at the same x, or (held in the air) its lowest point", () => {
	const r = applyEdit({ scene: starter }, [{ op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "replace_type", id: "ball1", type: "basketball" }], deps)
	assert.ok(!r.error, r.error)
	assert.equal(item(r.scene, "ball2").type, "tennis-ball")
	near(item(r.scene, "ball2").x, item(starter, "ball2").x, 0.002, "tennis ball x")
	const b1 = item(r.scene, "ball1")
	assert.equal(b1.type, "basketball")
	assert.ok(b1.held)
	near(b1.y - 0.121, item(starter, "ball1").y - 0.03, 0.003, "basketball bottom")
	assert.equal(r.overlaps.length, 0)
	untouched(starter, r.scene, ["ball1", "ball2"])
})

test("what rests on (or is held just above) a moved thing rides with it, rigidly", () => {
	const r = applyEdit({ scene: starter }, [{ op: "move", id: "ramp1", dy: 0.1 }], deps)
	near(item(r.scene, "ball1").y, item(starter, "ball1").y + 0.1, 1e-6, "ball1 y")
	near(item(r.scene, "ball1").x, item(starter, "ball1").x, 1e-6, "ball1 x")
	const s = applyEdit({ scene: starter }, [{ op: "move", id: "seesaw", dx: 0.03 }], deps)
	const dx = item(s.scene, "seesaw").x - item(starter, "seesaw").x
	const dy = item(s.scene, "seesaw").y - item(starter, "seesaw").y
	near(dx, 0.03, 1e-6, "seesaw dx")
	near(item(s.scene, "ball2").x, item(starter, "ball2").x + dx, 1e-6, "ball2 x")
	near(item(s.scene, "ball2").y, item(starter, "ball2").y + dy, 1e-6, "ball2 y (its seat on the seesaw)")
	untouched(starter, s.scene, ["seesaw", "ball2"])
})

test("a new thing put inside a safety wall is slid off it", () => {
	const r = applyEdit({ scene: starter }, [{ op: "add", item: { id: "t1", type: "tennis-ball", place: { on: "table", x: -0.53 } } }], deps)
	assert.equal(r.overlaps.length, 0)
	assert.ok(item(r.scene, "t1").x > -0.47)
	assert.match(r.madeRoom.join(" "), /safety wall/)
})

test("timing patches change only the timing", () => {
	const r = applyEdit({ scene: starter }, [{ op: "set_scene", release: 2 }], deps)
	assert.equal(r.scene.release, 2)
	assert.equal(r.scene.seconds, starter.seconds)
	untouched(starter, r.scene)
})

test("a rename, a material or a mass changes only that field: the item keeps its exact pose and its own props", () => {
	const r = applyEdit({ scene: starter }, [{ op: "set_props", id: "box", props: { material: "steel" } }, { op: "set_item", id: "box", name: "Steel box" }, { op: "set_props", id: "ball2", props: { mass: 0.015 } }], deps)
	same(item(r.scene, "box"), { ...item(starter, "box"), name: "Steel box", props: { ...item(starter, "box").props, material: "steel" } })
	same(item(r.scene, "ball2"), { ...item(starter, "ball2"), props: { ...(item(starter, "ball2").props ?? {}), mass: 0.015 } })
	untouched(starter, r.scene, ["box", "ball2"])
	assert.deepEqual(r.kept.sort(), ["ball2", "box"])
})

// ---- the AI-built scenes: the plan is used only when it rebuilds the scene; nothing but the asked change moves
test("AI scene with a leaning board (photo-board-bucket-34): 'nudge the bucket a bit right' moves it exactly 4 cm, nothing else", () => {
	const base = aiBuilt("photo-board-bucket-34")
	assert.equal(rebuilds(base.plan, base.scene, solver.solve), 0)
	const r = applyEdit(base, [{ op: "move", id: "bucket", dx: 0.04 }], deps)
	assert.ok(!r.error, r.error)
	assert.equal(r.base, "plan")
	near(item(r.scene, "bucket").x, item(base.scene, "bucket").x + 0.04, 1e-6, "bucket x")
	untouched(base.scene, r.scene, ["bucket"])
	assert.deepEqual([r.overlaps.length, r.shortfalls.length], [0, 0])
	// (the measured v3 moved it 13.4 cm: the pinned board was solved as a default 1 m plank and pushed it; even dx 0 moved it)
	same(applyEdit(base, [{ op: "move", id: "bucket", dx: 0 }], deps).scene, base.scene)
})

test("AI scene with a leaning ramp on books (gt-book-ramp-ball): 4 inches left is 10.16 cm; touching a book under the ramp leaves the ramp alone", () => {
	const base = aiBuilt("gt-book-ramp-ball")
	const r = applyEdit(base, [{ op: "move", id: "cup", dx: -0.1016 }], deps)
	near(item(r.scene, "cup").x, item(base.scene, "cup").x - 0.1016, 1e-6, "cup x")
	untouched(base.scene, r.scene, ["cup"])
	const t = applyEdit(base, [{ op: "set_item", id: "book1", name: "Bottom book" }], deps)
	same(item(t.scene, "book1"), { ...item(base.scene, "book1"), name: "Bottom book" })
	untouched(base.scene, t.scene, ["book1"])
})

test("AI scene (photo-rube-chain): two more dominoes keep the row where it was; a rename moves nothing", () => {
	const base = aiBuilt("photo-rube-chain")
	const r = applyEdit(base, [{ op: "set_props", id: "dominoes", props: { count: 7 } }], deps)
	assert.ok(!r.error, r.error)
	near(item(r.scene, "dominoes").x, item(base.scene, "dominoes").x, 1e-6, "dominoes x")
	const box = (s) => orch.digestScene(s).items.find((q) => q.id === "dominoes").box
	assert.ok(box(r.scene).x1 - box(r.scene).x0 > box(base.scene).x1 - box(base.scene).x0 + 0.04, "the row is 2 dominoes (4.4 cm) longer")
	near(box(r.scene).x0, box(base.scene).x0, 1e-4, "its left end stays")
	// (only the row and what its place refers to, the car beside it, may move; the measured v3 moved the row 35.6 cm and the car 40 cm)
	for (const it of base.scene.items) if (!["dominoes", ...r.dependents].includes(it.id)) same(item(r.scene, it.id), it)
	for (const id of r.dependents) near(item(r.scene, id).x, item(base.scene, id).x, 0.06, `${id} x`)
	const n = applyEdit(base, [{ op: "set_item", id: "dominoes", name: "Domino row" }], deps)
	untouched(base.scene, n.scene, ["dominoes"])
	same(item(n.scene, "dominoes"), { ...item(base.scene, "dominoes"), name: "Domino row" })
})

test("AI scenes: a no-op touch of any item moves nothing (the 3 scenes above, every item)", () => {
	for (const id of ["photo-board-bucket-34", "gt-book-ramp-ball", "photo-rube-chain", "c1-rube-cup", "g2-chain-reaction"]) {
		const base = aiBuilt(id)
		for (const it of base.scene.items) {
			if (it.type === "table" || (it.type === "wall" && it.props?.invisible_in_3d)) continue
			const r = applyEdit(base, [{ op: "set_item", id: it.id, name: it.name ?? it.id }], deps)
			assert.ok(!r.error, `${id}/${it.id}: ${r.error}`)
			same(r.scene, base.scene)
		}
	}
})

test("AI scene with solver-added stands (c1-rube-cup): they stay with an untouched funnel and go with a removed one", () => {
	const base = aiBuilt("c1-rube-cup")
	const r = applyEdit(base, [{ op: "move", id: "cup", dx: 0.1 }], deps)
	untouched(base.scene, r.scene, ["cup"])
	const gone = applyEdit(base, [{ op: "remove", id: "funnel" }], deps)
	assert.deepEqual(gone.scene.items.filter((i) => /^funnel/.test(i.id)).map((i) => i.id), [])
})

test("AI scene whose layout the solver shifted onto the table (g2-chain-reaction): a 2 cm move is 2 cm in the scene", () => {
	const base = aiBuilt("g2-chain-reaction")
	assert.ok(Math.abs(rebuilds(base.plan, base.scene, solver.solve)) > 0.05)
	const r = applyEdit(base, [{ op: "move", id: "pendulum", dx: 0.02 }], deps)
	assert.equal(r.base, "plan")
	near(item(r.scene, "pendulum").x, item(base.scene, "pendulum").x + 0.02, 1e-6, "pendulum x")
	untouched(base.scene, r.scene, ["pendulum"])
})

// ---- what the solver would have hidden
test("a move the solver cannot make in full (the seesaw 10 cm left, the dominoes 7.6 cm away): exact by default, the overlap returned", () => {
	const r = applyEdit({ scene: starter }, [{ op: "move", id: "seesaw", dx: -0.1 }], deps)
	near(item(r.scene, "seesaw").x, item(starter, "seesaw").x - 0.1, 1e-6, "seesaw x")
	near(item(r.scene, "ball2").x, item(starter, "ball2").x - 0.1, 1e-6, "ball2 rides along")
	assert.equal(r.shortfalls.length, 1)
	assert.equal(r.shortfalls[0].id, "seesaw")
	assert.match(r.shortfalls[0].why, /Dominoes/)
	assert.ok(r.overlaps.some((w) => w.items.includes("seesaw") && w.items.includes("dominoes")), JSON.stringify(r.overlaps))
	untouched(starter, r.scene, ["seesaw", "ball2"])
	// exact: false (after the one repair turn failed): where the solver could put it, said in madeRoom; ball 2 keeps its seat on it
	const y = applyEdit({ scene: starter }, [{ op: "move", id: "seesaw", dx: -0.1 }], deps, { exact: false })
	const dx = item(y.scene, "seesaw").x - item(starter, "seesaw").x
	assert.ok(dx > -0.08 && dx < -0.06, `seesaw moved ${dx}`)
	near(item(y.scene, "ball2").x - item(starter, "ball2").x, dx, 1e-6, "ball2 moved with the seesaw")
	assert.equal(y.overlaps.length, 0)
	assert.match(y.madeRoom.join(" "), /Seesaw moved only 6\.\d cm left \(not 10\.0 cm left\): to clear Dominoes/)
	untouched(starter, y.scene, ["seesaw", "ball2"])
})

test("a change that no longer fits on the table is returned, never shifted out of sight (14 dominoes)", () => {
	const base = scenario("pendulum-dominoes")
	const r = applyEdit(base, [{ op: "set_props", id: "dominoes", props: { count: 14 } }], deps)
	near(item(r.scene, "dominoes").x, item(base.scene, "dominoes").x, 1e-6, "dominoes x")
	assert.ok(r.overlaps.some((w) => /past the table's right end/.test(w.text)), JSON.stringify(r.overlaps))
	untouched(base.scene, r.scene, ["dominoes"])
})

test("a leaning ramp moved off the book it rests on is an error, not a silent re-placement", () => {
	const base = aiBuilt("photo-board-bucket-34")
	const r = applyEdit(base, [{ op: "move", id: "board", dx: 0.4 }], deps)
	assert.ok(r.errors.length || r.overlaps.length, "the solver's trouble is returned")
})

test("a moved or resized thing's JSON changes only where the edit changed it (the props the solver leaves out as defaults stay as the scene wrote them)", () => {
	const r = applyEdit({ scene: starter }, [{ op: "move", id: "box", dx: -0.1 }, { op: "move", id: "seesaw", dx: 0.02 }], deps)
	assert.ok(!r.error, r.error)
	for (const id of ["box", "seesaw"]) {
		const a = item(starter, id)
		const b = item(r.scene, id)
		assert.deepEqual(Object.keys(b), Object.keys(a), `${id}: the same fields, in the same order`)
		assert.deepEqual(b.props, a.props, `${id}: its props as they were (box width 0.26 and wall 0.13 are the defaults)`)
	}
	const pd = scenario("pendulum-dominoes").scene
	const r2 = applyEdit({ scene: pd }, [{ op: "set_props", id: "dominoes", props: { count: 14, growth: 1.1 } }], deps)
	const d0 = item(pd, "dominoes")
	assert.deepEqual(item(r2.scene, "dominoes").props, { ...d0.props, count: 14, growth: 1.1 })
})

test("only what is held just above a moved thing rides with it: a pendulum whose swing outline reaches over the first domino stays when the row moves", () => {
	const pd = scenario("pendulum-dominoes").scene
	const r = applyEdit({ scene: pd }, [{ op: "move", id: "dominoes", dx: 0.3 }], deps)
	assert.ok(!r.error, r.error)
	assert.deepEqual(r.riders, [])
	untouched(pd, r.scene, ["dominoes"])
	near(item(r.scene, "dominoes").x, item(pd, "dominoes").x + 0.3, 1e-6, "dominoes x")
})
