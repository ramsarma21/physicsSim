// The scenes the edit cases start from: the starter Rube Goldberg machine, 5 built-in scenarios (hand-made: no plan) and 5 AI-built
// scenes (shipped pipeline builds from ai/bench/results/ab4: each with the plan that made it, as the app keeps it after an AI build).
//   const B = await loadBases()   // {id: {id, kind: "starter"|"builtin"|"ai", scene, plan|null, checks: [goal]}}
// `checks` are what "the machine still works" means for each scene: the scene's own goals plus a few story checks in ai/goals.mjs kinds
// (falls / hits / moves / in), each verified to pass on the base scene's own run (lib/run-checks.mjs).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ROOT, frozen } from "./lib/env.mjs"

const scenario = (id) => JSON.parse(readFileSync(join(ROOT, "web", "scenarios", `${id}.json`), "utf8"))
const aiBuilt = (id) => {
	const r = JSON.parse(readFileSync(join(ROOT, "ai", "bench", "results", "ab4", "pipeline-new", "app", `${id}.json`), "utf8"))
	return { scene: r.scene, plan: r.plan, request: r.report?.title ?? id }
}

export const BASE_IDS = {
	starter: ["rube-goldberg"],
	builtin: ["car-ramp-dominoes", "trampoline", "wrecking-ball", "plinko", "spring-launch"],
	ai: ["c1-rube-cup", "m2-seesaw-catapult", "m4-conveyor-oranges", "z2-materials-ice-ramp", "k2-tower-wrecking"]
}

/** Story checks per base (besides the scene's own goals): what happens in its run that an edit should keep. */
const STORY = {
	"rube-goldberg": [
		{ kind: "hits", label: "Ball 1 reaches the dominoes", item: "ball1", target: "dominoes" },
		{ kind: "falls", label: "The dominoes fall", item: "dominoes" },
		{ kind: "moves", label: "Ball 2 is launched", item: "ball2", min_m: 0.2 }
	],
	"car-ramp-dominoes": [
		{ kind: "hits", label: "The car hits the dominoes", item: "car", target: "dominoes" },
		{ kind: "falls", label: "The dominoes fall", item: "dominoes" }
	],
	trampoline: [
		{ kind: "hits", label: "The basketball lands on the trampoline", item: "basketball", target: "trampoline" },
		{ kind: "hits", label: "The tennis ball lands on the trampoline", item: "tennis", target: "trampoline" }
	],
	"wrecking-ball": [
		{ kind: "hits", label: "The wrecking ball hits the bricks", item: "crane", target: "brick3" },
		{ kind: "falls", label: "The upper bricks fall", items: ["brick2", "brick3", "brick4", "brick5"] }
	],
	plinko: [{ kind: "hits", label: "The golf ball hits the peg board", item: "ball", target: "board" }],
	"spring-launch": [{ kind: "moves", label: "The golf ball is launched", item: "ball", min_m: 0.3 }]
}

let BASES = null
export function loadBases() {
	return (BASES ??= (async () => {
		const F = await frozen()
		const out = {}
		for (const id of [...BASE_IDS.starter, ...BASE_IDS.builtin]) {
			const scene = scenario(id)
			out[id] = { id, kind: id === "rube-goldberg" ? "starter" : "builtin", scene, plan: null, story: STORY[id] ?? [] }
		}
		for (const id of BASE_IDS.ai) {
			const { scene, plan } = aiBuilt(id)
			// the scene the app shows after an AI build is its plan solved (the bench stored that very scene; checked equal below)
			const solved = F.solver.solve(plan).scene
			const same = JSON.stringify(stripNames(solved)) === JSON.stringify(stripNames(scene))
			out[id] = { id: `ai-${id}`, kind: "ai", scene: same ? scene : solved, plan, story: [], roundTrip: same }
		}
		const keyed = {}
		for (const v of Object.values(out)) keyed[v.id] = v
		return keyed
	})())
}
const stripNames = (s) => ({ ...s, name: undefined, id: undefined })
