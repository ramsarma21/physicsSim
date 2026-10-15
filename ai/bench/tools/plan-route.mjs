// The user's failure path at the step level: a change request sent to POST /api/ai/plan WITH the scene on screen (what a client in "new
// scene" mode does), for the pre-round-2 server (base) and the new one. Each answer is applied as the client applies it (a plan as a new
// scene; intent "edit": the patches on its base plan), solved by the frozen client's solver, run, and scored (no refine, no tune).
// (ai/research/benchmark.md §13, table "The user's path")
//   zsh -c 'source ~/.config/truefoundry/env && node ai/bench/tools/plan-route.mjs <tree with ai/> <client dir with web/ai> <out.json> [runs]'
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const [tree, client, outFile, runsArg] = process.argv.slice(2).map((a, i) => (i < 3 ? path.resolve(a) : a))
const PG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const imp = (p) => import(pathToFileURL(p).href)
const { runStep } = await imp(`${tree}/ai/steps.mjs`)
const score = await imp(`${PG}/ai/bench/score.mjs`)
const { solve, planFromScene } = await imp(`${client}/web/ai/solver.js`)
const { applyPatches } = await imp(`${client}/web/ai/orchestrator.js`)
const bench = score.loadBench()
const ids = ["d20-starter-swap-balls", "d21-starter-taller-dominoes", "d22-starter-move-box", "d23-starter-steel-box", "d24-starter-new-scene-wording", "d25-starter-make-it-work-again", "d26-car-add-dominoes", "d27-conveyor-tennis-balls", "d28-conveyor-make-it-work-again", "d29-trampoline-soccer", "d1-rube-more-dominoes", "d2-wrecking-cardboard", "d6-raise-bowling", "d11-remove-superball", "d13-start-over", "d18-bigger-seesaw-ball"]
const jobs = []
for (let k = 0; k < Number(runsArg ?? 2); k++) for (const id of ids) jobs.push({ id, k })
const out = []
let i = 0
await Promise.all(Array.from({ length: 6 }, async () => {
	while (i < jobs.length) {
		const { id, k } = jobs[i++]
		const c = bench.text.find((x) => x.id === id)
		const base = score.baseSceneOf(c)
		const t0 = Date.now()
		try {
			const r = await runStep("plan", { text: c.prompt, scene: base })
			let plan = r.result
			if (r.intent === "edit") plan = applyPatches(planFromScene(base), r.edit.patches ?? [], base).plan
			const sc = solve(plan).scene
			const s = await score.scoreCase(c, { plan, scene: sc, reply: r.edit?.reply ?? null }, {})
			out.push({ id, k, ms: Date.now() - t0, intent: r.intent ?? "(none: a new scene)", pass: s.pass, failed: s.failed, score: s.score, problems: s.checks.edit?.problems?.slice(0, 3) })
		} catch (e) {
			out.push({ id, k, ms: Date.now() - t0, error: `${e.code}: ${String(e.message).slice(0, 160)}` })
		}
		console.log(JSON.stringify(out.at(-1)))
	}
}))
fs.writeFileSync(outFile, JSON.stringify(out, null, 1))
