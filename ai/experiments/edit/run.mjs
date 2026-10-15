#!/usr/bin/env node
// The edit experiment's runner: each arm on each case, the result checked (lib/check.mjs), one JSON per (run, arm, case) under $EDIT_OUT,
// resumable (finished files are skipped unless --force).
//   zsh -c 'source ~/.config/truefoundry/env && node ai/experiments/edit/run.mjs --run r1 --arms base,v1 [--cases id,id] [--cat swap] [--jobs 6]'
//   node ai/experiments/edit/run.mjs --report --run r1 [--arms base,v1]          (tables only; no model calls)
// Arms: see ARMS below ("base" = the frozen app pipeline exactly as the AI panel runs an edit: edit step -> applyPatches -> solve -> run ->
// quick path | tuner | refine ≤ 2 (renders in a headless Chromium) -> the scene put on the table).
// At most 4 model calls are in flight (lib/pool.mjs withSlot); the gateway's 429s are retried by core.mjs with Retry-After.
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { CASES } from "./cases.mjs"
import { OUT, SUMMARY, frozen } from "./lib/env.mjs"
import { prepareCase, evaluate } from "./lib/check.mjs"

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]
	if (!a.startsWith("--")) continue
	const v = argv[i + 1]
	if (v === undefined || v.startsWith("--")) opt[a.slice(2)] = true
	else (opt[a.slice(2)] = v), i++
}
const list = (v) => (v === undefined || v === true ? null : String(v).split(",").map((s) => s.trim()).filter(Boolean))
const RUN = String(opt.run ?? "r1")
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const writeJson = (f, v) => {
	fs.mkdirSync(path.dirname(f), { recursive: true })
	fs.writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 1))
	fs.renameSync(`${f}.tmp`, f)
}

import { ARMS, closeRenderer } from "./arms.mjs"

// ---------------------------------------------------------------- running
async function runOne(arm, c) {
	const file = path.join(OUT, RUN, arm, `${c.id}.json`)
	if (!opt.force && fs.existsSync(file)) {
		const rec = JSON.parse(fs.readFileSync(file, "utf8"))
		if (!opt.rescore || rec.error) return rec
		// re-check the stored result with the current checks (no model calls but the grader's, cached)
		rec.eval = await evaluate(c, await prepareCase(c), { scene: rec.scene, reply: rec.reply, notes: rec.notes })
		writeJson(file, rec)
		return rec
	}
	const B = await prepareCase(c)
	const rec = { case: c.id, cat: c.cat, arm, run: RUN, text: c.text, at: new Date().toISOString(), calls: [], answers: [] }
	const t0 = Date.now()
	try {
		const out = await ARMS[arm](c, B, rec)
		rec.ms = Date.now() - t0
		rec.reply = out.reply ?? ""
		rec.notes = out.notes ?? []
		rec.report = out.report ?? null
		rec.extra = out.extra ?? null
		rec.scene = out.scene ?? null
		rec.eval = await evaluate(c, B, { scene: out.scene ?? null, reply: rec.reply, notes: rec.notes })
	} catch (e) {
		rec.ms = Date.now() - t0
		rec.error = String(e?.stack ?? e).slice(0, 1500)
		rec.eval = { pass: false, pass_byte: false, checks: { error: false }, fail: [`error: ${String(e?.message ?? e).slice(0, 300)}`] }
	}
	rec.cost = rec.calls.reduce((s, x) => s + (x.usage?.costInUSD ?? 0), 0)
	writeJson(file, rec)
	log(`${arm} ${c.id}: ${rec.eval.pass ? "PASS" : "fail"}${rec.eval.pass_byte ? "" : rec.eval.pass ? " (not byte)" : ""} ${Math.round(rec.ms / 100) / 10} s $${rec.cost.toFixed(3)} ${rec.eval.pass ? "" : `— ${rec.eval.fail.join(" | ").slice(0, 400)}`}`)
	return rec
}

async function jobs(items, n, fn) {
	let i = 0
	await Promise.all(Array.from({ length: n }, async () => {
		while (i < items.length) {
			const k = i++
			await fn(items[k])
		}
	}))
}

export function selectCases() {
	let cs = CASES
	const ids = list(opt.cases)
	if (ids) cs = cs.filter((c) => ids.includes(c.id))
	if (opt.cat) cs = cs.filter((c) => list(opt.cat).includes(c.cat))
	if (opt.base) cs = cs.filter((c) => (typeof c.base === "string" ? c.base : c.base.from) === opt.base)
	if (opt.limit) cs = cs.slice(0, Number(opt.limit))
	return cs
}

// ---------------------------------------------------------------- report
const pct = (a, p) => {
	const s = a.filter(Number.isFinite).sort((x, y) => x - y)
	if (!s.length) return NaN
	const i = (s.length - 1) * p
	return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i))
}
export function report(run, arms, cases) {
	const rows = []
	const per = {}
	for (const arm of arms) {
		const recs = cases.map((c) => {
			const f = path.join(OUT, run, arm, `${c.id}.json`)
			return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null
		}).filter(Boolean)
		per[arm] = new Map(recs.map((r) => [r.case, r]))
		const rate = (f) => (recs.length ? recs.filter(f).length / recs.length : NaN)
		const k = (name) => {
			const xs = recs.filter((r) => r.eval?.checks?.[name] !== undefined)
			return xs.length ? `${xs.filter((r) => r.eval.checks[name] !== false).length}/${xs.length}` : "-"
		}
		rows.push({ arm, n: recs.length, pass: rate((r) => r.eval?.pass), pass_byte: rate((r) => r.eval?.pass_byte), exact: k("exact"), untouched: k("untouched"), untouched_byte: k("untouched_byte"), extra: k("extra"), overlap: k("overlap"), works_or_said: k("works_or_said"), works: k("works"), noChange: k("noChange"), ask: k("ask"), answer: k("answer"), p50: pct(recs.map((r) => r.ms), 0.5) / 1000, p90: pct(recs.map((r) => r.ms), 0.9) / 1000, cost: recs.reduce((s, r) => s + (r.cost ?? 0), 0) / Math.max(1, recs.length), errors: recs.filter((r) => r.error).length })
	}
	const cats = [...new Set(cases.map((c) => c.cat))]
	const byCat = cats.map((cat) => {
		const ids = cases.filter((c) => c.cat === cat).map((c) => c.id)
		return { cat, n: ids.length, ...Object.fromEntries(arms.map((a) => [a, `${ids.filter((id) => per[a].get(id)?.eval?.pass).length}/${ids.filter((id) => per[a].has(id)).length}`])) }
	})
	return { rows, byCat, per }
}
function table(rows) {
	if (!rows.length) return ""
	const keys = Object.keys(rows[0])
	const f = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 3 : 1)) : String(v))
	return [`| ${keys.join(" | ")} |`, `|${keys.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${keys.map((k) => f(r[k])).join(" | ")} |`)].join("\n")
}

// ---------------------------------------------------------------- main
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const arms = list(opt.arms) ?? ["base"]
	const cases = selectCases()
	if (!opt.report) {
		await frozen()
		const grid = []
		for (const c of cases) for (const a of arms) grid.push({ a, c })
		log(`run ${RUN}: ${arms.join(", ")} × ${cases.length} cases`)
		await jobs(grid, Number(opt.jobs ?? 6), ({ a, c }) => runOne(a, c))
	}
	const r = report(RUN, arms, cases)
	console.log(table(r.rows))
	console.log()
	console.log(table(r.byCat))
	fs.mkdirSync(SUMMARY, { recursive: true })
	const failures = {}
	for (const a of arms) failures[a] = Object.fromEntries([...r.per[a].values()].filter((x) => !x.eval?.pass).map((x) => [x.case, x.eval?.fail ?? []]))
	writeJson(path.join(SUMMARY, `${RUN}.json`), { run: RUN, at: new Date().toISOString(), arms, cases: cases.length, rows: r.rows, byCat: r.byCat, failures })
	await closeRenderer()
	process.exit(0)
}
