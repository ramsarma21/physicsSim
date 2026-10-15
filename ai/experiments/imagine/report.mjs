// Tables for the imagine-first experiment (no model calls): node ai/experiments/imagine/run.mjs report --run <name> [--detail]
//   concepts by image model × prompt template: image latency, tokens, estimated $, the vision check, the observation's cast match
//   plan step alone by arm (text vs concept variants), on the cases that have both
//   the whole pipeline by arm, overall and by set (text25 / new15) and by number of stages, with both judges; per-case lines (--detail)
import fs from "node:fs"
import path from "node:path"

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"))
const mean = (a) => {
	const s = a.filter((x) => Number.isFinite(x))
	return s.length ? s.reduce((p, q) => p + q, 0) / s.length : null
}
const pct = (a, p) => {
	const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
	if (!s.length) return null
	const i = (s.length - 1) * p
	const lo = Math.floor(i)
	const hi = Math.ceil(i)
	return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const f = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : Number(v).toFixed(d))
const jsonIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith(".json")).map((x) => readJson(path.join(dir, x))) : [])
const dirsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => fs.statSync(path.join(dir, x)).isDirectory()) : [])

export async function cmdReport({ RES, opt, CASES, PHASE1 = [], selectCases }) {
	const md = []
	const out = {}
	const ids = new Set(selectCases().map((c) => c.id))

	// ---- concepts
	const concepts = jsonIn(path.join(RES, "concepts")).filter((r) => ids.has(r.case))
	if (concepts.length) {
		const checker = String(opt["check-model"] ?? "opus-low")
		const checks = new Map(jsonIn(path.join(RES, "check", checker)).map((r) => [r.id, r]))
		const obs = new Map(jsonIn(path.join(RES, "observe")).map((r) => [r.id, r]))
		const groups = new Map()
		for (const r of concepts) {
			const k = `${r.model} · ${r.template}`
			;(groups.get(k) ?? groups.set(k, []).get(k)).push(r)
		}
		md.push(`\n### Concepts by image model × prompt (run ${path.basename(RES)}; check: ${checker})\n`)
		md.push("| model · template | ok/n | image s p50 / p90 | out tok | est $ | check score | side 0-2 | supports 0-2 | works 0-2 | counts exact | extras | obs: cast recall | obs: counts exact | obs: extras | obs: side view | observe s p50 |")
		md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
		out.concepts = {}
		for (const [k, rs] of [...groups].sort()) {
			const ok = rs.filter((r) => r.ok)
			const ch = ok.map((r) => checks.get(r.id)).filter((x) => x?.ok)
			const ob = ok.map((r) => obs.get(r.id)).filter((x) => x?.ok)
			const row = {
				n: rs.length,
				ok: ok.length,
				p50: pct(ok.map((r) => r.ms), 0.5) / 1000,
				p90: pct(ok.map((r) => r.ms), 0.9) / 1000,
				outTok: mean(ok.map((r) => r.usage?.output_tokens)),
				cost: mean(ok.map((r) => r.cost_est)),
				check: mean(ch.map((x) => x.result.score_0_10)),
				side: mean(ch.map((x) => x.result.side_view)),
				supports: mean(ch.map((x) => x.result.supports)),
				works: mean(ch.map((x) => x.result.works)),
				exact: mean(ch.map((x) => x.summary?.exact)),
				extras: mean(ch.map((x) => x.summary?.extras)),
				obsRecall: mean(ob.map((x) => x.metrics?.recall)),
				obsExact: mean(ob.map((x) => x.metrics?.exact)),
				obsExtras: mean(ob.map((x) => x.metrics?.extras)),
				obsSide: mean(ob.map((x) => (x.metrics?.side ? 1 : 0))),
				obsMs: pct(ob.map((x) => x.ms), 0.5) / 1000,
				nObs: ob.length,
				nCheck: ch.length
			}
			out.concepts[k] = row
			md.push(`| ${k} | ${row.ok}/${row.n} | ${f(row.p50, 1)} / ${f(row.p90, 1)} | ${f(row.outTok, 0)} | ${f(row.cost, 3)} | ${f(row.check, 1)} | ${f(row.side)} | ${f(row.supports)} | ${f(row.works)} | ${f(row.exact)} | ${f(row.extras, 1)} | ${f(row.obsRecall)} | ${f(row.obsExact)} | ${f(row.obsExtras, 1)} | ${f(row.obsSide)} | ${f(row.obsMs, 1)} |`)
		}
	}

	// ---- plan alone
	const planDir = path.join(RES, "plan")
	const planArms = dirsIn(planDir)
	if (planArms.length) {
		const recs = new Map(planArms.map((a) => [a, jsonIn(path.join(planDir, a)).filter((r) => ids.has(r.case))]))
		// cases every arm has (a fair comparison)
		const common = [...ids].filter((id) => planArms.every((a) => recs.get(a).some((r) => r.case === id)))
		md.push(`\n### Plan step alone (solved, run, scored; no refine, no tune) on the ${common.length} cases every arm has\n`)
		md.push("| arm | n | det. | pass | plan s p50 / p90 | + observe s p50 | + image s p50 | $ plan |")
		md.push("|---|---|---|---|---|---|---|---|")
		out.plan = {}
		for (const a of planArms) {
			const rs = recs.get(a).filter((r) => common.includes(r.case))
			const row = { n: rs.length, det: mean(rs.map((r) => r.score?.score ?? 0)), pass: mean(rs.map((r) => (r.score?.pass ? 1 : 0))), p50: pct(rs.filter((r) => r.ok).map((r) => r.ms), 0.5) / 1000, p90: pct(rs.filter((r) => r.ok).map((r) => r.ms), 0.9) / 1000, obs: pct(rs.map((r) => r.obsMs).filter(Boolean), 0.5) / 1000, img: pct(rs.map((r) => r.conceptMs).filter(Boolean), 0.5) / 1000, cost: mean(rs.map((r) => r.usage?.costInUSD)) }
			out.plan[a] = row
			md.push(`| ${a} | ${row.n} | ${f(row.det, 3)} | ${f(row.pass)} | ${f(row.p50, 1)} / ${f(row.p90, 1)} | ${f(row.obs, 1)} | ${f(row.img, 1)} | ${f(row.cost, 3)} |`)
		}
		if (opt.detail) {
			md.push("\nper case (det / pass, averaged over samples):")
			for (const id of common) md.push(`- ${id}: ${planArms.map((a) => { const rs = recs.get(a).filter((r) => r.case === id); return `${a} ${f(mean(rs.map((r) => r.score?.score ?? 0)), 3)}/${f(mean(rs.map((r) => (r.score?.pass ? 1 : 0))), 1)}` }).join(" · ")}`)
		}
	}

	// ---- pipeline
	const pipeDir = path.join(RES, "pipeline")
	const arms = dirsIn(pipeDir)
	if (arms.length) {
		const recs = new Map(arms.map((a) => [a, jsonIn(path.join(pipeDir, a)).filter((r) => ids.has(r.case))]))
		const key = (r) => `${r.case}#${r.sample}`
		const common = new Set([...recs.get(arms[0])].map(key).filter((k) => arms.every((a) => recs.get(a).some((r) => key(r) === k))))
		const judgeIds = [...new Set(arms.flatMap((a) => recs.get(a).flatMap((r) => Object.keys(r.judge ?? {}))))].sort()
		const summarize = (rs) => {
			const js = Object.fromEntries(judgeIds.map((j) => [j, rs.map((r) => r.judge?.[j]).filter((v) => Number.isFinite(v?.score_0_10))]))
			return {
				n: rs.length,
				ok: rs.filter((r) => r.call?.ok).length,
				det: mean(rs.map((r) => r.score?.score ?? 0)),
				pass: mean(rs.map((r) => (r.score?.pass ? 1 : 0))),
				goals: mean(rs.map((r) => r.goalsMet)),
				outcomes: mean(rs.map((r) => r.score?.parts?.outcomes)),
				judge: Object.fromEntries(judgeIds.map((j) => [j, { mean: mean(js[j].map((v) => v.score_0_10)), rubric: mean(js[j].map((v) => (v.rubric_met ? 1 : 0))), n: js[j].length }])),
				p50: pct(rs.map((r) => r.totalMs), 0.5) / 1000,
				p90: pct(rs.map((r) => r.totalMs), 0.9) / 1000,
				img: pct(rs.map((r) => r.imagineMs).filter((x) => x > 0), 0.5) / 1000,
				cost: mean(rs.map((r) => r.cost)),
				refine: mean(rs.map((r) => r.report?.refine?.length ?? 0))
			}
		}
		const head = `| arm | n | ok | det. | hard pass | goals met | outcomes part | ${judgeIds.map((j) => `judge ${j} (rubric)`).join(" | ")} | time p50 / p90 s | imagine p50 s | refine rounds | $ / build |`
		const sep = `|${"---|".repeat(11 + judgeIds.length)}`
		const line = (label, s) => `| ${label} | ${s.n} | ${s.ok} | ${f(s.det, 3)} | ${f(s.pass)} | ${f(s.goals)} | ${f(s.outcomes)} | ${judgeIds.map((j) => `${f(s.judge[j].mean)} (${f(s.judge[j].rubric)})`).join(" | ")} | ${f(s.p50, 1)} / ${f(s.p90, 1)} | ${f(s.img, 1)} | ${f(s.refine, 2)} | ${f(s.cost, 3)} |`
		out.pipeline = {}
		const subsets = [
			["all", () => true],
			["text25", (r) => r.set === "text25"],
			["new15", (r) => r.set === "new15"],
			["1 stage", (r) => (r.stages ?? 1) <= 1],
			["2-3 stages", (r) => r.stages >= 2 && r.stages <= 3],
			["4-6 stages", (r) => r.stages >= 4],
			["not in phase 1", (r) => !PHASE1.includes(r.case)]
		]
		for (const [name, pred] of subsets) {
			md.push(`\n### Pipeline, ${name} (paired: case × sample every arm has: ${[...common].filter((k) => pred(recs.get(arms[0]).find((r) => key(r) === k) ?? {})).length})\n`)
			md.push(head, sep)
			out.pipeline[name] = {}
			for (const a of arms) {
				const rs = recs.get(a).filter((r) => common.has(key(r)) && pred(r))
				if (!rs.length) continue
				const s = summarize(rs)
				out.pipeline[name][a] = s
				md.push(line(a, s))
			}
		}
		if (opt.detail) {
			md.push("\nper case (det / PASS|fail / judges):")
			for (const k of [...common].sort()) {
				md.push(`- ${k}: ${arms.map((a) => { const r = recs.get(a).find((x) => key(x) === k); return `${a} ${f(r.score?.score, 3)} ${r.score?.pass ? "PASS" : `fail[${(r.score?.failed ?? []).join(",")}]`} ${judgeIds.map((j) => r.judge?.[j]?.score_0_10 ?? "?").join("/")} ${Math.round((r.totalMs ?? 0) / 1000)}s` }).join(" · ")}`)
			}
		}
	}
	fs.writeFileSync(path.join(RES, "report.json"), JSON.stringify(out, null, 1))
	console.log(md.join("\n"))
}
