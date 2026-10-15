// Where the edit experiment reads the pipeline from, and writes its results.
// The pipeline under test is a FROZEN copy of ai/*.mjs, ai/prompts, ai/models.json, web/ai/*.js and web/sim taken at the start of the
// experiment (other agents edit the live files while it runs; both arms of every A/B import the same frozen copy, so a live edit
// cannot leak into one arm only). Make one with:  node ai/experiments/edit/snapshot.mjs <dir>   (default: $EDIT_FROZEN)
//   EDIT_FROZEN  the frozen copy (default: the session scratchpad's frozen/)
//   EDIT_OUT     full per-case results (scenes, runs, model answers; large) — default: the scratchpad's edit-results/
// Compact summaries go to ai/experiments/edit/results/.
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const HERE = dirname(dirname(fileURLToPath(import.meta.url))) // ai/experiments/edit
export const ROOT = join(HERE, "..", "..", "..") // blender-playground
const SCRATCH = "/private/tmp/claude-501/-Users-ramsarma-Downloads-science-map-share/cb014d17-1cd6-4220-a508-cf6ce5539a35/scratchpad"
export const FROZEN = process.env.EDIT_FROZEN || join(SCRATCH, "frozen")
export const OUT = process.env.EDIT_OUT || join(SCRATCH, "edit-results")
export const SUMMARY = join(HERE, "results")
// the catalog digest cache of the frozen copy (catalog-digest.mjs reads AI_CACHE_DIR when it is first imported)
process.env.AI_CACHE_DIR ??= join(FROZEN, ".cache")

const imp = (rel) => import(pathToFileURL(join(FROZEN, rel)).href)
let P = null
/** The frozen pipeline's modules. */
export function frozen() {
	return (P ??= (async () => {
		const [steps, core, schemas, catalog, sceneDigest, goals, orch, solver, goalsJs, fetchH1, sim] = await Promise.all([
			imp("ai/steps.mjs"),
			imp("ai/core.mjs"),
			imp("ai/schemas.mjs"),
			imp("ai/catalog-digest.mjs"),
			imp("ai/scene-digest.mjs"),
			imp("ai/goals.mjs"),
			imp("web/ai/orchestrator.js"),
			imp("web/ai/solver.js"),
			imp("web/ai/goals.js"),
			imp("ai/fetch-h1.mjs"),
			imp("web/sim/index.js")
		])
		return { steps, core, schemas, catalog, sceneDigest, goals, orch, solver, goalsJs, fetchH1: fetchH1.fetchH1, sim }
	})())
}
