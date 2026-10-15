// Compare pipeline runs (dirs of per-case JSON) by kind of request: pass, det. score, time, cost, ground truth, plan repairs, refine rounds.
//   node ai/bench/tools/compare-pipelines.mjs "base=ai/bench/results/ab3/pipeline-base/app" "new=ai/bench/results/ab3/pipeline-new/app"
//   "new=dirA,dirB" pools several runs under one label (2 runs per arm: ai/research/benchmark.md §13).
//   DETAIL=1 adds one line per case. No model calls. (The repair round's A/B, ai/research/benchmark.md §12; round 2's, §13.)
import fs from "node:fs"
import path from "node:path"
const sets = process.argv.slice(2).map((a) => {
	const [label, dirs] = a.split("=")
	return { label, recs: dirs.split(",").flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))) }
})
const kindOf = (id) => (/^(gt-|photo-|sketch-)/.test(id) ? "picture" : /^d\d/.test(id) ? "edit" : "text")
const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return NaN; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "–")
const cost = (r) => (r.report?.calls ?? []).reduce((s, c) => s + (c.usage?.costInUSD ?? 0), 0)
const stepMs = (r, step) => (r.report?.calls ?? []).filter((c) => c.step === step).reduce((s, c) => s + c.ms, 0) / 1000
const planRepair = (r) => (r.report?.calls ?? []).some((c) => c.step === "plan" && (c.usage?.prompt_tokens ?? 0) > 80000)
for (const kind of ["text", "picture", "edit", "all"]) {
	console.log(`\n## ${kind}`)
	console.log("| set | n | pass | det | p50 s | p90 s | observe p50 | plan p50 | refine p50 (sum) | rounds | plan repaired | $/build | GT size err | GT scale dev | GT hard | errors |")
	console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
	for (const s of sets) {
		const rs = s.recs.filter((r) => kind === "all" || kindOf(r.case) === kind)
		const gts = rs.map((r) => r.gt).filter((g) => g && !g.error)
		const obs = rs.map((r) => stepMs(r, "observe")).filter((x) => x > 0)
		console.log(`| ${s.label} | ${rs.length} | ${f(mean(rs.map((r) => (r.score?.pass ? 1 : 0))))} | ${f(mean(rs.map((r) => r.score?.score)), 3)} | ${f(pct(rs.map((r) => r.totalMs / 1000), 0.5), 1)} | ${f(pct(rs.map((r) => r.totalMs / 1000), 0.9), 1)} | ${f(pct(obs, 0.5), 1)} | ${f(pct(rs.map((r) => stepMs(r, "plan") || stepMs(r, "edit")), 0.5), 1)} | ${f(pct(rs.map((r) => stepMs(r, "refine")), 0.5), 1)} | ${f(mean(rs.map((r) => (r.report?.refine ?? []).length)))} | ${rs.filter(planRepair).length} | ${f(mean(rs.map(cost)), 3)} | ${f(mean(gts.map((g) => g.size?.mean_rel_err)), 3)} | ${f(mean(gts.map((g) => g.hard?.scale_dev)), 3)} | ${f(mean(gts.map((g) => (g.hard ? (g.hard.ok ? 1 : 0) : NaN))))} | ${rs.filter((r) => !r.call?.ok).length} |`)
	}
}
if (process.env.DETAIL) {
	const ids = [...new Set(sets.flatMap((s) => s.recs.map((r) => r.case)))].sort()
	console.log("\n| case | " + sets.map((s) => s.label).join(" | ") + " |")
	for (const id of ids) console.log(`| ${id} | ` + sets.map((s) => { const r = s.recs.find((x) => x.case === id); return r ? `${r.score?.pass ? "PASS" : "fail " + (r.score?.failed ?? []).join(",")} ${Math.round(r.totalMs / 1000)}s r${(r.report?.refine ?? []).length}${planRepair(r) ? " PR" : ""}` : "-" }).join(" | ") + " |")
}
