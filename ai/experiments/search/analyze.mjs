#!/usr/bin/env node
// Offline analysis of a build run (no model calls): every candidate plan of every case re-tuned (the tuners and the engine are deterministic, so
// this rebuilds exactly what the selection saw) and measured by the bench's checks, so selection policies can be compared on the same
// candidates: plan A alone, the selector's pick, the best candidate in hindsight (the ceiling of best-of-N), and "wait at most X s after the
// first plan" deadlines (latency), for both tuners.
//   node ai/experiments/search/analyze.mjs --run r1
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) (opt[argv[i].slice(2)] = argv[i + 1] ?? true), i++
const RUN = String(opt.run ?? "r1")
const RES = path.join(HERE, "results", RUN)
const infra = await import("./lib/infra.mjs")
const { evaluate } = await import("./lib/physics.mjs")
const { shippedTune, stageTune } = await import("./lib/stagetune.mjs")
const { measure, bench } = await import("./lib/metrics.mjs")
const { selectionScore } = await import("./lib/arms.mjs")
const B = bench(path.join(HERE, "bench"))
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"))
const CACHE = path.join(RES, "analysis-candidates.json")
const cache = fs.existsSync(CACHE) ? readJson(CACHE) : {}

const ids = fs.readdirSync(path.join(RES, "plans")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
for (const id of ids) {
	if (cache[id]) continue
	const c = B.cases.get(id)
	const P = readJson(path.join(RES, "plans", `${id}.json`))
	const sel = {}
	for (const arm of ["bon", "bonstage"]) {
		const f = path.join(RES, arm, `${id}.json`)
		if (fs.existsSync(f)) sel[arm] = readJson(f).select ?? []
	}
	const out = {}
	for (const [v, x] of Object.entries(P.variants)) {
		if (!x.ok) {
			out[v] = { ok: false }
			continue
		}
		const ev0 = await evaluate(x.plan)
		const row = { ok: ev0.ok, ms: x.ms, cost: x.usage?.costInUSD ?? null }
		if (ev0.ok) {
			row.raw = await measure(c, x.plan, ev0.scene)
			const a = await shippedTune(x.plan, { from: ev0 })
			row.shipped = await measure(c, a.ev.plan, a.ev.scene)
			row.shippedSel = selectionScore({ ev: a.ev, rate: { score: sel.bon?.find((r) => r.variant === v)?.rate ?? null } })
			const b = await stageTune(x.plan, { from: ev0 })
			row.stage = await measure(c, b.ev.plan, b.ev.scene)
			row.stageSel = selectionScore({ ev: b.ev, rate: { score: sel.bonstage?.find((r) => r.variant === v)?.rate ?? null } })
			for (const k of ["raw", "shipped", "stage"]) delete row[k].sim
		}
		out[v] = row
	}
	cache[id] = out
	fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1))
	infra.log(`${id}: ${Object.entries(out).map(([v, r]) => `${v} raw ${r.raw?.success ? "✓" : "✗"} shipped ${r.shipped?.success ? "✓" : "✗"} stage ${r.stage?.success ? "✓" : "✗"}`).join(" | ")}`)
}
await infra.closeAll()

// ---- policies
const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : null)
const pct = (a, p) => {
	const s = a.filter(Number.isFinite).sort((x, y) => x - y)
	if (!s.length) return null
	const i = (s.length - 1) * p
	return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i))
}
const lines = []
const pol = {}
const add = (name, k, ok, t) => {
	pol[name] ??= { ok: [], t: [] }
	pol[name].ok.push(ok ? 1 : 0)
	pol[name].t.push(t)
}
for (const [id, out] of Object.entries(cache)) {
	const vs = Object.entries(out).filter(([, r]) => r.ok && r.raw)
	if (!vs.length) continue
	for (const mode of ["raw", "shipped", "stage"]) {
		const selKey = mode === "stage" ? "stageSel" : "shippedSel"
		const A = out.A
		if (A?.ok && A.raw) add(`${mode} · plan A only`, mode, A[mode].success, A.ms / 1000)
		if (mode === "raw") continue
		const all = vs.map(([v, r]) => ({ v, r, ms: r.ms, sel: r[selKey] }))
		const tAll = Math.max(...all.map((x) => x.ms)) / 1000
		const pick = all.reduce((m, x) => (x.sel > m.sel ? x : m), all[0])
		add(`${mode} · best of ${all.length} (selector)`, mode, pick.r[mode].success, tAll)
		add(`${mode} · best of ${all.length} (hindsight: any succeeds)`, mode, all.some((x) => x.r[mode].success), tAll)
		for (const extra of [0, 15, 30, 60]) {
			const first = Math.min(...all.map((x) => x.ms))
			const done = all.filter((x) => x.ms <= first + extra * 1000)
			const p = done.reduce((m, x) => (x.sel > m.sel ? x : m), done[0])
			add(`${mode} · first plan + ${extra} s, then the selector`, mode, p.r[mode].success, Math.max(...done.map((x) => x.ms)) / 1000)
		}
		for (const set of [["A", "B"], ["A", "C"], ["A", "D"], ["A", "B", "D"]]) {
			const sub = all.filter((x) => set.includes(x.v))
			if (!sub.length) continue
			const p = sub.reduce((m, x) => (x.sel > m.sel ? x : m), sub[0])
			add(`${mode} · ${set.join("")} (selector)`, mode, p.r[mode].success, Math.max(...sub.map((x) => x.ms)) / 1000)
		}
		for (const v of ["B", "C", "D"]) if (out[v]?.ok && out[v][mode]) add(`${mode} · plan ${v} only`, mode, out[v][mode].success, out[v].ms / 1000)
	}
}
lines.push("| policy (success = the request's key outcome in the run, BEFORE the refine loop) | n | success | plan wait p50 / p90 s |", "|---|---|---|---|")
for (const [k, v] of Object.entries(pol)) lines.push(`| ${k} | ${v.ok.length} | ${mean(v.ok).toFixed(2)} | ${pct(v.t, 0.5).toFixed(0)} / ${pct(v.t, 0.9).toFixed(0)} |`)
const text = lines.join("\n")
console.log(text)
fs.writeFileSync(path.join(RES, "analysis.md"), text)
process.exit(0)
