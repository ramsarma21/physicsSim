// Smoke test of the integration reference: the patched orchestrator (orchestrator-imagine.diff applied to the experiment's frozen client)
// with the reference imagine step (imagine-step.mjs) behind /api/ai/imagine. At most 4 model calls in flight (lib/sem.mjs).
//   D=<scratch dir>; mkdir -p $D/web/ai && cp ai/experiments/imagine/client/web/ai/*.js $D/web/ai/ && ln -s "$PWD/web/sim" $D/web/sim \
//     && patch $D/web/ai/orchestrator.js < ai/experiments/imagine/integration/orchestrator-imagine.diff
//   zsh -c 'source ~/.config/truefoundry/env && PATCHED_ORCHESTRATOR=$D/web/ai/orchestrator.js IMAGINE_MODE=always node ai/experiments/imagine/integration/smoke.mjs "request 1" "request 2"'
// Prints, per request: the goals, the concept's cast, and every step call with whether it carried a picture, an observation, the concept note.
// (Run 2026-10-15: "a superball bouncing down a flight of stairs" -> direct (imagine, plan with the picture, refine without it), goals 2/2;
//  "A pendulum knocks over a line of dominoes, and the last domino bumps a toy car ..." -> observe, plan, refine; goals 4/4.)
process.env.AI_PROMPTS_DIR = "/Users/ramsarma/Downloads/science-map-share/blender-playground/ai/experiments/imagine/prompts-frozen"
const ROOT = "/Users/ramsarma/Downloads/science-map-share/blender-playground"
const E = ROOT + "/ai/experiments/imagine"
const fs = await import("node:fs")
const gw = await import(ROOT + "/ai/bench/lib/gateway.mjs")
gw.setConcurrency(4)
const { gated } = await import(E + "/lib/sem.mjs")
const { imagine } = await import(E + "/integration/imagine-step.mjs")
const { createSimPool } = await import(ROOT + "/ai/bench/lib/sim-pool.mjs")
const ORCH = await import(process.env.PATCHED_ORCHESTRATOR ?? "./web/ai/orchestrator.js")
const routing = JSON.parse(fs.readFileSync(ROOT + "/ai/models.json", "utf8"))
const pool = createSimPool({ size: 4 })
const seen = []
const api = async (p, body, signal) => {
  const step = p.replace("/api/ai/", "")
  seen.push({ step, images: (body.payload.images ?? []).length, observation: !!body.payload.observation, note: /concept image/.test(body.payload.text ?? "") })
  if (step === "imagine") {
    try { return { ok: true, result: await imagine(body.payload, { signal }), ms: 0 } } catch (e) { return { ok: false, error: e.message, code: e.code ?? "gateway" } }
  }
  const r = await gated(() => gw.runConfigWithRouting(step, body.payload, routing, { signal }))
  return r.ok ? { ok: true, result: r.result, model: r.model, ms: r.ms, usage: r.usage } : { ok: false, error: r.error?.message, code: r.error?.code }
}
const orch = ORCH.createOrchestrator({ api, simulate: (scene, signal) => pool.simulate(scene, signal), progress: false })
for (const text of process.argv.slice(2)) {
  seen.length = 0
  const events = []
  const t0 = Date.now()
  const rep = await orch.build({ text }, { onEvent: (e) => { if (e.type === "concept" || (e.type === "step" && e.step === "imagine")) events.push(e.type === "concept" ? { type: "concept", cast: e.cast?.length, image: e.image?.slice(0, 30) } : { step: e.step, state: e.state }) }, imagine: process.env.IMAGINE_MODE || "always" }).result
  console.log(JSON.stringify({ text, s: Math.round((Date.now() - t0) / 1000), title: rep.title, goals: rep.goals, concept: rep.concept ? { cast: rep.concept.cast.map((c) => c.type), hasImage: rep.concept.image.startsWith("data:image/jpeg") } : null, issues: rep.issues, calls: seen, events }, null, 0))
}
pool.close()
process.exit(0)
