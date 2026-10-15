#!/usr/bin/env node
// Physics-verified planning experiment: best-of-N plans and stage-by-stage chains against the shipped single-plan pipeline.
//
//   zsh -c 'source ~/.config/truefoundry/env && node ai/experiments/search/run.mjs build --run r1 [--cases a,b] [--arms base,bon,stage,bonstage] [--jobs 3]'
//   zsh -c 'source ~/.config/truefoundry/env && node ai/experiments/search/run.mjs judge --run r1 [--judges opus-high]'
//   node ai/experiments/search/run.mjs report --run r1
//
// Everything runs on a snapshot of the pipeline (frozen/: ai/*.mjs, prompts, models.json, web/ai/{solver,orchestrator,goals}.js, the bench's
// scorer and libs; web/sim is the live engine) so the other agents' edits cannot change it mid-run. At most 4 model calls in flight
// (lib/infra.mjs), a busy gateway is waited out. Results: results/<run>/{plans,<arm>}/<case>.json (resumable: finished files are skipped).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
for (let i = 1; i < argv.length; i++) {
	const a = argv[i]
	if (!a.startsWith("--")) continue
	const v = argv[i + 1]
	if (v === undefined || v.startsWith("--")) opt[a.slice(2)] = true
	else (opt[a.slice(2)] = v), i++
}
const list = (v) => (v === undefined || v === true ? null : String(v).split(",").map((s) => s.trim()).filter(Boolean))
const RUN = String(opt.run ?? "r1")
const RES = path.join(HERE, "results", RUN)

const infra = await import("./lib/infra.mjs")
const { log, ledger, ledgerTotals, now, clone, closeAll, shots, saveShots, loadShots, SCRATCH, inFlight } = infra
const { planVariant, VARIANTS } = await import("./lib/plan.mjs")
const { chainBuild, selectBest, shippedLoop, gatedFinish } = await import("./lib/arms.mjs")
const { measure, judgeIt, bench } = await import("./lib/metrics.mjs")
const { evaluate } = await import("./lib/physics.mjs")
const { incrementalBuild } = await import("./lib/inc.mjs")

const B = bench(path.join(HERE, "bench"))
const ARMS = list(opt.arms) ?? ["base", "bon", "stage", "bonstage"]
const VARS = list(opt.variants) ?? ["A", "B", "C", "D"]
const writeJson = (f, v) => {
	fs.mkdirSync(path.dirname(f), { recursive: true })
	const tmp = `${f}.${process.pid}.tmp`
	fs.writeFileSync(tmp, JSON.stringify(v, null, 1))
	fs.renameSync(tmp, f)
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"))
const fileOf = (arm, id) => path.join(RES, arm, `${id}.json`)

function selectCases() {
	let cs = B.text
	const ids = list(opt.cases)
	if (ids) cs = cs.filter((c) => ids.includes(c.id))
	if (opt.origin) cs = cs.filter((c) => c.origin === opt.origin)
	if (opt.limit) cs = cs.slice(0, Number(opt.limit))
	return cs
}
async function runJobs(items, fn, parallel) {
	let i = 0
	const worker = async () => {
		while (i < items.length) {
			const it = items[i++]
			try {
				await fn(it)
			} catch (e) {
				log(`job ${it.id ?? ""} crashed: ${e?.stack ?? e}`)
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker))
}
const trimSim = (s) => (s ? { goals: s.summary?.goals, events: (s.summary?.events ?? []).slice(0, 30), stories: (s.summary?.stories ?? []).slice(0, 30), warnings: s.warnings } : null)

// ---------------------------------------------------------------- plans (shared by the arms: a paired comparison)
async function plansFor(c) {
	const f = fileOf("plans", c.id)
	const have = fs.existsSync(f) ? readJson(f) : { case: c.id, variants: {} }
	const need = VARS.filter((v) => !have.variants[v]?.ok)
	if (need.length) {
		await Promise.all(
			need.map(async (v) => {
				const L = ledger(`plan ${v}`)
				try {
					const out = await planVariant(L, c.prompt, VARIANTS[v])
					have.variants[v] = { ok: true, plan: out.result, ms: out.ms, usage: out.usage, model: out.model, calls: L.calls, warnings: (out.warnings ?? []).slice(0, 10) }
				} catch (e) {
					have.variants[v] = { ok: false, error: String(e?.message ?? e).slice(0, 400), calls: L.calls }
				}
			})
		)
		writeJson(f, have)
	}
	return have
}

// ---------------------------------------------------------------- one arm on one case
async function runArm(arm, c, plans) {
	const f = fileOf(arm, c.id)
	if (!opt.force && fs.existsSync(f)) return
	const L = ledger(arm)
	const used = ["base", "stage", "inc", "gate"].includes(arm) ? ["A"] : VARS
	for (const v of used) for (const call of plans.variants[v]?.calls ?? []) L.add({ ...call, label: `plan ${v}` })
	const okPlans = used.filter((v) => plans.variants[v]?.ok).map((v) => ({ variant: v, plan: plans.variants[v].plan, ms: plans.variants[v].ms }))
	const rec = { case: c.id, arm, origin: c.origin, category: c.category, prompt: c.prompt, at: new Date().toISOString(), timing: {} }
	const T0 = now()
	try {
		if (!okPlans.length) throw new Error("no plan came back")
		rec.timing.planMs = Math.max(...okPlans.map((p) => p.ms ?? 0))
		let plan
		let chosen = "A"
		if (arm === "base") plan = okPlans.find((p) => p.variant === "A")?.plan
		else if (arm === "stage") {
			const A = okPlans.find((p) => p.variant === "A")
			if (!A) throw new Error("plan A failed")
			const before = L.calls.length
			const ch = await chainBuild(L, c.prompt, A.plan, { name: `${c.id}/stage` })
			rec.chain = ch.log
			rec.timing.searchMs = ch.ms - L.calls.slice(before).reduce((s, x) => s + (x.waitMs ?? 0), 0)
			rec.timing.searchRuns = ch.runs
			plan = ch.ev.ok ? ch.ev.plan : A.plan
		} else if (arm === "inc") {
			const A = okPlans.find((p) => p.variant === "A")
			if (!A) throw new Error("plan A failed")
			const before = L.calls.length
			let ch = await incrementalBuild(L, c.prompt, A.plan, { name: `${c.id}/inc` })
			if (!ch) {
				ch = await chainBuild(L, c.prompt, A.plan, { name: `${c.id}/inc(stage)` })
				rec.fallback = "not a chain of 2+ checked stages: the stage arm's build"
			}
			rec.chain = ch.log
			rec.timing.searchMs = ch.ms - L.calls.slice(before).reduce((s, x) => s + (x.waitMs ?? 0), 0)
			rec.timing.searchRuns = ch.runs
			plan = ch.ev.ok ? ch.ev.plan : A.plan
		} else if (arm === "bon" || arm === "bonstage") {
			const sel = await selectBest(L, c.prompt, okPlans, { mode: arm === "bonstage" ? "stage" : "shipped", name: `${c.id}/${arm}` })
			rec.select = sel.table
			if (!sel.best) throw new Error("no candidate built")
			chosen = sel.best.variant
			rec.timing.searchMs = sel.tuneMs + sel.rateMs
			plan = sel.best.ev.plan
			if (arm === "bonstage") {
				const before = L.calls.length
				const ch = await chainBuild(L, c.prompt, plan, { from: sel.best.ev, name: `${c.id}/bonstage` })
				rec.chain = ch.log
				rec.timing.searchMs += ch.ms - L.calls.slice(before).reduce((s, x) => s + (x.waitMs ?? 0), 0)
				plan = ch.ev.ok ? ch.ev.plan : plan
			}
		}
		if (arm === "gate") {
			// the stage build, then the verified gate instead of the critic's rounds
			const A = okPlans.find((p) => p.variant === "A")
			if (!A) throw new Error("plan A failed")
			let before = L.calls.length
			const ch = await chainBuild(L, c.prompt, A.plan, { name: `${c.id}/gate` })
			rec.chain = ch.log
			rec.timing.searchMs = ch.ms - L.calls.slice(before).reduce((s, x) => s + (x.waitMs ?? 0), 0)
			rec.timing.searchRuns = ch.runs
			const ev = ch.ev.ok ? ch.ev : await evaluate(A.plan)
			rec.chosen = "A"
			rec.plan0 = ev.plan
			rec.pre = await measure(c, ev.plan, ev.scene)
			delete rec.pre.sim
			before = L.calls.length
			const t1 = now()
			const g = await gatedFinish(L, c.prompt, ev)
			rec.gate = { ...g.gate, from: g.final.from }
			rec.timing.loopMs = now() - t1 - L.calls.slice(before).reduce((s, x) => s + (x.waitMs ?? 0), 0)
			if (g.loop) {
				const rep = g.loop.report
				rec.report = { title: rep.title, refine: (rep.refine ?? []).map((e) => ({ round: e.round, score: e.score, done: e.done, final: !!e.final, rejected: e.rejected ?? null, changes: (e.changes ?? []).slice(0, 8), issues: (e.issues ?? []).slice(0, 4) })), tune: rep.tune ? { runs: rep.tune.runs, passed: rep.tune.passed, changed: rep.tune.changed, reverted: !!rep.tune.reverted } : null, score: rep.score ?? null, goals: rep.goals ?? null }
			} else rec.report = { refine: [], tune: null }
			rec.plan = g.final.plan
			rec.scene = g.final.scene
			rec.final = await measure(c, g.final.plan, g.final.scene)
			rec.sim = trimSim(rec.final.sim)
			delete rec.final.sim
			rec.ok = true
			throw Object.assign(new Error("done"), { done: true })
		}
		rec.chosen = chosen
		rec.plan0 = plan
		// before the shipped loop: what the search alone delivers
		const ev = await evaluate(plan)
		rec.pre = ev.ok ? await measure(c, plan, ev.scene) : { ok: false, error: ev.error }
		if (rec.pre?.sim) delete rec.pre.sim
		const loop = await shippedLoop(L, c.prompt, plan)
		const rep = loop.report
		rec.timing.loopMs = loop.ms - loop.waitMs
		rec.timing.loopWallMs = loop.ms
		rec.report = { title: rep.title, refine: (rep.refine ?? []).map((e) => ({ round: e.round, score: e.score, done: e.done, final: !!e.final, rejected: e.rejected ?? null, changes: (e.changes ?? []).slice(0, 8), issues: (e.issues ?? []).slice(0, 4) })), tune: rep.tune ? { runs: rep.tune.runs, passed: rep.tune.passed, changed: rep.tune.changed, reverted: !!rep.tune.reverted } : null, score: rep.score ?? null, goals: rep.goals ?? null, problems: rep.problems ?? [], timings: rep.timings }
		rec.plan = rep.plan
		rec.scene = rep.scene
		rec.final = await measure(c, rep.plan, rep.scene)
		rec.sim = trimSim(rec.final.sim)
		delete rec.final.sim
		rec.ok = true
	} catch (e) {
		if (!e?.done) {
			rec.ok = false
			rec.error = String(e?.stack ?? e).slice(0, 800)
		}
	}
	rec.timing.wallMs = now() - T0
	rec.timing.modeledMs = (rec.timing.planMs ?? 0) + (rec.timing.searchMs ?? 0) + (rec.timing.loopMs ?? 0)
	rec.ledger = ledgerTotals(L)
	rec.calls = L.calls.map((x) => ({ step: x.step, label: x.label, ok: x.ok, ms: x.ms, waitMs: x.waitMs, cost: x.cost, model: x.model, error: x.error }))
	writeJson(f, rec)
	const fin = rec.final
	log(`${c.id} ${arm}: ${rec.ok ? `success ${fin?.success ? "YES" : "no"} · pass ${fin?.pass ? "Y" : "n"} · outcomes ${fin?.outcomesOk}/${fin?.outcomesN} · own goals ${fin?.ownGoalsOk}/${fin?.ownGoals} · stages ${fin?.ownStagesOk}/${fin?.ownStages} · pre success ${rec.pre?.success ? "Y" : "n"} · ${Math.round(rec.timing.modeledMs / 1000)} s modeled · $${rec.ledger.cost}` : `ERROR ${rec.error.slice(0, 200)}`} (in flight ${inFlight().active}, waiting ${inFlight().waiting})`)
}

async function cmdBuild() {
	const cases = selectCases()
	log(`build ${RUN}: ${cases.length} cases × ${ARMS.join(", ")} (variants ${VARS.join("")})`)
	await runJobs(
		cases,
		async (c) => {
			if (!opt.force && ARMS.every((a) => fs.existsSync(fileOf(a, c.id)))) return
			const plans = await plansFor(c)
			log(`${c.id}: plans ${VARS.map((v) => `${v}${plans.variants[v]?.ok ? `(${Math.round((plans.variants[v].ms ?? 0) / 1000)} s, ${plans.variants[v].plan.items.length} items${plans.variants[v].plan.stages?.length ? `, ${plans.variants[v].plan.stages.length} stages` : ""})` : " FAILED"}`).join(" ")}`)
			await Promise.all(ARMS.map((a) => runArm(a, c, plans)))
		},
		Number(opt.jobs ?? 3)
	)
}

// ---------------------------------------------------------------- judge (blinded, on the final scenes; renders kept in the scratchpad)
async function cmdJudge() {
	const judges = list(opt.judges) ?? ["opus-high"]
	const jobs = []
	for (const arm of list(opt.arms) ?? fs.readdirSync(RES).filter((d) => d !== "plans" && fs.statSync(path.join(RES, d)).isDirectory()))
		for (const f of fs.existsSync(path.join(RES, arm)) ? fs.readdirSync(path.join(RES, arm)).filter((x) => x.endsWith(".json")) : []) jobs.push({ arm, file: path.join(RES, arm, f), id: f.replace(/\.json$/, "") })
	log(`judge ${RUN}: ${jobs.length} results × ${judges.join(", ")}`)
	await runJobs(
		jobs,
		async ({ arm, file, id }) => {
			let rec = readJson(file)
			const c = B.cases.get(id)
			if (!c || !rec.ok) return
			// --which pre: the version before the shipped loop (the plan as the search left it), judged the same way
			const pre = opt.which === "pre"
			const JK = pre ? "judgePre" : "judge"
			const SK = pre ? "shotsPre" : "shots"
			if (judges.every((j) => rec[JK]?.[j]) && !opt.force) return
			let plan = rec.plan
			let scene = rec.scene
			if (pre) {
				if (!rec.plan0) return
				plan = rec.plan0
				scene = (await evaluate(plan)).scene
				if (!scene) return
			}
			const sim = await infra.simulate(scene)
			let pics = rec[SK] ? loadShots(rec[SK]) : []
			if (!pics.length) {
				pics = await shots(sim, scene)
				rec[SK] = saveShots(pics, path.join(SCRATCH, "renders", RUN, pre ? `${arm}-pre` : arm), id)
			}
			for (const j of judges) {
				if (rec[JK]?.[j] && !opt.force) continue
				const L = ledger("judge")
				try {
					const r = await judgeIt(L, c, { plan, scene, sim: { summary: sim.summary, warnings: sim.warnings }, shots: pics }, j)
					rec = { ...readJson(file), [SK]: rec[SK] }
					rec[JK] = { ...(rec[JK] ?? {}), [j]: { score: r?.score_0_10 ?? null, rubric_met: r?.rubric_met ?? null, outcome: r?.outcome ?? null, fidelity: r?.request_fidelity ?? null, sense: r?.physical_sense ?? null, honesty: r?.honesty ?? null, issues: (r?.issues ?? []).slice(0, 5), summary: r?.summary ?? null, cost: L.calls.reduce((s, x) => s + (x.cost ?? 0), 0) } }
					writeJson(file, rec)
					log(`judge ${j}${pre ? " (pre)" : ""} ${arm}/${id}: ${r?.score_0_10}${r?.rubric_met ? " (rubric met)" : ""}`)
				} catch (e) {
					log(`judge ${j} ${arm}/${id} failed: ${e.message}`)
				}
			}
		},
		Number(opt.jobs ?? 4)
	)
}

// ---------------------------------------------------------------- report
const mean = (a) => {
	const s = a.filter((x) => Number.isFinite(x))
	return s.length ? s.reduce((p, q) => p + q, 0) / s.length : null
}
const pct = (a, p) => {
	const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
	if (!s.length) return null
	const i = (s.length - 1) * p
	return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i))
}
const fx = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : Number(v).toFixed(d))
/** An arm's records, from one run or several (--run r1,r2: samples pooled; each record keeps its run). */
function loadArm(arm) {
	const out = []
	for (const run of RUN.split(",")) {
		const dir = path.join(HERE, "results", run, arm)
		if (!fs.existsSync(dir)) continue
		for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) out.push({ ...readJson(path.join(dir, f)), run })
	}
	return out
}
function rowOf(recs, which = "final") {
	const ok = recs.filter((r) => r.ok)
	const m = (r) => r[which]
	const stg = ok.filter((r) => (m(r)?.ownStages ?? 0) > 0)
	return {
		n: recs.length,
		failed: recs.length - ok.length,
		success: mean(recs.map((r) => (r.ok && m(r)?.success ? 1 : 0))),
		pass: mean(recs.map((r) => (r.ok && m(r)?.pass ? 1 : 0))),
		det: mean(ok.map((r) => m(r)?.score)),
		outcomes: mean(ok.map((r) => (m(r)?.outcomesN ? m(r).outcomesOk / m(r).outcomesN : null))),
		ownGoalsAll: mean(ok.filter((r) => m(r)?.ownGoals).map((r) => (m(r).ownGoalsOk === m(r).ownGoals ? 1 : 0))),
		stagesFrac: stg.length ? mean(stg.map((r) => m(r).ownStagesOk / m(r).ownStages)) : null,
		stagesAll: stg.length ? mean(stg.map((r) => (m(r).ownStagesOk === m(r).ownStages ? 1 : 0))) : null,
		stagedN: stg.length,
		judge: mean(ok.map((r) => r.judge?.["opus-high"]?.score)),
		rubric: mean(ok.filter((r) => r.judge?.["opus-high"]).map((r) => (r.judge["opus-high"].rubric_met ? 1 : 0))),
		t50: pct(ok.map((r) => r.timing?.modeledMs / 1000), 0.5),
		t90: pct(ok.map((r) => r.timing?.modeledMs / 1000), 0.9),
		w50: pct(ok.map((r) => r.timing?.wallMs / 1000), 0.5),
		cost: mean(recs.map((r) => r.ledger?.cost)),
		calls: mean(recs.map((r) => r.ledger?.calls))
	}
}
// requests with three or more hand-offs between different mechanisms
const CHAINS = new Set(["c1-rube-cup", "c2-marble-zigzag", "g2-chain-reaction", "h01-rube6-cup", "h03-domino-spiral-bell", "h04-pendulum-dominoes-ledge-bucket", "h06-ramp-seesaw-basket", "h07-two-pendulums-cup", "h08-conveyor-ramp-bucket", "h14-three-shelves-dominoes"])
function cmdReport() {
	const arms = list(opt.arms) ?? ["base", "bon", "stage", "bonstage", "inc", "gate"].filter((a) => RUN.split(",").some((run) => fs.existsSync(path.join(HERE, "results", run, a))))
	const data = Object.fromEntries(arms.map((a) => [a, loadArm(a)]))
	const groups = [
		["all", () => true],
		["bench (11)", (r) => r.origin === "bench"],
		["new (15)", (r) => r.origin === "new"],
		["chains (3+ hand-offs, 10)", (r) => CHAINS.has(r.case)],
		["single outcome (16)", (r) => !CHAINS.has(r.case)]
	]
	const lines = []
	const head = "| arm | n | success | pass | outcomes met | own goals all | stage checks (all-pass) | judge (rubric) | modeled s p50/p90 | wall s p50 | $/build | calls |"
	const sep = "|---|---|---|---|---|---|---|---|---|---|---|---|"
	for (const which of ["final", "pre"]) {
		lines.push(`\n### ${which === "final" ? "Final (after the shipped refine/tune loop)" : "Before the loop (the plan as chosen/tuned by the search)"}\n`)
		for (const [g, fn] of groups) {
			lines.push(`\n**${g}**\n`, head, sep)
			for (const a of arms) {
				const r = rowOf(data[a].filter(fn), which)
				lines.push(`| ${a} | ${r.n}${r.failed ? ` (${r.failed} err)` : ""} | ${fx(r.success)} | ${fx(r.pass)} | ${fx(r.outcomes)} | ${fx(r.ownGoalsAll)} | ${fx(r.stagesFrac)} (${fx(r.stagesAll)}; n=${r.stagedN}) | ${fx(r.judge, 2)} (${fx(r.rubric)}) | ${fx(r.t50, 0)} / ${fx(r.t90, 0)} | ${fx(r.w50, 0)} | ${fx(r.cost, 3)} | ${fx(r.calls, 1)} |`)
			}
		}
	}
	// per case
	lines.push("\n### Per case (final success · stage checks · judge · modeled s)\n")
	const ids = [...new Set(Object.values(data).flat().map((r) => r.case))].sort()
	lines.push(`| case | ${arms.join(" | ")} |`, `|---|${arms.map(() => "---").join("|")}|`)
	for (const id of ids) {
		const cells = arms.map((a) => {
			const rs = data[a].filter((x) => x.case === id)
			if (!rs.length) return " "
			return rs.map((r) => {
			if (!r.ok) return "ERR"
			const f = r.final
			return `${f.success ? "✓" : "✗"}${f.pass ? "P" : ""} ${f.ownStages ? `${f.ownStagesOk}/${f.ownStages}` : "-"} j${fx(r.judge?.["opus-high"]?.score, 0)} ${fx(r.timing?.modeledMs / 1000, 0)}s${r.chosen && r.chosen !== "A" ? ` [${r.chosen}]` : ""}${r.pre?.success && !f.success ? " (pre✓)" : ""}`
			}).join(" · ")
		})
		lines.push(`| ${id} | ${cells.join(" | ")} |`)
	}
	// selection: which variant won
	for (const a of ["bon", "bonstage"].filter((x) => data[x])) {
		const wins = {}
		for (const r of data[a]) if (r.chosen) wins[r.chosen] = (wins[r.chosen] ?? 0) + 1
		lines.push(`\n${a} winners: ${JSON.stringify(wins)}`)
	}
	// repairs
	for (const a of ["stage", "bonstage"].filter((x) => data[x])) {
		const reps = data[a].flatMap((r) => r.chain?.repairs ?? [])
		lines.push(`${a} repairs: ${reps.length} asked, ${reps.filter((r) => r.ok).length} answered, ${reps.filter((r) => r.accepted).length} kept`)
	}
	const text = lines.join("\n")
	console.log(text)
	const out = path.join(HERE, "results", RUN.replace(/,/g, "+"))
	fs.mkdirSync(out, { recursive: true })
	fs.writeFileSync(path.join(out, "report.md"), text)
}

try {
	if (cmd === "build") await cmdBuild()
	else if (cmd === "judge") await cmdJudge()
	else if (cmd === "report") cmdReport()
	else console.log("commands: build | judge | report")
} finally {
	await closeAll()
}
process.exit(0)
