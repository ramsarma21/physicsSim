// Hand-made answers for the edit cases d6-d19 (cases/text.json): each is the edit a careful person would make, written as the edit step's own
// patches (or a whole plan) and applied exactly as the app applies them (web/ai/orchestrator.js applyPatches on the base plan, or
// solver.planFromScene for a hand-made scene), then solved. Writes reference/<id>.json {case, notes, plan, scene, reply?}; tools/selftest.mjs
// then proves every one passes its case (and so that each case can be passed).
//   node ai/bench/tools/make-edit-references.mjs [ids...]
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const BENCH = path.resolve(HERE, "..")
const ROOT = path.resolve(BENCH, "../..")
const { solve, planFromScene } = await import(pathToFileURL(path.join(ROOT, "web/ai/solver.js")).href)
const { applyPatches } = await import(pathToFileURL(path.join(ROOT, "web/ai/orchestrator.js")).href)
const { loadBench, baseSceneOf, scoreCase } = await import(pathToFileURL(path.join(BENCH, "score.mjs")).href)

const bench = loadBench()
const ANSWERS = {
	// round 2 (2026-10-15, ai/DESIGN.md §13.8): changes to the starter and two other scenes that must stay edits
	"d20-starter-swap-balls": { patches: [{ op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "set_place", id: "ball2", place: { on: "seesaw", x: 3.02 } }, { op: "replace_type", id: "ball1", type: "basketball" }, { op: "set_place", id: "ball1", place: { on: "ramp1", x: 0 } }], reply: "Swapped both balls in place; the heavier tennis ball may not reach the box now, so the tuner may need another run." },
	"d21-starter-taller-dominoes": { patches: [{ op: "set_props", id: "dominoes", props: { first_height: 0.13, spacing: 0.42 } }], reply: "The dominoes are a third taller, set closer so the row keeps its length; the chain may not reach the box the same way, so the tuner may need another run." },
	"d22-starter-move-box": { patches: [{ op: "move", id: "box", dx: 0.2 }], reply: "Moved the box 20 cm right; the ball may now miss it." },
	"d23-starter-steel-box": { patches: [{ op: "set_props", id: "box", props: { material: "steel" } }], reply: "The box is steel now." },
	"d24-starter-new-scene-wording": { patches: [{ op: "replace_type", id: "ball1", type: "bowling-ball" }, { op: "set_place", id: "ball1", place: { on: "ramp1", x: 0 } }], reply: "Kept the machine and made the red ball a bowling ball; the chain may run differently, so the tuner may need another run." },
	"d25-starter-make-it-work-again": { patches: [{ op: "move", id: "box", dy: -0.3 }] },
	"d26-car-add-dominoes": { patches: [{ op: "set_props", id: "dominoes", props: { count: 10 } }] },
	"d27-conveyor-tennis-balls": { patches: [{ op: "replace_type", id: "ball1", type: "tennis-ball" }, { op: "replace_type", id: "ball2", type: "tennis-ball" }, { op: "replace_type", id: "ball3", type: "tennis-ball" }] },
	"d28-conveyor-make-it-work-again": { patches: [{ op: "move", id: "box", dx: -0.6 }] },
	"d29-trampoline-soccer": { patches: [{ op: "replace_type", id: "basketball", type: "soccer-ball" }] },
	"d30-starter-box-left": { patches: [{ op: "move", id: "box", dx: -0.1 }], reply: "Moved the box 10 cm left; the ball may now miss it." },
	"d31-starter-five-more-dominoes": { patches: [{ op: "set_props", id: "dominoes", props: { count: 12, growth: 1.04, spacing: 0.42 } }], reply: "Twelve dominoes now; I lowered the growth and set them a little closer so the row keeps its length and the last ones stay a sensible size." },
	"d6-raise-bowling": { patches: [{ op: "move", id: "bowling", dy: 0.391 }] },
	"d7-longer-pendulum": { patches: [{ op: "set_props", id: "pendulum", props: { length: 0.8 } }, { op: "move", id: "pendulum", dy: 0.2 }] },
	"d8-faster-belt": { patches: [{ op: "set_props", id: "belt", props: { speed: 2 } }] }, // (the open box still catches all three at 2 m/s)
	"d9-cradle-question": { patches: [], reply: "It has five balls." },
	"d10-second-cup": { patches: [{ op: "add", item: { id: "cup2", type: "cup", name: "Second cup", props: { width: 0.12, wall: 0.12 }, place: { on: "table", x: 2.29 } } }] },
	"d11-remove-superball": { patches: [{ op: "remove", id: "superball" }] },
	"d12-ten-seconds": { patches: [{ op: "set_scene", seconds: 10 }] },
	"d13-start-over": {
		plan: {
			title: "Tennis ball into a cup",
			seconds: 4,
			release: 0.5,
			items: [
				{ id: "ramp", type: "plank", name: "Ramp", place: { lean: { from: { on: "air", x: 0.2, y: 0.45 }, to: { on: "air", x: 0.8, y: 0.25 } } } },
				{ id: "ball", type: "tennis-ball", name: "Tennis ball", place: { on: "ramp", x: 0.26 }, held: true },
				{ id: "cup", type: "cup", name: "Cup", props: { width: 0.16, wall: 0.1 }, place: { on: "table", x: 1.05 } }
			],
			missing: [],
			goals: [{ label: "The tennis ball lands in the cup", item: "ball", container: "cup" }],
			tune: [{ id: "cup", param: "x", min: 0.9, max: 1.7 }]
		}
	},
	"d14-steeper-ramp": { patches: [{ op: "add", item: { id: "book4", type: "hardcover-book", name: "Fourth book", place: { on: "book3", x: 0.6645 } } }, { op: "move", id: "ramp", angle_deg: -13 }, { op: "move", id: "ball", dy: 0.04 }] },
	"d15-ball-on-books": { patches: [{ op: "add", item: { id: "tennis", type: "tennis-ball", name: "Tennis ball", place: { on: "b4", x: 1.3 } } }] },
	"d16-four-oranges": { patches: [{ op: "add", item: { id: "orange4", type: "orange", name: "Orange 4", place: { on: "belt", x: 0.41 } } }] },
	"d17-drop-50cm": { patches: [{ op: "move", id: "steel", y_m: 0.5127 }, { op: "move", id: "rubber", y_m: 0.53 }] },
	"d18-bigger-seesaw-ball": { patches: [{ op: "set_props", id: "ball2", props: { diameter: 0.12 } }, { op: "set_place", id: "ball2", place: { on: "seesaw", x: 3.02 } }] },
	"d19-history-truck": { patches: [{ op: "replace_type", id: "car", type: "truck" }, { op: "set_props", id: "ramp", props: { length: 1.1 } }, { op: "set_place", id: "car", place: { on: "ramp", x: -0.05 } }] }
}

const only = process.argv.slice(2)
for (const [id, a] of Object.entries(ANSWERS)) {
	if (only.length && !only.includes(id)) continue
	const c = bench.cases.get(id)
	const base = baseSceneOf(c)
	const ref = String(c.base_scene).startsWith("reference:") ? JSON.parse(fs.readFileSync(path.join(BENCH, "reference", `${c.base_scene.slice(10)}.json`), "utf8")) : null
	const basePlan = ref ? ref.plan : planFromScene(base)
	let plan
	if (a.plan) plan = a.plan
	else if (a.patches.length) {
		const r = applyPatches(basePlan, a.patches, base)
		if (r.skipped.length) console.log(`${id}: skipped ${r.skipped.join("; ")}`)
		plan = r.plan
	} else plan = basePlan
	const scene = a.patches?.length === 0 ? base : solve(plan).scene
	if (a.plan === undefined && a.patches.length === 0) scene.name = base.name
	const out = { case: id, notes: "hand-made edit (tools/make-edit-references.mjs)", plan, scene, ...(a.reply ? { reply: a.reply } : {}) }
	fs.writeFileSync(path.join(BENCH, "reference", `${id}.json`), JSON.stringify(out, null, 1))
	const r = await scoreCase(c, { plan, scene, reply: a.reply })
	console.log(`${id}: ${r.pass ? "PASS" : `FAIL [${r.failed.join(",")}]`} score ${r.score}${r.checks.edit?.problems?.length ? ` edit: ${r.checks.edit.problems.join("; ")}` : ""}${Array.isArray(r.checks.relations) ? ` rel: ${r.checks.relations.filter((x) => !x.ok).map((x) => `${x.rel} ${x.detail}`).join("; ")}` : ""}${Array.isArray(r.checks.outcomes) ? ` out: ${r.checks.outcomes.filter((x) => !x.ok).map((x) => `${x.kind} ${x.detail}`).join("; ")}` : ""}${r.checks.overlaps?.count ? ` overlaps ${r.checks.overlaps.list.join("; ")}` : ""}`)
}
