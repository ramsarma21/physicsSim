#!/usr/bin/env node
// Paired A/B tables from stored results (no model calls): per arm the pass rates and checks, per category, and for each pair of arms the
// cases one passes and the other fails (the paired difference: the honest way to read small n).
//   node ai/experiments/edit/compare.mjs --run r1 --arms base,a1,a1d,n1,n2 [--pairs base:n2,a1:a1d,a1d:n1,n1:n2] [--runs r1,r2 (pooled)]
import fs from "node:fs"
import path from "node:path"
import { CASES } from "./cases.mjs"
import { OUT, SUMMARY } from "./lib/env.mjs"

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) (argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? (opt[argv[i].slice(2)] = true) : ((opt[argv[i].slice(2)] = argv[i + 1]), i++))
const list = (v) => (v === undefined || v === true ? null : String(v).split(",").filter(Boolean))
const runs = list(opt.runs) ?? [String(opt.run ?? "r1")]
const arms = list(opt.arms) ?? ["base", "a1", "a1d", "n1", "n2"]
const load = (run, arm, id) => {
	const f = path.join(OUT, run, arm, `${id}.json`)
	return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null
}
const pct = (a, p) => {
	const s = a.filter(Number.isFinite).sort((x, y) => x - y)
	if (!s.length) return NaN
	const i = (s.length - 1) * p
	return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i))
}
const recs = {}
for (const a of arms) recs[a] = runs.flatMap((r) => CASES.map((c) => load(r, a, c.id)).filter(Boolean))
const fmt = (v, d = 3) => (typeof v === "number" ? (Number.isNaN(v) ? "-" : v.toFixed(d)) : v)
const k = (rs, name) => {
	const xs = rs.filter((r) => r.eval?.checks?.[name] !== undefined)
	return xs.length ? `${xs.filter((r) => r.eval.checks[name] !== false).length}/${xs.length}` : "-"
}
console.log(`runs: ${runs.join(", ")}\n`)
console.log("| arm | n | pass | pass (byte-identical) | exact | untouched | untouched byte | no extra items | no new overlap | works or says why | question/ambiguous: no change | asks when ambiguous | answer right | p50 s | p90 s | model calls/edit | $/edit |")
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
const SAVE = { runs, arms, rows: [], categories: [], pairs: [] }
for (const a of arms) {
	const rs = recs[a]
	SAVE.rows.push({ arm: a, n: rs.length, pass: rs.filter((r) => r.eval?.pass).length / rs.length, pass_byte: rs.filter((r) => r.eval?.pass_byte).length / rs.length, exact: k(rs, "exact"), untouched: k(rs, "untouched"), untouched_byte: k(rs, "untouched_byte"), works_or_said: k(rs, "works_or_said"), noChange: k(rs, "noChange"), ask: k(rs, "ask"), p50_s: pct(rs.map((r) => r.ms), 0.5) / 1000, p90_s: pct(rs.map((r) => r.ms), 0.9) / 1000, usd: rs.reduce((q, r) => q + (r.cost ?? 0), 0) / Math.max(1, rs.length), failures: rs.filter((r) => !r.eval?.pass).map((r) => `${r.case}: ${(r.eval?.fail ?? []).join(" | ").slice(0, 200)}`) })
	const calls = rs.map((r) => (r.calls ?? []).filter((c) => !["tune"].includes(c.step)).length)
	console.log(`| ${a} | ${rs.length} | ${fmt(rs.filter((r) => r.eval?.pass).length / rs.length)} | ${fmt(rs.filter((r) => r.eval?.pass_byte).length / rs.length)} | ${k(rs, "exact")} | ${k(rs, "untouched")} | ${k(rs, "untouched_byte")} | ${k(rs, "extra")} | ${k(rs, "overlap")} | ${k(rs, "works_or_said")} | ${k(rs, "noChange")} | ${k(rs, "ask")} | ${k(rs, "answer")} | ${fmt(pct(rs.map((r) => r.ms), 0.5) / 1000, 1)} | ${fmt(pct(rs.map((r) => r.ms), 0.9) / 1000, 1)} | ${fmt(calls.reduce((p, q) => p + q, 0) / Math.max(1, calls.length), 2)} | ${fmt(rs.reduce((s, r) => s + (r.cost ?? 0), 0) / Math.max(1, rs.length), 3)} |`)
}
const cats = [...new Set(CASES.map((c) => c.cat))]
console.log(`\n| category | n | ${arms.join(" | ")} |\n|---|---|${arms.map(() => "---").join("|")}|`)
for (const cat of cats) {
	const ids = new Set(CASES.filter((c) => c.cat === cat).map((c) => c.id))
	console.log(`| ${cat} | ${ids.size * runs.length} | ${arms.map((a) => { const rs = recs[a].filter((r) => ids.has(r.case)); return `${rs.filter((r) => r.eval?.pass).length}/${rs.length}` }).join(" | ")} |`)
}
const bases = [...new Set(CASES.map((c) => (typeof c.base === "string" ? c.base : c.base.from)))]
console.log(`\n| base scene | n | ${arms.join(" | ")} |\n|---|---|${arms.map(() => "---").join("|")}|`)
for (const b of bases) {
	const ids = new Set(CASES.filter((c) => (typeof c.base === "string" ? c.base : c.base.from) === b).map((c) => c.id))
	console.log(`| ${b} | ${ids.size * runs.length} | ${arms.map((a) => { const rs = recs[a].filter((r) => ids.has(r.case)); return `${rs.filter((r) => r.eval?.pass).length}/${rs.length}` }).join(" | ")} |`)
}
const pairs = (list(opt.pairs) ?? []).map((p) => p.split(":"))
if (pairs.length) {
	console.log("\n| A → B | both pass | only A passes | only B passes | both fail | B's wins |\n|---|---|---|---|---|---|")
	for (const [A, Bn] of pairs) {
		let both = 0, onlyA = 0, onlyB = 0, none = 0
		const wins = []
		const losses = []
		for (const r of runs) for (const c of CASES) {
			const x = load(r, A, c.id)
			const y = load(r, Bn, c.id)
			if (!x || !y) continue
			if (x.eval?.pass && y.eval?.pass) both++
			else if (x.eval?.pass) (onlyA++, losses.push(c.id))
			else if (y.eval?.pass) (onlyB++, wins.push(c.id))
			else none++
		}
		console.log(`| ${A} → ${Bn} | ${both} | ${onlyA} | ${onlyB} | ${none} | ${onlyB - onlyA >= 0 ? "+" : ""}${onlyB - onlyA} |`)
		SAVE.pairs.push({ A, B: Bn, both, onlyA, onlyB, none, wins: wins.slice(), losses: losses.slice() })
		if (opt.detail) console.log(`  ${Bn} wins: ${wins.join(", ")}\n  ${Bn} losses: ${losses.join(", ")}`)
	}
}

if (opt.save) {
	fs.mkdirSync(SUMMARY, { recursive: true })
	fs.writeFileSync(path.join(SUMMARY, `compare-${runs.join("+")}.json`), JSON.stringify(SAVE, null, 1))
}
