#!/usr/bin/env node
// The edit experiment's eval (ai/experiments/edit: 105 cases on 11 scenes, its checks and its grader) run against the INTEGRATED server edit
// step (ai/steps.mjs, ai/rich-digest.mjs, ai/prompts/edit.md, ai/schemas.mjs as shipped: ai/DESIGN.md §14), with the experiment's frozen
// browser-side application (its arms.mjs arm n7: apply-edit v3, the overlap repair turn, aim-first for "make it work", the tuner), so the
// comparison with the experiment's own n7 numbers is the server change only.
//   zsh -c 'source ~/.config/truefoundry/env && node ai/bench/tools/edit-integrated.mjs --run i1 [--cases id,id] [--cat fix] [--jobs 6] [--intent edit] [--original]'
//   node ai/bench/tools/edit-integrated.mjs --report --runs i1,i2 [--ref r1,r2] [--fix-runs i1,...,i5] [--same-time t1,...,t5 --same-time-cases a,b] [--save]
// --original runs the experiment's own edit call instead (results under "n7orig"), for a same-time comparison; --save writes the summary to
// ai/bench/results/edit-n7-integrated/. Measured 2026-10-15: ai/research/benchmark.md §14.
// How: a copy of the live ai/ (checked byte-identical, recorded in <out>/<run>/tree.json) is put next to the experiment's frozen web/sim
// (so the server's own run of the scene uses the engine the frozen browser side uses); the experiment's arms.mjs runs unchanged, with its
// "./lib/step.mjs" swapped by a module hook for ./edit-integrated-step.mjs (runStep("edit") of that copy; the experiment's `extra` goes as
// `feedback`). Results: one JSON per (run, case) under $EDIT_OUT (default: this session's scratchpad n7int/results), never under
// ai/experiments. The reference is the experiment's own records ($EDIT_REF_OUT): arm n7 on the 4 "make it work" cases and, on the other
// 101, arm n6 (n7 runs exactly n6 there; the experiment ran n7 only on the fix cases).
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.join(HERE, "..", "..", "..")
const EXP = path.join(REPO, "ai", "experiments", "edit")
const SCRATCH = "/private/tmp/claude-501/-Users-ramsarma-Downloads-science-map-share/cb014d17-1cd6-4220-a508-cf6ce5539a35/scratchpad"
const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i++) {
	if (!argv[i].startsWith("--")) continue
	const v = argv[i + 1]
	if (v === undefined || v.startsWith("--")) opt[argv[i].slice(2)] = true
	else (opt[argv[i].slice(2)] = v), i++
}
const list = (v) => (v === undefined || v === true ? null : String(v).split(",").map((s) => s.trim()).filter(Boolean))
process.env.EDIT_OUT ??= path.join(SCRATCH, "n7int", "results")
process.env.EDIT_TREE ??= path.join(SCRATCH, "n7int", "tree")
const REF_OUT = process.env.EDIT_REF_OUT ?? path.join(SCRATCH, "edit-results")
const RUN = String(opt.run ?? "i1")
process.env.EDIT_RUN = RUN
if (opt.intent) process.env.EDIT_INTENT = String(opt.intent)
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sha = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex")
const writeJson = (f, v) => {
	fs.mkdirSync(path.dirname(f), { recursive: true })
	fs.writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 1))
	fs.renameSync(`${f}.tmp`, f)
}

// ---------------------------------------------------------------- the copy of the live ai/ next to the frozen web/sim
function buildTree(frozenDir) {
	const TREE = process.env.EDIT_TREE
	const src = path.join(REPO, "ai")
	const dst = path.join(TREE, "ai")
	fs.mkdirSync(path.join(dst, "prompts"), { recursive: true })
	const files = [...fs.readdirSync(src).filter((f) => f.endsWith(".mjs") || f === "models.json"), ...fs.readdirSync(path.join(src, "prompts")).map((f) => `prompts/${f}`)]
	// (a file already there and identical is left alone: another run may be reading the tree)
	for (const f of [...fs.readdirSync(dst).filter((f) => f !== "prompts"), ...fs.readdirSync(path.join(dst, "prompts")).map((f) => `prompts/${f}`)]) if (!files.includes(f)) fs.rmSync(path.join(dst, f), { force: true })
	const out = {}
	for (const f of files) {
		const a = sha(path.join(src, f))
		if (!fs.existsSync(path.join(dst, f)) || sha(path.join(dst, f)) !== a) fs.copyFileSync(path.join(src, f), path.join(dst, f))
		if (a !== sha(path.join(dst, f))) throw new Error(`copy of ai/${f} differs`)
		out[f] = a
	}
	fs.mkdirSync(path.join(TREE, "web"), { recursive: true })
	const link = path.join(TREE, "web", "sim")
	let target = null
	try {
		target = fs.readlinkSync(link)
	} catch {}
	if (target !== path.join(frozenDir, "web", "sim")) {
		fs.rmSync(link, { force: true })
		fs.symlinkSync(path.join(frozenDir, "web", "sim"), link)
	}
	return { at: new Date().toISOString(), tree: TREE, websim: path.join(frozenDir, "web", "sim"), files: out }
}

// ---------------------------------------------------------------- the module hook: arms.mjs's edit call -> the integrated step
// (--original: no swap, the experiment's own edit call, for a same-time comparison; its results go under "n7orig")
const ARM_DIR = opt.original ? "n7orig" : "n7"
const SHIM = pathToFileURL(path.join(HERE, "edit-integrated-step.mjs")).href
if (!opt.original) registerHooks({
	resolve(spec, ctx, next) {
		if (spec === "./lib/step.mjs" && String(ctx.parentURL ?? "").endsWith("/ai/experiments/edit/arms.mjs")) return { url: SHIM, shortCircuit: true }
		return next(spec, ctx)
	}
})
const imp = (rel) => import(pathToFileURL(path.join(EXP, rel)).href)
const { OUT, FROZEN, frozen } = await imp("lib/env.mjs")
const { CASES } = await imp("cases.mjs")

// ---------------------------------------------------------------- running (as ai/experiments/edit/run.mjs runOne, results under $EDIT_OUT)
async function runAll() {
	const { prepareCase, evaluate } = await imp("lib/check.mjs")
	await frozen()
	const tree = buildTree(FROZEN)
	writeJson(path.join(OUT, RUN, "tree.json"), { ...tree, intent: process.env.EDIT_INTENT ?? null })
	const { ARMS, closeRenderer } = await imp("arms.mjs")
	let cs = CASES
	if (list(opt.cases)) cs = cs.filter((c) => list(opt.cases).includes(c.id))
	if (list(opt.cat)) cs = cs.filter((c) => list(opt.cat).includes(c.cat))
	log(`run ${RUN}: ${opt.original ? "the experiment's own edit step" : "the integrated step"} (arm n7's browser side) × ${cs.length} cases${process.env.EDIT_INTENT ? `, intent ${process.env.EDIT_INTENT}` : ""}`)
	const one = async (c) => {
		const file = path.join(OUT, RUN, ARM_DIR, `${c.id}.json`)
		if (!opt.force && fs.existsSync(file) && !JSON.parse(fs.readFileSync(file, "utf8")).error) return
		const B = await prepareCase(c)
		const rec = { case: c.id, cat: c.cat, arm: "n7", run: RUN, text: c.text, at: new Date().toISOString(), calls: [], answers: [], server: opt.original ? "experiment" : "integrated" }
		const t0 = Date.now()
		try {
			const out = await ARMS.n7(c, B, rec)
			rec.ms = Date.now() - t0
			rec.reply = out.reply ?? ""
			rec.notes = out.notes ?? []
			rec.report = out.report ?? null
			rec.scene = out.scene ?? null
			rec.eval = await evaluate(c, B, { scene: out.scene ?? null, reply: rec.reply, notes: rec.notes })
		} catch (e) {
			rec.ms = Date.now() - t0
			rec.error = String(e?.stack ?? e).slice(0, 1500)
			rec.eval = { pass: false, pass_byte: false, checks: { error: false }, fail: [`error: ${String(e?.message ?? e).slice(0, 300)}`] }
		}
		rec.cost = rec.calls.reduce((s, x) => s + (x.usage?.costInUSD ?? 0), 0)
		writeJson(file, rec)
		log(`${c.id}: ${rec.eval.pass ? "PASS" : "fail"}${rec.eval.pass && !rec.eval.pass_byte ? " (not byte)" : ""} ${(rec.ms / 1000).toFixed(1)} s $${rec.cost.toFixed(3)} ${rec.eval.pass ? "" : `— ${(rec.eval.fail ?? []).join(" | ").slice(0, 300)}`}`)
	}
	let i = 0
	await Promise.all(Array.from({ length: Number(opt.jobs ?? 6) }, async () => {
		while (i < cs.length) await one(cs[i++])
	}))
	await closeRenderer()
}

// ---------------------------------------------------------------- the report: integrated vs the experiment's n7
const pct = (a, p) => {
	const s = a.filter(Number.isFinite).sort((x, y) => x - y)
	if (!s.length) return NaN
	const i = (s.length - 1) * p
	return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i))
}
const load = (dir, run, arm, id) => {
	const f = path.join(dir, run, arm, `${id}.json`)
	return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null
}
const refRec = (run, c) => load(REF_OUT, run, c.cat === "fix" ? "n7" : "n6", c.id)
const intRec = (run, c) => load(OUT, run, "n7", c.id)
const origRec = (run, c) => load(OUT, run, "n7orig", c.id)
const CHECKS = ["exact", "untouched", "untouched_byte", "extra", "overlap", "works_or_said", "noChange", "ask", "answer"]
function row(name, rs) {
	const k = (n) => {
		const xs = rs.filter((r) => r.eval?.checks?.[n] !== undefined && r.eval?.checks?.[n] !== null)
		return { ok: xs.filter((r) => r.eval.checks[n] !== false).length, n: xs.length }
	}
	const calls = rs.map((r) => (r.calls ?? []).filter((c) => /^edit/.test(c.step)).length)
	return {
		arm: name,
		n: rs.length,
		pass: rs.filter((r) => r.eval?.pass).length / Math.max(1, rs.length),
		pass_byte: rs.filter((r) => r.eval?.pass_byte).length / Math.max(1, rs.length),
		...Object.fromEntries(CHECKS.map((n) => [n, k(n)])),
		errors: rs.filter((r) => r.error).length,
		p50_s: pct(rs.map((r) => r.ms), 0.5) / 1000,
		p90_s: pct(rs.map((r) => r.ms), 0.9) / 1000,
		edit_calls: calls.reduce((a, b) => a + b, 0) / Math.max(1, calls.length),
		usd: rs.reduce((q, r) => q + (r.cost ?? 0), 0) / Math.max(1, rs.length)
	}
}
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "-")
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "-")
const frac = (x) => `${x.ok}/${x.n}`
function printRows(rows) {
	console.log("| arm | n | pass | pass, byte-identical | exact change | others untouched (≤ 3 mm) | untouched byte | no unasked items | no new overlaps | works or says why | questions/ambiguous unchanged | asks when ambiguous | answers right | errors | p50 / p90 s | edit calls | $ per edit |")
	console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
	for (const r of rows) console.log(`| ${r.arm} | ${r.n} | ${f3(r.pass)} | ${f3(r.pass_byte)} | ${frac(r.exact)} | ${frac(r.untouched)} | ${frac(r.untouched_byte)} | ${frac(r.extra)} | ${frac(r.overlap)} | ${frac(r.works_or_said)} | ${frac(r.noChange)} | ${frac(r.ask)} | ${frac(r.answer)} | ${r.errors} | ${f1(r.p50_s)} / ${f1(r.p90_s)} | ${r.edit_calls.toFixed(2)} | ${r.usd.toFixed(3)} |`)
}
function reportAll() {
	const runs = list(opt.runs) ?? ["i1", "i2"]
	const refRuns = list(opt.ref) ?? ["r1", "r2"].slice(0, runs.length)
	const fixRuns = list(opt["fix-runs"]) ?? runs
	const fixRef = list(opt["fix-ref"]) ?? ["r1", "r2", "r3", "r4", "r5"]
	const pairsOf = (rr, ir, cases) => cases.flatMap((c) => rr.map((r, k) => [refRec(r, c), ir[k] ? intRec(ir[k], c) : null, c]))
	const ref = refRuns.flatMap((r) => CASES.map((c) => refRec(r, c)).filter(Boolean))
	const int = runs.flatMap((r) => CASES.map((c) => intRec(r, c)).filter(Boolean))
	const rows = [row(`experiment n7 (${refRuns.join("+")})`, ref), row(`integrated (${runs.join("+")})`, int)]
	console.log(`## All ${CASES.length} cases × ${runs.length} samples\n`)
	printRows(rows)
	const fixCases = CASES.filter((c) => c.cat === "fix")
	const fr = fixRef.flatMap((r) => fixCases.map((c) => load(REF_OUT, r, "n7", c.id)).filter(Boolean))
	const fi = fixRuns.flatMap((r) => fixCases.map((c) => intRec(r, c)).filter(Boolean))
	console.log(`\n## "Make it work again": ${fixCases.length} cases × samples\n`)
	console.log(`| arm | n | pass | ${fixCases.map((c) => c.id).join(" | ")} | p50 / p90 s | $ |\n|---|---|---|${fixCases.map(() => "---").join("|")}|---|---|`)
	const fixRow = (name, rs) => `| ${name} | ${rs.length} | ${rs.filter((r) => r.eval?.pass).length}/${rs.length} | ${fixCases.map((c) => { const x = rs.filter((r) => r.case === c.id); return `${x.filter((r) => r.eval?.pass).length}/${x.length}` }).join(" | ")} | ${f1(pct(rs.map((r) => r.ms), 0.5) / 1000)} / ${f1(pct(rs.map((r) => r.ms), 0.9) / 1000)} | ${(rs.reduce((q, r) => q + (r.cost ?? 0), 0) / Math.max(1, rs.length)).toFixed(3)} |`
	console.log(fixRow(`experiment n7 (${fixRef.join("+")})`, fr))
	console.log(fixRow(`integrated (${fixRuns.join("+")})`, fi))
	// a same-time comparison on the hard ones (--same-time runs: the integrated and the experiment's own step, launched together)
	const st = list(opt["same-time"])
	let sameTime = null
	if (st) {
		const ids = new Set(list(opt["same-time-cases"]) ?? fixCases.map((c) => c.id))
		const cs = fixCases.filter((c) => ids.has(c.id))
		const a = st.flatMap((r) => cs.map((c) => origRec(r, c)).filter(Boolean))
		const b = st.flatMap((r) => cs.map((c) => intRec(r, c)).filter(Boolean))
		sameTime = { runs: st, cases: cs.map((c) => c.id), experiment: { pass: a.filter((r) => r.eval?.pass).length, n: a.length }, integrated: { pass: b.filter((r) => r.eval?.pass).length, n: b.length } }
		console.log(`\nSame time (${st.join("+")}): the experiment's own step ${a.filter((r) => r.eval?.pass).length}/${a.length}, the integrated ${b.filter((r) => r.eval?.pass).length}/${b.length} (${cs.map((c) => `${c.id}: ${a.filter((r) => r.case === c.id && r.eval?.pass).length}/${a.filter((r) => r.case === c.id).length} vs ${b.filter((r) => r.case === c.id && r.eval?.pass).length}/${b.filter((r) => r.case === c.id).length}`).join("; ")})`)
	}
	const cats = [...new Set(CASES.map((c) => c.cat))]
	console.log(`\n## By category\n\n| category | n | experiment n7 | integrated |\n|---|---|---|---|`)
	const byCat = []
	for (const cat of cats) {
		const ids = new Set(CASES.filter((c) => c.cat === cat).map((c) => c.id))
		const a = ref.filter((r) => ids.has(r.case))
		const b = int.filter((r) => ids.has(r.case))
		byCat.push({ cat, ref: `${a.filter((r) => r.eval?.pass).length}/${a.length}`, int: `${b.filter((r) => r.eval?.pass).length}/${b.length}` })
		console.log(`| ${cat} | ${ids.size * runs.length} | ${byCat.at(-1).ref} | ${byCat.at(-1).int} |`)
	}
	const baseOf = (c) => (typeof c.base === "string" ? c.base : c.base.from)
	console.log(`\n## By base scene\n\n| base | n | experiment n7 | integrated |\n|---|---|---|---|`)
	for (const b of [...new Set(CASES.map(baseOf))]) {
		const ids = new Set(CASES.filter((c) => baseOf(c) === b).map((c) => c.id))
		const a = ref.filter((r) => ids.has(r.case))
		const z = int.filter((r) => ids.has(r.case))
		console.log(`| ${b} | ${ids.size * runs.length} | ${a.filter((r) => r.eval?.pass).length}/${a.length} | ${z.filter((r) => r.eval?.pass).length}/${z.length} |`)
	}
	// paired: the same case and sample index (r1 ↔ i1, r2 ↔ i2)
	let both = 0
	let onlyRef = 0
	let onlyInt = 0
	let none = 0
	const wins = []
	const losses = []
	for (const [a, b, c] of pairsOf(refRuns, runs, CASES)) {
		if (!a || !b) continue
		if (a.eval?.pass && b.eval?.pass) both++
		else if (a.eval?.pass) (onlyRef++, losses.push(`${c.id} (${b.run}): ${(b.eval?.fail ?? []).join(" | ").slice(0, 240)}`))
		else if (b.eval?.pass) (onlyInt++, wins.push(`${c.id} (${b.run})`))
		else none++
	}
	console.log(`\n## Paired (same case, same sample index)\n\nboth pass ${both}, only the experiment's ${onlyRef}, only the integrated ${onlyInt}, both fail ${none}: net ${onlyInt - onlyRef >= 0 ? "+" : ""}${onlyInt - onlyRef}`)
	if (losses.length) console.log(`only the experiment's passed:\n${losses.map((x) => `- ${x}`).join("\n")}`)
	if (wins.length) console.log(`only the integrated passed: ${wins.join(", ")}`)
	const real = CASES.find((c) => c.id === "s-swap-user")
	console.log(`\n## The user's real request ("${real.text}")`)
	for (const r of runs) {
		const x = intRec(r, real)
		if (x) console.log(`- ${r}: ${x.eval?.pass ? "PASS" : "fail"}${x.eval?.pass_byte ? " (untouched byte-identical)" : ""}, ${(x.ms / 1000).toFixed(1)} s — "${String(x.reply).slice(0, 300)}"`)
	}
	// the request text: integrated vs the experiment's own, per call
	const turns = runs.flatMap((r) => {
		const f = path.join(OUT, r, "user-turns.jsonl")
		return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []
	})
	const differ = turns.filter((t) => !t.same)
	const kinds = {}
	for (const t of differ) for (const d of t.diffs ?? []) {
		const key = d.experiment.replace(/\d+(\.\d+)?/g, "#").slice(0, 60)
		kinds[key] = (kinds[key] ?? 0) + 1
	}
	const goalsOnly = differ.filter((t) => (t.diffs ?? []).length && t.diffs.every((d) => /^Goals: /.test(d.experiment) && /^Goals: /.test(d.integrated)))
	console.log(`\n## The request text: ${turns.length - differ.length} of ${turns.length} edit calls sent exactly the experiment's text; ${goalsOnly.length} of the other ${differ.length} differ only in the "Goals:" line (the plan's falls / hits / moves goals shown MET / FAILED)`)
	for (const [k, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`- ${n}× a line differs, the experiment's: "${k}…"`)
	if (opt.save) {
		const dir = path.join(REPO, "ai", "bench", "results", "edit-n7-integrated")
		const perCase = CASES.map((c) => ({ id: c.id, cat: c.cat, ref: refRuns.map((r) => refRec(r, c)?.eval?.pass ?? null), integrated: runs.map((r) => intRec(r, c)?.eval?.pass ?? null), fails: runs.map((r) => (intRec(r, c)?.eval?.fail ?? []).join(" | ").slice(0, 300)) }))
		writeJson(path.join(dir, `summary-${runs.join("+")}.json`), { at: new Date().toISOString(), runs, refRuns, fixRuns, fixRef, rows, fix: { ref: { pass: fr.filter((r) => r.eval?.pass).length, n: fr.length }, integrated: { pass: fi.filter((r) => r.eval?.pass).length, n: fi.length }, sameTime }, byCat, paired: { both, onlyRef, onlyInt, none, wins, losses }, requestText: { calls: turns.length, same: turns.length - differ.length, goalsLineOnly: goalsOnly.length, kinds }, perCase, trees: runs.map((r) => { const f = path.join(OUT, r, "tree.json"); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null }) })
		console.log(`\nsaved ${path.relative(REPO, dir)}/summary-${runs.join("+")}.json`)
	}
}

if (opt.report) reportAll()
else await runAll()
process.exit(0)
