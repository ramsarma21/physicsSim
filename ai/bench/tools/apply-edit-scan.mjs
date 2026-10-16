// The browser contract's applyEdit on every item of every test scene (the AI-built ones of ai/bench/results/ab4 with their plans, and the
// built-in web/scenarios): a no-op touch (set_item with its own name) or a 2 cm move. Does anything other than the asked change move more
// than 1 mm (or the moved thing land elsewhere)? The measured v3 (ai/experiments/edit/integrate) against v4 (ai/browser). No model calls.
//   node ai/bench/tools/apply-edit-scan.mjs noop|move
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..")
const imp = (r) => import(pathToFileURL(join(ROOT, r)).href)
const solver = await imp("web/ai/solver.js"), orch = await imp("web/ai/orchestrator.js"), sim = await imp("web/sim/index.js")
const A = (await imp("ai/experiments/edit/integrate/apply-edit.js")).applyEdit
const B = (await imp("ai/browser/apply-edit.js")).applyEdit
const deps = { solve: solver.solve, planFromScene: solver.planFromScene, isStaticItem: solver.isStaticItem, applyPatches: orch.applyPatches, digestScene: orch.digestScene, layout: (s) => sim.layout(s) }
const dir = join(ROOT, "ai/bench/results/ab4/pipeline-new/app")
const bases = []
for (const f of readdirSync(dir)) { const r0 = JSON.parse(readFileSync(join(dir, f), "utf8")); if (r0.plan && r0.scene) bases.push([f.replace(/\.json$/, ""), { scene: r0.scene, plan: r0.plan }]) }
for (const f of readdirSync(join(ROOT, "web/scenarios"))) if (f.endsWith(".json")) { try { const s = JSON.parse(readFileSync(join(ROOT, "web/scenarios", f), "utf8")); if (Array.isArray(s.items)) bases.push([f, { scene: s, plan: null }]) } catch {} }
const mode = process.argv[2] ?? "noop"
const moved = (s0, s1, except) => s1.items.filter((x) => { if (except.has(x.id)) return false; const o = s0.items.find((y) => y.id === x.id); return o && (Math.abs((x.x ?? 0) - (o.x ?? 0)) > 0.001 || Math.abs((x.y ?? 0) - (o.y ?? 0)) > 0.001 || Math.abs((x.angle ?? 0) - (o.angle ?? 0)) > 0.1) })
const stat = { A: { bad: 0, sc: new Set(), err: 0 }, B: { bad: 0, sc: new Set(), err: 0, short: 0, over: 0 } }
let tot = 0; const ex = []
for (const [name, base] of bases) {
  for (const it of base.scene.items) {
    if (it.type === "table" || (it.type === "wall" && it.props?.invisible_in_3d)) continue
    tot++
    const patches = mode === "noop" ? [{ op: "set_item", id: it.id, name: it.name ?? it.id }] : [{ op: "move", id: it.id, dx: 0.02 }]
    for (const [tag, fn] of [["A", A], ["B", B]]) {
      let r
      try { r = fn(base, patches, deps) } catch (e) { r = { error: e.stack } }
      if (r.error) { stat[tag].err++; if (tag === "B") ex.push(`${name} ${it.id} ERROR ${String(r.error).slice(0, 300)}`); continue }
      // what may move: (noop) nothing; (move) the item, what rides on it, what refers to it
      const may = new Set(mode === "noop" ? [] : [it.id, ...(r.followers ?? []), ...(r.dependents ?? [])])
      const m = moved(base.scene, r.scene, may)
      let off = false
      if (mode !== "noop") { const o = base.scene.items.find((y) => y.id === it.id), n = r.scene.items.find((y) => y.id === it.id); off = !n || Math.abs(n.x - o.x - 0.02) > 0.001 }
      if (m.length || off) { stat[tag].bad++; stat[tag].sc.add(name); if (tag === "B") ex.push(`${name} ${JSON.stringify(patches)}: ${off ? "TARGET OFF " : ""}${m.map((q) => { const o = base.scene.items.find((y) => y.id === q.id); return `${q.id} Δx ${((q.x - o.x) * 100).toFixed(1)} Δy ${((q.y - o.y) * 100).toFixed(1)} Δa ${((q.angle ?? 0) - (o.angle ?? 0)).toFixed(1)}` }).join(", ")} | short ${JSON.stringify(r.shortfalls?.map((s) => s.id + ":" + s.why))} over ${JSON.stringify(r.overlaps?.map((w) => w.text))}`) }
      if (tag === "B") { if (r.shortfalls?.length) stat.B.short++; if (r.overlaps?.length) stat.B.over++; if (r.errors?.length) stat.B.errs = (stat.B.errs ?? 0) + 1 }
    }
  }
}
console.log(`${mode}: ${tot} touches on ${bases.length} scenes; something else moved > 1 mm${mode === "noop" ? "" : " (or the target off)"}: old ${stat.A.bad} (${stat.A.sc.size} scenes, ${stat.A.err} errors), new ${stat.B.bad} (${stat.B.sc.size} scenes, ${stat.B.err} errors); new with shortfalls ${stat.B.short}, with overlaps ${stat.B.over}, with errors ${stat.B.errs}`)
console.log(ex.slice(0, 60).join("\n"))
