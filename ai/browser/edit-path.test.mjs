// node --test ai/browser/edit-path.test.mjs
// The "make it work again" aim rule of ai/DESIGN.md §14.2 (6a), repaired 2026-10-15 night: a container the user's last turn names (by any
// word of its name, or its kind's word) or the previous AI change touched is never aimed, so "make it work again" cannot undo their change.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { namedInTurn, runEdit } from "./edit-path.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..")
const ROOT = process.env.APPLY_EDIT_ROOT || REPO
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href)

test("namedInTurn: any word of the name (not only the first; not a colour, size or material) or the kind's word", () => {
	const cases = [
		[{ name: "Wicker basket", type: "basket" }, "move the basket 20 cm to the left", true],
		[{ name: "Paper cup", type: "cup" }, "push the cup further away", true],
		[{ name: "Wooden crate", type: "box" }, "slide the crate to the right", true],
		[{ name: "Wooden crate", type: "box" }, "make the box wider", true],
		[{ name: "Clear cup", type: "plastic-cup" }, "move the cups closer", true],
		[{ name: "Target", type: "plastic-cup" }, "move the cup 5 cm", true],
		[{ name: "Bucket", type: "bucket" }, "move the bucket 30 cm to the right", true],
		[{ name: "Bucket", type: "bucket" }, "swap the ball for a golf ball", false],
		[{ name: "Big red box", type: "box" }, "make the red ball bigger", false],
		[{ name: "Red cup", type: "plastic-cup" }, "swap the red ball for a golf ball", false],
		[{ name: "Red cup", type: "plastic-cup" }, "move the red cup left", true]
	]
	for (const [item, turn, want] of cases) assert.equal(namedInTurn(item, turn), want, `${item.name} / ${turn}`)
})

test("runEdit (fix): the container is aimed only when neither the user's last turn nor the previous AI change touched it", async () => {
	const solver = await imp("web/ai/solver.js")
	const orch = await imp("web/ai/orchestrator.js")
	const sim = await imp("web/sim/index.js")
	const scene = JSON.parse(readFileSync(join(REPO, "web", "scenarios", "rube-goldberg.json"), "utf8"))
	scene.items.find((i) => i.id === "box").name = "Wicker basket" // (the first word is not the one a user says)
	scene.goals = [{ kind: "in", item: "ball2", container: "box", label: "Ball 2 lands in the basket" }]
	const freeRuns = { n: 0 }
	const failing = (goals) => (goals ?? []).map((g) => ({ ...g, kind: g.kind ?? "in", ok: false, detail: "it does not end inside" }))
	const deps = {
		edit: async () => ({ kind: "fix", targets: [], mode: "patch", reply: "I adjusted it.", patches: [{ op: "set_props", id: "ball2", props: { diameter: 0.07 } }] }),
		simulate: async (s) => {
			if (!s.items.some((i) => i.id === "box")) freeRuns.n++ // (aimContainer's run of the scene without the container)
			return { summary: { goals: failing(s.goals), events: [] }, track: { frames: [] } }
		},
		applyDeps: { solve: solver.solve, planFromScene: solver.planFromScene, isStaticItem: solver.isStaticItem, applyPatches: orch.applyPatches, digestScene: orch.digestScene, layout: (s) => sim.layout(s) },
		goalResults: (run, goals) => failing(goals),
		lostStages: () => [],
		tune: async () => ({ changed: [], runs: 0 }),
		describeDiff: orch.describeDiff
	}
	const ask = (extra) => runEdit({ text: "make it work again", scene, plan: null, sim: { summary: { goals: [], events: [] } }, ...extra }, deps)
	const U = (text) => ({ role: "user", text })
	const A = (text, more = {}) => ({ role: "assistant", text, ...more })

	freeRuns.n = 0
	await ask({ history: [U("move the basket 20 cm to the left"), A("I moved the wicker basket 20 cm to the left.")] })
	assert.equal(freeRuns.n, 0, "the user's last turn named the basket (by its second word): not aimed")

	freeRuns.n = 0
	await ask({ history: [U("move it 20 cm to the left"), A("I moved the wicker basket 20 cm to the left.")], lastChange: { patches: [{ op: "move", id: "box", dx: -0.2 }], targets: [{ says: "it", ids: ["box"] }] } })
	assert.equal(freeRuns.n, 0, "the previous AI change moved it: not aimed")

	freeRuns.n = 0
	await ask({ history: [U("move it 20 cm to the left"), A("I moved the wicker basket 20 cm to the left.", { patches: [{ op: "move", id: "box", dx: -0.2 }] })] })
	assert.equal(freeRuns.n, 0, "the previous AI change, kept on its history turn: not aimed")

	freeRuns.n = 0
	await ask({ history: [U("swap the yellow ball for a tennis ball"), A("I swapped it.", { patches: [{ op: "replace_type", id: "ball2", type: "tennis-ball" }] })] })
	assert.equal(freeRuns.n, 1, "a change to something else: the basket is aimed")
})
