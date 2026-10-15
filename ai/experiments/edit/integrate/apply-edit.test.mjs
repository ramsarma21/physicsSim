// node --test ai/experiments/edit/integrate/apply-edit.test.mjs      (APPLY_EDIT_ROOT=<a frozen copy> to test against one)
// The properties the edit experiment relies on, on the starter Rube Goldberg machine, against the live web/ai + web/sim (or a frozen copy).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applyEdit } from "./apply-edit.js"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const ROOT = process.env.APPLY_EDIT_ROOT || REPO
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href)
const solver = await imp("web/ai/solver.js")
const orch = await imp("web/ai/orchestrator.js")
const sim = await imp("web/sim/index.js")
const deps = { solve: solver.solve, planFromScene: solver.planFromScene, isStaticItem: solver.isStaticItem, applyPatches: orch.applyPatches, digestScene: orch.digestScene, layout: (s) => sim.layout(s) }
const starter = JSON.parse(readFileSync(join(REPO, "web", "scenarios", "rube-goldberg.json"), "utf8"))
const item = (s, id) => s.items.find((i) => i.id === id)
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))

test("a move changes that item by exactly the asked amount; every other item stays byte for byte", () => {
	const r = applyEdit({ scene: starter }, [{ op: "move", id: "box", dx: -0.1 }], deps)
	assert.ok(!r.error, r.error)
	assert.ok(Math.abs(item(r.scene, "box").x - (item(starter, "box").x - 0.1)) < 1e-6)
	assert.equal(item(r.scene, "box").y, item(starter, "box").y)
	for (const it of starter.items) if (it.id !== "box") same(item(r.scene, it.id), it)
	assert.equal(r.overlaps.length, 0)
})

test("a swap keeps the seat: on its support at the same x, or (held in the air) its lowest point", () => {
	const r = applyEdit({ scene: starter }, [{ op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "replace_type", id: "ball1", type: "basketball" }], deps)
	assert.ok(!r.error, r.error)
	assert.equal(item(r.scene, "ball2").type, "tennis-ball")
	assert.ok(Math.abs(item(r.scene, "ball2").x - item(starter, "ball2").x) < 0.002)
	const b1 = item(r.scene, "ball1")
	assert.equal(b1.type, "basketball")
	assert.ok(b1.held)
	assert.ok(Math.abs(b1.y - 0.121 - (item(starter, "ball1").y - 0.03)) < 0.003, `basketball bottom ${b1.y - 0.121}`)
	assert.equal(r.overlaps.length, 0)
	for (const id of ["ramp1", "ramp2", "dominoes", "seesaw", "box", "table"]) same(item(r.scene, id), item(starter, id))
})

test("what rests on (or is held just above) a moved thing goes with it", () => {
	const r = applyEdit({ scene: starter }, [{ op: "move", id: "ramp1", dy: 0.1 }], deps)
	assert.ok(Math.abs(item(r.scene, "ball1").y - (item(starter, "ball1").y + 0.1)) < 1e-6)
	const s = applyEdit({ scene: starter }, [{ op: "move", id: "seesaw", dx: 0.03 }], deps)
	assert.ok(Math.abs(item(s.scene, "ball2").x - (item(starter, "ball2").x + 0.03)) < 0.002)
	same(item(s.scene, "box"), item(starter, "box"))
})

test("a new thing put inside a safety wall is slid off it", () => {
	const r = applyEdit({ scene: starter }, [{ op: "add", item: { id: "t1", type: "tennis-ball", place: { on: "table", x: -0.53 } } }], deps)
	assert.equal(r.overlaps.length, 0)
	assert.ok(item(r.scene, "t1").x > -0.47)
})

test("timing patches change only the timing", () => {
	const r = applyEdit({ scene: starter }, [{ op: "set_scene", release: 2 }], deps)
	assert.equal(r.scene.release, 2)
	assert.equal(r.scene.seconds, starter.seconds)
	for (const it of starter.items) same(item(r.scene, it.id), it)
})
