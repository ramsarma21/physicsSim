#!/usr/bin/env node
// The AI scene builder's benchmark runner: each step with each candidate model config on the eval set, with the app's real prompts
// (ai/steps.mjs), the real solver (web/ai/solver.js), the real engine (web/sim, in worker threads: the same runs as POST /api/simulate),
// real renders (web/ai/shot.js in a headless Chromium on the local server) and the deterministic scorer (ai/bench/score.mjs), plus a blinded
// LLM rubric judge (lib/judge.mjs). Results are one JSON file per (phase, config, case) under ai/bench/results/<run>/, so a run can be
// stopped and resumed (finished files are skipped unless --force).
//
//   zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs <command> [options]'
//
// Commands
//   plan       --configs opus-high,astra-high   text cases (mode new) [+ --images: image cases, with an observation from --obs <run>/<cfg>]
//   observe    --configs opus-medium,argon-low  image cases: the observation, direct metrics against ground truth (gt-render cases)
//   downstream --obs <cfg>[,<cfg>] --planner <cfg>   image cases: observation (from this run's observe results) -> plan -> solve -> run -> score
//   refine     --configs ... --from <run>/<plan cfg> [--round 2 --after <refine cfg>]   one critique round on the stored plans; patches applied,
//              re-solved, re-run and re-scored (before/after)
//   edit       --configs opus-low,sol-low        edit cases: the edit step on the base scene -> patches/plan -> solve -> run -> score
//   pipeline   [--routing ai/models.json]        the whole app pipeline (web/ai/orchestrator.js: observe -> plan|edit -> solve -> run ->
//              render -> refine ≤ 3 -> tune) with that routing (fallbacks included), as the AI panel runs it
//   judge      --phase plan [--configs ...] --judges opus-high,astra-high   the blinded judge on stored results (resumable)
//   report     [--phase ...] [--by-split] [--detail]   tables (markdown, with judge agreement) + results/<run>/report.json; no model calls
//   rescore    [--phase ...]                    re-score stored answers with the current cases and scorer (re-runs the engine); no model calls
//   remetric   [--phase observe]                recompute the direct observation metrics of stored observations; no model calls
// Options: --run <name> (default "main") · --cases id,id · --split train|test · --category c · --kind photo|sketch|gt-render · --limit n ·
//   --force · --concurrency n (≤ 6 model calls in flight) · --jobs n (cases in progress at once, default 12) · --prompts <dir> (a prompt
//   variant: AI_PROMPTS_DIR) · --no-render · --render-pages n · --images (plan: also image cases) · --core (image cases: only the core gt
//   renders + photos + sketches) · --obs-run <run> (downstream: whose observations) · pipeline: --routing <file> --tag <name> --images
//   --edits --no-text · --client <dir> (web/ai from <dir>/web/ai: a frozen client for an A/B of server-side changes)
// Renders are written to $BENCH_RENDER_DIR/<run>/ (default ai/bench/results/<run>/renders/).
// The key is read from the environment by ai/core.mjs only; nothing here prints or stores it.
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

// ---------------------------------------------------------------- args (before importing the steps: --prompts must be in the env first)
const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
for (let i = 1; i < argv.length; i++) {
	const a = argv[i]
	if (!a.startsWith("--")) continue
	const k = a.slice(2)
	const v = argv[i + 1]
	if (v === undefined || v.startsWith("--")) opt[k] = true
	else {
		opt[k] = v
		i++
	}
}
const list = (v) => (v === undefined || v === true ? null : String(v).split(",").map((s) => s.trim()).filter(Boolean))
if (opt.prompts) process.env.AI_PROMPTS_DIR = path.resolve(String(opt.prompts))
const RUN = String(opt.run ?? "main")
const RESULTS = path.join(HERE, "results", RUN)
const RENDERS = process.env.BENCH_RENDER_DIR ? path.join(process.env.BENCH_RENDER_DIR, RUN) : path.join(RESULTS, "renders")
const FORCE = !!opt.force

const { CONFIGS, configOf, runConfig, setConcurrency, inFlight, BASE_ROUTING } = await import("./lib/gateway.mjs")
const { judge } = await import("./lib/judge.mjs")
const { observeMetrics } = await import("./lib/observe-metrics.mjs")
const { createSimPool } = await import("./lib/sim-pool.mjs")
const score = await import("./score.mjs")
// --client <dir>: the browser-side pipeline (web/ai/solver.js, orchestrator.js) from <dir>/web/ai instead of this tree's (a frozen copy, so a
// server-side change is measured against the same client as its baseline while web/ai is being edited; <dir>/web/sim may link to web/sim)
const CLIENT = opt.client ? path.resolve(String(opt.client)) : ROOT
const { solve, planFromScene } = await import(pathToFileURL(path.join(CLIENT, "web/ai/solver.js")).href)
const ORCH = await import(pathToFileURL(path.join(CLIENT, "web/ai/orchestrator.js")).href)
const { getCatalog } = await import(pathToFileURL(path.join(ROOT, "ai/catalog-digest.mjs")).href)
const { runStep } = await import(pathToFileURL(path.join(ROOT, "ai/steps.mjs")).href)
const { fetchH1 } = await import(pathToFileURL(path.join(ROOT, "ai/research/fetch-h1.mjs")).href)
if (opt.concurrency) setConcurrency(Number(opt.concurrency))

const bench = score.loadBench()
const SPLIT = JSON.parse(fs.readFileSync(path.join(HERE, "cases/split.json"), "utf8"))
const splitOf = (id) => (SPLIT.train.includes(id) ? "train" : SPLIT.test.includes(id) ? "test" : "edit")

// ---------------------------------------------------------------- small helpers
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
const writeJson = (f, v) => {
	fs.mkdirSync(path.dirname(f), { recursive: true })
	const tmp = `${f}.${process.pid}.tmp`
	fs.writeFileSync(tmp, JSON.stringify(v, null, 1))
	fs.renameSync(tmp, f)
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"))
const resultFile = (phase, cfgId, caseId, run = RUN) => path.join(HERE, "results", run, phase, cfgId, `${caseId}.json`)
const t = () => new Date().toISOString().slice(11, 19)
const log = (...a) => console.log(`[${t()}]`, ...a)
const pct = (a, p) => {
	const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
	if (!s.length) return null
	const i = (s.length - 1) * p
	const lo = Math.floor(i)
	const hi = Math.ceil(i)
	return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const mean = (a) => {
	const s = a.filter((x) => Number.isFinite(x))
	return s.length ? s.reduce((p, q) => p + q, 0) / s.length : null
}

/** Cases of a kind, filtered by --cases / --split / --category / --limit / --core. */
function selectCases(kind) {
	let cs
	if (kind === "text") cs = bench.text.filter((c) => c.mode === "new").map((c) => ({ ...c, source: "text" }))
	else if (kind === "edit") cs = bench.text.filter((c) => c.mode === "edit").map((c) => ({ ...c, source: "text" }))
	else if (kind === "image") cs = bench.images.map((e) => ({ ...e, mode: "new", source: "image" }))
	const ids = list(opt.cases)
	if (ids) cs = cs.filter((c) => ids.includes(c.id))
	if (opt.split) cs = cs.filter((c) => splitOf(c.id) === opt.split)
	if (opt.category) cs = cs.filter((c) => (c.category ?? c.kind) === opt.category)
	if (kind === "image" && opt.core) cs = cs.filter((c) => c.kind !== "gt-render" || c.core)
	if (kind === "image" && opt.kind) cs = cs.filter((c) => c.kind === opt.kind)
	if (opt.limit) cs = cs.slice(0, Number(opt.limit))
	return cs
}

// ---------------------------------------------------------------- pictures: the bench's PNGs as the app sends them (JPEG, ≤ 1536 px, q 0.85)
const IMG_CACHE = path.join(HERE, ".cache", "img")
function caseImage(c) {
	const src = path.join(HERE, c.file)
	const out = path.join(IMG_CACHE, `${c.id}.jpg`)
	if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(src).mtimeMs) {
		fs.mkdirSync(IMG_CACHE, { recursive: true })
		execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", "1536", src, "--out", out], { stdio: "ignore" })
	}
	return `data:image/jpeg;base64,${fs.readFileSync(out).toString("base64")}`
}
/** What the user types with a picture (the cases themselves are pictures). */
const imageText = (c) =>
	c.kind === "gt-render" ? "Rebuild this scene exactly as it is in the picture." : c.kind === "sketch" ? "Build what this sketch shows, and make it work." : "Build this setup from the photo, and make it work the way it is meant to."
/** A picture case asked to "make it work" (photos and sketches): the outcomes it depicts count for pass (score.mjs opts.hardOutcomes). */
const makeItWork = (c) => c.source === "image" && c.kind !== "gt-render"
/** The scorer's options for a case: hard outcomes for "make it work" pictures, the ground-truth comparison's hard checks. */
const scoreOpts = (c, gt) => ({ simulate: false, hardOutcomes: makeItWork(c), ...(gt && !gt.error ? { gt } : {}) })

// ---------------------------------------------------------------- engine pool + renderer (started on demand)
let pool = null
const simPool = () => (pool ??= createSimPool({ size: Number(opt.sims ?? 8) }))
let rendererP = null
async function renderer() {
	if (opt["no-render"]) return null
	rendererP ??= (async () => {
		const { createRenderer } = await import("./lib/render.mjs")
		return createRenderer({ pages: Number(opt["render-pages"] ?? 3), log: (l) => log(`render: ${l}`) })
	})()
	return rendererP
}
async function shootAndSave(sim, scene, dir, name) {
	const r = await renderer()
	if (!r) return []
	try {
		const { shots } = await r.render(sim, scene)
		fs.mkdirSync(dir, { recursive: true })
		return shots.map((s) => {
			const file = path.join(dir, `${name}-${s.label}.jpg`)
			fs.writeFileSync(file, Buffer.from(s.dataUrl.slice(s.dataUrl.indexOf(",") + 1), "base64"))
			return { label: s.label, t: s.t, file: file.startsWith(HERE) ? path.relative(HERE, file) : file }
		})
	} catch (e) {
		log(`render failed for ${name}: ${e.message}`)
		return []
	}
}
const shotData = (shots) =>
	(shots ?? [])
		.map((s) => {
			const f = path.isAbsolute(s.file) ? s.file : path.join(HERE, s.file)
			return fs.existsSync(f) ? { ...s, dataUrl: `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}` } : null
		})
		.filter(Boolean)

// ---------------------------------------------------------------- evaluate a plan: solve -> run -> score (-> render)
function gtSceneOf(c) {
	return c.gt ? readJson(path.join(HERE, c.gt)) : null
}
const trimSummary = (s) => (s ? { goals: s.goals, events: (s.events ?? []).slice(0, 30), stories: (s.stories ?? []).slice(0, 40) } : null)
const solverIssues = (solved) => (solved?.issues ?? []).filter((i) => i.level !== "info" || ["moved", "kept_on", "lean_length", "lean_raised", "shifted", "table_widened"].includes(i.code))

async function evaluatePlan(c, plan, { renderDir, name, render = true, scene: givenScene = null, reply, suggestions } = {}) {
	const ev = { solve: null, scene: null, sim: null, score: null, gt: null, shots: [] }
	let scene = givenScene
	let solved = null
	if (!scene) {
		const t0 = Date.now()
		try {
			solved = solve(plan)
			scene = solved.scene
			ev.solve = { ok: solved.ok !== false, ms: Date.now() - t0, errors: (solved.errors ?? []).map((e) => e.text ?? String(e)), issues: solverIssues(solved).map((i) => `${i.code}: ${i.text}`) }
		} catch (e) {
			ev.solve = { ok: false, ms: Date.now() - t0, error: String(e?.message ?? e) }
		}
	}
	ev.scene = scene
	let sim = null
	if (scene) {
		try {
			sim = await simPool().simulate(scene)
			ev.sim = { ms: sim.ms, summary: trimSummary(sim.summary), warnings: sim.warnings }
		} catch (e) {
			ev.sim = { error: String(e?.message ?? e) }
		}
	}
	const gt = gtSceneOf(c)
	if (gt && scene) {
		try {
			ev.gt = score.scoreAgainstGT(gt, scene)
		} catch (e) {
			ev.gt = { error: e.message }
		}
	}
	ev.score = await score.scoreCase(c, { plan, scene, sim: sim ?? (ev.sim?.error ? { error: ev.sim.error } : null), reply, suggestions }, scoreOpts(c, ev.gt))
	if (render && sim && scene && renderDir) ev.shots = await shootAndSave(sim, scene, renderDir, name)
	return { ev, sim, solved }
}
const compactScore = (s) => (s ? { pass: s.pass, score: s.score, failed: s.failed, parts: s.parts, checks: s.checks, notes: s.notes } : null)
const callRecord = (r) => ({ ok: r.ok, model: r.model ?? null, servedModel: r.servedModel ?? null, ms: r.ms, wallMs: r.wallMs, usage: r.usage, repaired: !!r.repaired, attempts: (r.attempts ?? []).map((a) => ({ ok: a.ok, ms: a.ms, status: a.status, repair: a.repair, error: a.error?.slice?.(0, 300), note: a.note })), error: r.error ?? null, warnings: r.warnings?.slice?.(0, 20), prompt: r.prompt ?? null })

// ---------------------------------------------------------------- job runner
async function runJobs(jobs, fn, { parallel = Number(opt.jobs ?? 12) } = {}) {
	let i = 0
	let done = 0
	const total = jobs.length
	const t0 = Date.now()
	const worker = async () => {
		while (i < jobs.length) {
			const j = jobs[i++]
			try {
				await fn(j)
			} catch (e) {
				log(`job ${j.label ?? ""} crashed: ${e?.stack ?? e}`)
			}
			done++
			if (done % 5 === 0 || done === total) {
				const f = inFlight()
				log(`${done}/${total} done (${Math.round((Date.now() - t0) / 1000)} s; calls in flight ${f.active}, waiting ${f.waiting})`)
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker))
}
/** Jobs for configs × cases, slowest configs first and interleaved so the queue never ends on one slow model. */
function grid(configs, cases) {
	const slow = (c) => (/astra|argon|sol|xhigh/.test(c.id) ? 0 : /high|fable|sonnet/.test(c.id) ? 1 : 2)
	const cs = [...configs].sort((a, b) => slow(a) - slow(b))
	const out = []
	for (const c of cases) for (const k of cs) out.push({ cfg: k, c, label: `${k.id}/${c.id}` })
	out.sort((a, b) => slow(a.cfg) - slow(b.cfg))
	return out
}
const configsFor = (step) => {
	const ids = list(opt.configs)
	return ids ? ids.map((id) => configOf(step, id)) : CONFIGS[step].slice(0, 8)
}

// ================================================================ commands
async function cmdPlan() {
	const configs = configsFor("plan")
	const cases = [...selectCases("text"), ...(opt.images ? selectCases("image") : [])]
	const obsRef = opt.obs ? String(opt.obs) : null // <run>/<cfg> of observe results (image cases)
	log(`plan: ${configs.map((c) => c.id).join(", ")} × ${cases.length} cases (run ${RUN})`)
	await runJobs(grid(configs, cases), async ({ cfg, c }) => {
		const file = resultFile("plan", cfg.id, c.id)
		if (!FORCE && fs.existsSync(file)) return
		let payload
		let refs = []
		if (c.source === "image") {
			refs = [caseImage(c)]
			let observation = null
			if (obsRef) {
				const [orun, ocfg] = obsRef.split("/")
				const of = resultFile("observe", ocfg, c.id, orun)
				if (fs.existsSync(of)) observation = readJson(of).output ?? null
			}
			payload = { text: imageText(c), observation, images: refs }
		} else payload = { text: c.prompt }
		const call = await runConfig("plan", payload, cfg)
		const rec = { case: c.id, split: splitOf(c.id), phase: "plan", config: cfg, prompts: process.env.AI_PROMPTS_DIR ?? "ai/prompts", observation_from: obsRef, at: new Date().toISOString(), call: callRecord(call), output: call.ok ? call.result : null }
		if (call.ok) {
			const { ev } = await evaluatePlan(c, call.result, { renderDir: path.join(RENDERS, "plan", cfg.id), name: c.id })
			Object.assign(rec, { solve: ev.solve, scene: ev.scene, sim: ev.sim, score: compactScore(ev.score), gt: ev.gt, shots: ev.shots })
		} else rec.score = compactScore(await score.scoreCase(c, { error: call.error?.message }, { simulate: false }))
		writeJson(file, rec)
		log(`plan ${cfg.id} ${c.id}: ${call.ok ? `score ${rec.score?.score} ${rec.score?.pass ? "PASS" : `fail [${rec.score?.failed?.join(",")}]`}` : `ERROR ${call.error?.code}: ${call.error?.message?.slice(0, 160)}`} (${Math.round(call.ms / 1000)} s)`)
	})
}

async function cmdObserve() {
	const configs = configsFor("observe")
	const cases = selectCases("image")
	log(`observe: ${configs.map((c) => c.id).join(", ")} × ${cases.length} images (run ${RUN})`)
	await runJobs(grid(configs, cases), async ({ cfg, c }) => {
		const file = resultFile("observe", cfg.id, c.id)
		if (!FORCE && fs.existsSync(file)) return
		const call = await runConfig("observe", { text: imageText(c), images: [caseImage(c)] }, cfg)
		const rec = { case: c.id, split: splitOf(c.id), kind: c.kind, phase: "observe", config: cfg, prompts: process.env.AI_PROMPTS_DIR ?? "ai/prompts", at: new Date().toISOString(), call: callRecord(call), output: call.ok ? call.result : null }
		if (call.ok && c.kind === "gt-render") {
			const meta = readJson(path.join(HERE, c.meta))
			rec.metrics = observeMetrics(call.result, meta, c.file, gtSceneOf(c), score.loadCatalog())
		}
		writeJson(file, rec)
		log(`observe ${cfg.id} ${c.id}: ${call.ok ? (rec.metrics ? `recall ${rec.metrics.recall} iou ${rec.metrics.mean_best_iou} prec ${rec.metrics.precision} units ${rec.metrics.units.observed}/${rec.metrics.units.gt}` : "ok") : `ERROR ${call.error?.message?.slice(0, 160)}`} (${Math.round(call.ms / 1000)} s)`)
	})
}

/** observation (this run's observe results of --obs cfg) -> plan (--planner cfg) -> solve -> run -> score; stored under downstream/<obs cfg>. */
async function cmdDownstream() {
	const obsCfgs = list(opt.obs) ?? ["opus-medium"]
	const planner = configOf("plan", String(opt.planner ?? "opus-high"))
	const cases = selectCases("image")
	const jobs = []
	for (const c of cases) for (const o of obsCfgs) jobs.push({ c, o, label: `${o}/${c.id}` })
	log(`downstream: observations of ${obsCfgs.join(", ")} -> plan ${planner.id} × ${cases.length} images (run ${RUN})`)
	await runJobs(jobs, async ({ c, o }) => {
		const file = resultFile("downstream", o, c.id)
		if (!FORCE && fs.existsSync(file)) return
		const of = resultFile("observe", o, c.id, String(opt["obs-run"] ?? RUN))
		const obsRec = o === "none" ? { output: null, call: { ok: true, ms: 0 } } : fs.existsSync(of) ? readJson(of) : null
		if (!obsRec) return log(`downstream ${o} ${c.id}: no observation stored (run observe first)`)
		const refs = [caseImage(c)]
		const rec = { case: c.id, split: splitOf(c.id), kind: c.kind, phase: "downstream", config: { id: o, planner: planner.id }, at: new Date().toISOString(), observe_call: { ok: obsRec.call?.ok, ms: obsRec.call?.ms } }
		if (!obsRec.call?.ok) {
			rec.call = { ok: false, error: { code: "observe_failed", message: "the observation failed" }, ms: 0 }
			rec.score = compactScore(await score.scoreCase(c, { error: "observe failed" }, { simulate: false }))
			return writeJson(file, rec)
		}
		const call = await runConfig("plan", { text: imageText(c), observation: obsRec.output, images: refs }, planner)
		rec.call = callRecord(call)
		rec.output = call.ok ? call.result : null
		if (call.ok) {
			const { ev } = await evaluatePlan(c, call.result, { renderDir: path.join(RENDERS, "downstream", o), name: c.id })
			Object.assign(rec, { solve: ev.solve, scene: ev.scene, sim: ev.sim, score: compactScore(ev.score), gt: ev.gt, shots: ev.shots })
		} else rec.score = compactScore(await score.scoreCase(c, { error: call.error?.message }, { simulate: false }))
		writeJson(file, rec)
		log(`downstream ${o} ${c.id}: ${call.ok ? `score ${rec.score?.score} ${rec.score?.pass ? "PASS" : `fail [${rec.score?.failed?.join(",")}]`}${rec.gt ? ` typeF1 ${rec.gt.types?.f1} tau ${rec.gt.order?.kendall_tau}` : ""}` : `ERROR ${call.error?.message?.slice(0, 160)}`}`)
	})
}

/** One refine round on stored states. --from <run>/<phase>/<cfg> (default main/plan/opus-high); round 2: --after <refine cfg> uses that config's
 *  round-1 result as the state. */
async function cmdRefine() {
	const configs = configsFor("refine")
	const [frun, fphase, fcfg] = String(opt.from ?? "main/plan/opus-high").split("/")
	const round = Number(opt.round ?? 1)
	const after = opt.after ? String(opt.after) : null
	const all = [...selectCases("text"), ...selectCases("image")]
	const tag = round === 1 ? `r1-${fphase}-${fcfg}` : `r${round}-after-${after}`
	const jobs = []
	for (const c of all) {
		const src = round === 1 ? path.join(HERE, "results", frun, fphase, fcfg, `${c.id}.json`) : resultFile(`refine-r1-${fphase}-${fcfg}`, after, c.id)
		if (!fs.existsSync(src)) continue
		jobs.push(...configs.map((cfg) => ({ cfg, c, src, label: `${cfg.id}/${c.id}` })))
	}
	log(`refine round ${round}: ${configs.map((c) => c.id).join(", ")} × ${jobs.length / Math.max(1, configs.length)} states from ${opt.from ?? "main/plan/opus-high"} (run ${RUN})`)
	await runJobs(jobs, async ({ cfg, c, src }) => {
		const file = resultFile(`refine-${tag}`, cfg.id, c.id)
		if (!FORCE && fs.existsSync(file)) return
		const s0 = readJson(src)
		const before = round === 1 ? s0 : s0.after
		if (!before?.scene || !(before.plan ?? s0.output)) return
		const plan = round === 1 ? s0.output : before.plan
		const scene = before.scene
		// the state as the critic gets it in the app: the run, its warnings plus what the solver had to do, the renders, the reference
		let solved = null
		try {
			solved = solve(plan)
		} catch {}
		let sim
		try {
			sim = await simPool().simulate(scene)
		} catch (e) {
			return
		}
		const shots = shotData(before.shots ?? [])
		const refs = c.source === "image" ? [caseImage(c)] : []
		const payload = {
			text: c.source === "image" ? imageText(c) : c.prompt,
			round,
			rounds: 3,
			plan,
			scene,
			sim: { summary: sim.summary, warnings: [...(sim.warnings ?? []), ...solverIssues(solved).map((i) => ({ text: `placing: ${i.text}` }))].slice(0, 20) },
			renders: shots.map((s) => ({ data: s.dataUrl, label: `the solved scene, ${s.label === "close-up" ? "close-up at the end" : `at ${Number(s.t).toFixed(1)} s (${s.label})`}` })),
			images: refs
		}
		const call = await runConfig("refine", payload, cfg)
		const rec = { case: c.id, split: splitOf(c.id), phase: `refine-${tag}`, round, config: cfg, from: src.replace(HERE + "/", ""), at: new Date().toISOString(), call: callRecord(call), output: call.ok ? call.result : null, before: { score: compactScore(before.score), judge: before.judge ?? s0.judge ?? null, gt: before.gt ?? null } }
		if (call.ok) {
			const crit = call.result
			const patches = Array.isArray(crit.patches) ? crit.patches : []
			rec.done = !!crit.done
			rec.patches = patches.length
			if (!crit.done && patches.length) {
				const r = ORCH.applyPatches(plan, patches, scene)
				rec.changes = r.changes
				rec.skipped = r.skipped
				if (r.changes.length) {
					const { ev } = await evaluatePlan(c, r.plan, { renderDir: path.join(RENDERS, `refine-${tag}`, cfg.id), name: c.id })
					rec.after = { plan: r.plan, solve: ev.solve, scene: ev.scene, sim: ev.sim, score: compactScore(ev.score), gt: ev.gt, shots: ev.shots }
				}
			}
			if (!rec.after) rec.after = { plan, scene, score: compactScore(before.score), gt: before.gt ?? null, shots: before.shots ?? [], unchanged: true, sim: before.sim }
			rec.delta = rec.after.score && rec.before.score ? Math.round((rec.after.score.score - rec.before.score.score) * 10000) / 10000 : null
		}
		writeJson(file, rec)
		log(`refine ${cfg.id} ${c.id}: ${call.ok ? `done=${rec.done} patches ${rec.patches} score ${rec.before.score?.score} -> ${rec.after?.score?.score} (${rec.after?.score?.pass ? "PASS" : "fail"})` : `ERROR ${call.error?.message?.slice(0, 160)}`} (${Math.round(call.ms / 1000)} s)`)
	})
}

/** A base scene (+ its plan) for an edit case: scenario:/gt: (hand-made, no plan) or reference:<id> (a plan-built scene with its plan). */
function editBase(c) {
	const b = String(c.base_scene ?? "")
	if (b.startsWith("reference:")) {
		const r = readJson(path.join(HERE, "reference", `${b.slice(10)}.json`))
		return { scene: r.scene, plan: r.plan }
	}
	return { scene: score.baseSceneOf(c), plan: null }
}
const baseShots = new Map()
async function baseRender(c, scene) {
	const key = c.base_scene
	if (baseShots.has(key)) return baseShots.get(key)
	const p = (async () => {
		const sim = await simPool().simulate(scene)
		return shootAndSave(sim, scene, path.join(RENDERS, "edit-base"), String(key).replace(/[:/]/g, "_"))
	})()
	baseShots.set(key, p)
	return p
}

async function cmdEdit() {
	const configs = configsFor("edit")
	const cases = selectCases("edit")
	log(`edit: ${configs.map((c) => c.id).join(", ")} × ${cases.length} cases (run ${RUN})`)
	await runJobs(grid(configs, cases), async ({ cfg, c }) => {
		const file = resultFile("edit", cfg.id, c.id)
		if (!FORCE && fs.existsSync(file)) return
		const base = editBase(c)
		const bshots = await baseRender(c, base.scene)
		const call = await runConfig("edit", { text: c.prompt, scene: base.scene, plan: base.plan ?? undefined, history: c.history ?? [] }, cfg)
		const rec = { case: c.id, split: "edit", phase: "edit", config: cfg, at: new Date().toISOString(), call: callRecord(call), output: call.ok ? call.result : null, base_shots: bshots }
		if (call.ok) {
			const out = call.result
			rec.mode = out.mode
			rec.reply = out.reply
			let plan = null
			const basePlan = base.plan ? clone(base.plan) : planFromScene(base.scene)
			if (out.mode === "plan" && out.plan) plan = out.plan
			else if (Array.isArray(out.patches) && out.patches.length) {
				const r = ORCH.applyPatches(basePlan, out.patches, base.scene)
				plan = r.plan
				rec.changes = r.changes
				rec.skipped = r.skipped
				for (const k of ["missing"]) if (out[k] !== undefined) plan[k] = out[k]
			}
			if (plan) {
				const { ev } = await evaluatePlan(c, plan, { renderDir: path.join(RENDERS, "edit", cfg.id), name: c.id, reply: out.reply, suggestions: out.suggestions ?? out.plan?.suggestions })
				Object.assign(rec, { plan, solve: ev.solve, scene: ev.scene, sim: ev.sim, score: compactScore(ev.score), shots: ev.shots })
			} else {
				// a reply-only answer: nothing is rebuilt, the scene stays as it was (the missing list comes from the answer)
				const p = { ...basePlan, missing: out.missing ?? [] }
				const { ev } = await evaluatePlan(c, p, { renderDir: path.join(RENDERS, "edit", cfg.id), name: c.id, scene: clone(base.scene), reply: out.reply })
				Object.assign(rec, { plan: p, replyOnly: true, scene: ev.scene, sim: ev.sim, score: compactScore(ev.score), shots: ev.shots })
			}
			rec.replyCheck = c.expect?.reply_match ? new RegExp(c.expect.reply_match, "i").test(out.reply ?? "") : null
		} else rec.score = compactScore(await score.scoreCase(c, { error: call.error?.message }, { simulate: false }))
		writeJson(file, rec)
		log(`edit ${cfg.id} ${c.id}: ${call.ok ? `${rec.mode} score ${rec.score?.score} ${rec.score?.pass ? "PASS" : `fail [${rec.score?.failed?.join(",")}]`}` : `ERROR ${call.error?.message?.slice(0, 160)}`} (${Math.round(call.ms / 1000)} s)`)
	})
}

/** The whole pipeline as the app runs it (fallbacks included), with a routing file. */
async function cmdPipeline() {
	const routingPath = path.resolve(String(opt.routing ?? path.join(ROOT, "ai/models.json")))
	const routing = readJson(routingPath)
	const tag = String(opt.tag ?? path.basename(routingPath, ".json"))
	const cases = [...(opt["no-text"] ? [] : selectCases("text")), ...(opt.images ? selectCases("image") : []), ...(opt.edits ? selectCases("edit") : [])]
	// the app's api(): /api/ai/<step> through runStep with the routing file (one call in flight per slot of the cap)
	const sem = await import("./lib/gateway.mjs")
	// the chat reply and chips of each edit's own step answer (§13.9), by the request's text (edit prompts are unique per case)
	const chatOf = new Map()
	const api = async (p, body, signal) => {
		const step = p.replace("/api/ai/", "")
		const r = await sem.runConfigWithRouting(step, body.payload, routing, { signal })
		if (r.ok && step === "edit" && typeof body.payload?.text === "string") chatOf.set(body.payload.text, { reply: r.result?.reply ?? null, suggestions: r.result?.suggestions ?? r.result?.plan?.suggestions ?? null })
		if (!r.ok) return { ok: false, error: r.error?.message, code: r.error?.code, retryable: false }
		return { ok: true, result: r.result, model: r.model, ms: r.ms, usage: r.usage }
	}
	const shot = opt["no-render"]
		? null
		: {
				render: async (sim, { scene }) => {
					const r = await renderer()
					return r ? (await r.render(sim, scene)).shots : []
				}
		  }
	const orch = ORCH.createOrchestrator({ api, shot, simulate: (scene, signal) => simPool().simulate(scene, signal) })
	log(`pipeline (${tag}): ${cases.length} cases (run ${RUN})`)
	await runJobs(
		cases.map((c) => ({ c, label: c.id })),
		async ({ c }) => {
			const file = resultFile(`pipeline-${tag}`, "app", c.id)
			if (!FORCE && fs.existsSync(file)) return
			const t0 = Date.now()
			const req = { text: c.source === "image" ? imageText(c) : c.prompt }
			let base = null
			if (c.source === "image") req.images = [{ name: c.id, dataUrl: caseImage(c), width: 0, height: 0 }]
			if (c.mode === "edit") {
				base = editBase(c)
				Object.assign(req, { mode: "edit", scene: base.scene, plan: base.plan ?? undefined, planScene: base.plan ? base.scene : undefined, history: c.history ?? [] })
			}
			const rec = { case: c.id, split: splitOf(c.id), phase: `pipeline-${tag}`, routing: routingPath.replace(ROOT + "/", ""), client: CLIENT === ROOT ? "web/ai" : CLIENT, at: new Date().toISOString() }
			try {
				const job = orch.build(req, { onEvent: () => {} })
				const rep = await job.result
				rec.totalMs = Date.now() - t0
				rec.report = { title: rep.title, calls: rep.calls, timings: rep.timings, refine: rep.refine, tune: rep.tune, issues: rep.issues, replyOnly: rep.replyOnly ?? false, reply: rep.reply ?? rep.edit?.reply ?? null, score: rep.score ?? null, missing: rep.missing, goals: rep.goals ?? null }
				// the ground truth before the critic and the tuner (the first plan, solved): what refine did to the true sizes, counts and scale
				const gt0 = gtSceneOf(c)
				if (gt0 && rep.initialPlan) {
					try {
						rec.gt_initial = score.scoreAgainstGT(gt0, solve(rep.initialPlan).scene)
					} catch (e) {
						rec.gt_initial = { error: e.message }
					}
				}
				const plan = rep.plan ?? (base ? { ...(base.plan ? clone(base.plan) : planFromScene(base.scene)), missing: rep.missing ?? [] } : null)
				const scene = rep.scene ?? (base ? clone(base.scene) : null)
				const chat = c.mode === "edit" ? chatOf.get(req.text) : null
				const reply = rep.reply ?? rep.edit?.reply ?? chat?.reply ?? (c.mode === "edit" ? undefined : rep.plan?.reply ?? rep.initialPlan?.reply) ?? undefined
				const suggestions = chat?.suggestions ?? rep.plan?.suggestions ?? rep.initialPlan?.suggestions ?? undefined
				rec.chat = { reply: reply ?? null, suggestions: suggestions ?? null }
				const { ev } = await evaluatePlan(c, plan ?? { items: [], missing: rep.missing ?? [] }, { renderDir: path.join(RENDERS, `pipeline-${tag}`), name: c.id, scene, reply, suggestions })
				Object.assign(rec, { plan, scene: ev.scene, sim: ev.sim, score: compactScore(ev.score), gt: ev.gt, shots: ev.shots, call: { ok: true, ms: rec.totalMs } })
				if (base) rec.base_shots = await baseRender(c, base.scene)
			} catch (e) {
				rec.totalMs = Date.now() - t0
				rec.call = { ok: false, ms: rec.totalMs, error: { code: e?.kind ?? e?.code ?? "error", message: String(e?.message ?? e) } }
				rec.score = compactScore(await score.scoreCase(c, { error: rec.call.error.message }, { simulate: false }))
			}
			writeJson(file, rec)
			log(`pipeline ${c.id}: ${rec.call.ok ? `score ${rec.score?.score} ${rec.score?.pass ? "PASS" : `fail [${rec.score?.failed?.join(",")}]`} in ${Math.round(rec.totalMs / 1000)} s (refine ${rec.report?.refine?.length ?? 0} rounds, tune ${rec.report?.tune ? rec.report.tune.runs : "-"})` : `ERROR ${rec.call.error.message.slice(0, 200)}`}`)
		},
		{ parallel: Number(opt.jobs ?? 6) }
	)
}

/** The blinded judge over stored results of a phase. */
async function cmdJudge() {
	const phase = String(opt.phase ?? "plan")
	const judges = (list(opt.judges) ?? ["opus-high"]).map((id) => configOf("judge", id))
	const dir = path.join(HERE, "results", RUN, phase)
	if (!fs.existsSync(dir)) throw new Error(`no results in ${dir}`)
	const cfgIds = list(opt.configs) ?? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
	const ids = list(opt.cases)
	const jobs = []
	for (const cid of cfgIds)
		for (const f of fs.existsSync(path.join(dir, cid)) ? fs.readdirSync(path.join(dir, cid)).filter((x) => x.endsWith(".json")) : []) {
			const caseId = f.replace(/\.json$/, "")
			if (ids && !ids.includes(caseId)) continue
			if (opt.split && splitOf(caseId) !== opt.split) continue
			for (const j of judges) jobs.push({ file: path.join(dir, cid, f), caseId, j, label: `${j.id}:${cid}/${caseId}` })
		}
	// the slow judge's calls first
	jobs.sort((a, b) => (a.j.id < b.j.id ? 1 : -1))
	log(`judge ${phase}: ${judges.map((j) => j.id).join(", ")} on ${jobs.length / judges.length} results (run ${RUN})`)
	const locks = new Map()
	await runJobs(jobs, async ({ file, caseId, j }) => {
		const c = bench.cases.get(caseId)
		if (!c) return
		let rec = readJson(file)
		const target = phase.startsWith("refine") ? rec.after : rec
		if (!FORCE && rec.judge?.[j.id]) return
		let res
		if (phase.startsWith("refine") && target?.unchanged && rec.before?.judge?.[j.id]) res = { ...rec.before.judge[j.id], copied: "unchanged: the plan run's verdict" }
		else if (!target?.scene || rec.call?.ok === false) res = { score_0_10: 0, request_fidelity: 0, outcome: 0, physical_sense: 0, honesty: 0, reference_match: null, rubric_met: false, issues: ["nothing was built (the step failed)"], auto: true }
		else {
			const refs = c.source === "image" ? [caseImage(c)] : []
			let base = null
			if (c.mode === "edit") base = { scene: editBase(c).scene, shots: shotData(rec.base_shots ?? []) }
			const out = await judge(c, { scene: target.scene, plan: target.plan ?? rec.plan ?? rec.output, sim: target.sim, shots: shotData(target.shots ?? []), refs, base, reply: rec.chat?.reply ?? rec.reply ?? rec.report?.reply ?? null, suggestions: rec.chat?.suggestions ?? rec.output?.suggestions ?? null }, j, { text: c.source === "image" ? imageText(c) : c.prompt })
			res = out.ok ? { ...out.result, ms: out.ms, usage: out.usage, model: out.model } : { error: out.error, ms: out.ms }
		}
		// several judges may finish for one file at once: write under a per-file lock, re-reading first
		const prev = locks.get(file) ?? Promise.resolve()
		const next = prev.then(() => {
			rec = readJson(file)
			rec.judge = { ...(rec.judge ?? {}), [j.id]: res }
			writeJson(file, rec)
		})
		locks.set(file, next.catch(() => {}))
		await next
		log(`judge ${j.id} ${path.basename(path.dirname(file))}/${caseId}: ${res.error ? `ERROR ${res.error.message?.slice(0, 120)}` : `${res.score_0_10}${res.rubric_met ? " (rubric met)" : ""}`}`)
	})
}

// ---------------------------------------------------------------- report
function loadPhase(phase, run = RUN) {
	const dir = path.join(HERE, "results", run, phase)
	if (!fs.existsSync(dir)) return new Map()
	const out = new Map()
	for (const cid of fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory() && f !== "renders")) {
		const recs = fs.readdirSync(path.join(dir, cid)).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(dir, cid, f)))
		out.set(cid, recs)
	}
	return out
}
const tok = (u, k) => (u ? u[k] ?? null : null)
function summarize(recs, { phase }) {
	const n = recs.length
	const ok = recs.filter((r) => r.call?.ok)
	const target = (r) => (phase.startsWith("refine") ? r.after ?? r.before : r)
	const sc = recs.map((r) => target(r)?.score?.score ?? 0)
	const pass = recs.map((r) => (target(r)?.score?.pass ? 1 : 0))
	const ms = ok.map((r) => r.call.ms)
	const judges = {}
	for (const r of recs)
		for (const [k, v] of Object.entries(r.judge ?? {}))
			if (Number.isFinite(v?.score_0_10)) {
				judges[k] ??= { s: [], met: [] }
				judges[k].s.push(v.score_0_10)
				judges[k].met.push(v.rubric_met ? 1 : 0)
			}
	const out = {
		n,
		ok: ok.length,
		fail: n - ok.length,
		repaired: ok.filter((r) => r.call.repaired).length,
		score: mean(sc),
		pass: mean(pass),
		p50_s: pct(ms, 0.5) / 1000,
		p90_s: pct(ms, 0.9) / 1000,
		in_tok: mean(ok.map((r) => tok(r.call.usage, "prompt_tokens"))),
		out_tok: mean(ok.map((r) => tok(r.call.usage, "completion_tokens"))),
		cost_usd: mean(ok.map((r) => tok(r.call.usage, "costInUSD") ?? tok(r.call.usage, "cost"))),
		judge: Object.fromEntries(Object.entries(judges).map(([k, v]) => [k, { mean: mean(v.s), rubric: mean(v.met), n: v.s.length }])),
		errors: recs.filter((r) => !r.call?.ok).map((r) => `${r.case}: ${r.call?.error?.code ?? "?"} ${String(r.call?.error?.message ?? "").slice(0, 80)}`)
	}
	if (phase === "observe") {
		const m = recs.filter((r) => r.metrics).map((r) => r.metrics)
		Object.assign(out, { gt_n: m.length, recall: mean(m.map((x) => x.recall)), recall_iou50: mean(m.map((x) => x.recall_iou50)), miou: mean(m.map((x) => x.mean_best_iou)), precision: mean(m.map((x) => x.precision)), units_rel_err: mean(m.map((x) => x.units.rel_err)), groups_exact: mean(m.map((x) => x.groups_exact).filter((x) => x !== null)) })
	}
	const gts = recs.map((r) => target(r)?.gt).filter((g) => g && !g.error)
	if (gts.length) Object.assign(out, { gt_type_f1: mean(gts.map((g) => g.types?.f1)), gt_family_f1: mean(gts.map((g) => g.families?.f1)), gt_tau: mean(gts.map((g) => g.order?.kendall_tau)), gt_pos_rel: mean(gts.map((g) => g.position?.mean_rel)), gt_size_err: mean(gts.map((g) => g.size?.mean_rel_err)), gt_scale_dev: mean(gts.map((g) => g.hard?.scale_dev)), gt_hard_pass: mean(gts.map((g) => (g.hard ? (g.hard.ok ? 1 : 0) : null)).filter((x) => x !== null)) })
	// what refine (and the tuner) did to the ground-truth numbers: before = the plan as first made (refine phase: the state it judged)
	const gtPairs = recs.map((r) => [phase.startsWith("refine") ? r.before?.gt ?? null : r.gt_initial ?? null, target(r)?.gt]).filter(([a, b]) => a && b && !a.error && !b.error)
	if (gtPairs.length)
		Object.assign(out, {
			gt_n_before: gtPairs.length,
			gt_size_err_before: mean(gtPairs.map(([a]) => a.size?.mean_rel_err)),
			gt_size_err_after: mean(gtPairs.map(([, b]) => b.size?.mean_rel_err)),
			gt_scale_dev_before: mean(gtPairs.map(([a]) => a.hard?.scale_dev)),
			gt_scale_dev_after: mean(gtPairs.map(([, b]) => b.hard?.scale_dev)),
			gt_hard_pass_before: mean(gtPairs.map(([a]) => (a.hard?.ok ? 1 : 0))),
			gt_hard_pass_after: mean(gtPairs.map(([, b]) => (b.hard?.ok ? 1 : 0))),
			gt_worse_size: gtPairs.filter(([a, b]) => (b.size?.mean_rel_err ?? 0) > (a.size?.mean_rel_err ?? 0) + 0.02).length,
			gt_better_size: gtPairs.filter(([a, b]) => (b.size?.mean_rel_err ?? 0) < (a.size?.mean_rel_err ?? 0) - 0.02).length
		})
	if (phase.startsWith("refine")) {
		const d = recs.filter((r) => r.call?.ok)
		Object.assign(out, {
			delta: mean(d.map((r) => r.delta ?? 0)),
			improved: d.filter((r) => (r.delta ?? 0) > 0.005).length,
			worse: d.filter((r) => (r.delta ?? 0) < -0.005).length,
			done_rate: mean(d.map((r) => (r.done ? 1 : 0))),
			pass_before: mean(recs.map((r) => (r.before?.score?.pass ? 1 : 0))),
			score_before: mean(recs.map((r) => r.before?.score?.score ?? 0)),
			fixed: d.filter((r) => !r.before?.score?.pass && r.after?.score?.pass).length,
			broke: d.filter((r) => r.before?.score?.pass && !r.after?.score?.pass).length
		})
	}
	if (phase.startsWith("pipeline")) Object.assign(out, { p50_s: pct(recs.map((r) => r.totalMs), 0.5) / 1000, p90_s: pct(recs.map((r) => r.totalMs), 0.9) / 1000 })
	return out
}
const f = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : Number(v).toFixed(d))
async function cmdReport() {
	const dir = path.join(HERE, "results", RUN)
	const phases = list(opt.phase) ?? fs.readdirSync(dir).filter((p) => fs.statSync(path.join(dir, p)).isDirectory() && p !== "renders")
	const report = {}
	const md = []
	for (const phase of phases) {
		const data = loadPhase(phase)
		report[phase] = {}
		md.push(`\n### ${phase} (run ${RUN})\n`)
		const judgeIds = [...new Set([...data.values()].flat().flatMap((r) => Object.keys(r.judge ?? {})))].sort()
		md.push(`| config | n | ok | repaired | det. score | pass | ${judgeIds.map((j) => `judge ${j}`).join(" | ")}${judgeIds.length ? " |" : ""} p50 s | p90 s | in tok | out tok | $/call | extra |`)
		md.push(`|${"---|".repeat(11 + judgeIds.length)}`)
		for (const [cid, recs] of data) {
			const groups = { all: recs, ...(opt["by-split"] ? { train: recs.filter((r) => r.split === "train"), test: recs.filter((r) => r.split === "test") } : {}) }
			report[phase][cid] = {}
			for (const [g, rs] of Object.entries(groups)) {
				if (!rs.length) continue
				const s = summarize(rs, { phase })
				report[phase][cid][g] = s
				const gtDelta = s.gt_n_before ? ` · GT before→after (${s.gt_n_before}): size ${f(s.gt_size_err_before)}→${f(s.gt_size_err_after)} (worse ${s.gt_worse_size}, better ${s.gt_better_size}) · scale dev ${f(s.gt_scale_dev_before)}→${f(s.gt_scale_dev_after)} · GT hard ${f(s.gt_hard_pass_before)}→${f(s.gt_hard_pass_after)}` : ""
				const extra = (phase === "observe" ? `recall ${f(s.recall)} · R@.5 ${f(s.recall_iou50)} · mIoU ${f(s.miou)} · prec ${f(s.precision)} · units err ${f(s.units_rel_err)} · groups exact ${f(s.groups_exact)}` : phase.startsWith("refine") ? `Δ ${f(s.delta, 3)} · +${s.improved}/−${s.worse} · fixed ${s.fixed} broke ${s.broke} · done ${f(s.done_rate)}` : s.gt_type_f1 !== undefined ? `typeF1 ${f(s.gt_type_f1)} · famF1 ${f(s.gt_family_f1)} · τ ${f(s.gt_tau)} · pos ${f(s.gt_pos_rel)} · size ${f(s.gt_size_err)} · scale dev ${f(s.gt_scale_dev)} · GT hard ${f(s.gt_hard_pass)}` : "") + gtDelta
				md.push(`| ${cid}${g === "all" ? "" : ` (${g})`} | ${s.n} | ${s.ok} | ${s.repaired} | ${f(s.score, 3)} | ${f(s.pass)} | ${judgeIds.map((j) => (s.judge[j] ? `${f(s.judge[j].mean)} (${f(s.judge[j].rubric)})` : "–")).join(" | ")}${judgeIds.length ? " |" : ""} ${f(s.p50_s, 1)} | ${f(s.p90_s, 1)} | ${f(s.in_tok, 0)} | ${f(s.out_tok, 0)} | ${f(s.cost_usd, 3)} | ${extra} |`)
			}
		}
	}
	// the judges against each other: agreement (Spearman) and whether a judge favours its own family (mean of judge A − judge B on the
	// results each config family made)
	const pairs = []
	for (const phase of phases)
		for (const [cfg, recs] of loadPhase(phase))
			for (const r of recs) {
				const j = r.judge ?? {}
				const fam = /opus|sonnet|fable|haiku/.test(cfg) ? "claude" : /argon|flash/.test(cfg) ? "gemini" : /astra|sol/.test(cfg) ? "openai" : "other"
				pairs.push({ phase, cfg, fam, j: Object.fromEntries(Object.entries(j).filter(([, v]) => Number.isFinite(v?.score_0_10) && !v.auto).map(([k, v]) => [k, v.score_0_10])), det: r.score?.score ?? r.after?.score?.score })
			}
	const jids = [...new Set(pairs.flatMap((p) => Object.keys(p.j)))].sort()
	const rank = (a) => {
		const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
		const r = new Array(a.length)
		for (let i = 0; i < idx.length; ) {
			let k = i
			while (k + 1 < idx.length && idx[k + 1][0] === idx[i][0]) k++
			for (let m = i; m <= k; m++) r[idx[m][1]] = (i + k) / 2
			i = k + 1
		}
		return r
	}
	const spearman = (a, b) => {
		if (a.length < 3) return null
		const ra = rank(a)
		const rb = rank(b)
		const ma = mean(ra)
		const mb = mean(rb)
		let num = 0
		let da = 0
		let db = 0
		for (let i = 0; i < ra.length; i++) {
			num += (ra[i] - ma) * (rb[i] - mb)
			da += (ra[i] - ma) ** 2
			db += (rb[i] - mb) ** 2
		}
		return da && db ? num / Math.sqrt(da * db) : null
	}
	if (jids.length) {
		const lines = ["\n### judges\n", "| judge A | judge B | n | Spearman | mean A−B | A−B on Claude-made | A−B on Gemini-made | A−B on OpenAI-made |", "|---|---|---|---|---|---|---|---|"]
		for (let x = 0; x < jids.length; x++)
			for (let y = x + 1; y < jids.length; y++) {
				const both = pairs.filter((p) => p.j[jids[x]] !== undefined && p.j[jids[y]] !== undefined)
				const d = (ps) => mean(ps.map((p) => p.j[jids[x]] - p.j[jids[y]]))
				lines.push(`| ${jids[x]} | ${jids[y]} | ${both.length} | ${f(spearman(both.map((p) => p.j[jids[x]]), both.map((p) => p.j[jids[y]])))} | ${f(d(both))} | ${f(d(both.filter((p) => p.fam === "claude")))} | ${f(d(both.filter((p) => p.fam === "gemini")))} | ${f(d(both.filter((p) => p.fam === "openai")))} |`)
			}
		for (const id of jids) {
			const ps = pairs.filter((p) => p.j[id] !== undefined && Number.isFinite(p.det))
			lines.push(`\n${id} vs the deterministic score: Spearman ${f(spearman(ps.map((p) => p.j[id]), ps.map((p) => p.det)))} (n ${ps.length})`)
		}
		report.judges = lines.join("\n")
		md.push(...lines)
	}
	writeJson(path.join(dir, "report.json"), report)
	console.log(md.join("\n"))
	if (opt.detail) {
		// per case: each config's pass/score and what failed (for reading results, not for the tables)
		for (const phase of phases) {
			const data = loadPhase(phase)
			const cases = [...new Set([...data.values()].flat().map((r) => r.case))].sort()
			console.log(`\n#### ${phase}: per case\n`)
			for (const cid of cases) {
				const row = [...data.entries()].map(([cfg, recs]) => {
					const r = recs.find((x) => x.case === cid)
					if (!r) return null
					const T = phase.startsWith("refine") ? r.after ?? r.before : r
					const j = Object.entries(r.judge ?? {}).map(([k, v]) => `${k.split("-")[0]}${v.score_0_10 ?? "?"}`).join("/")
					return `${cfg}: ${!r.call?.ok ? "ERR" : T?.score?.pass ? "pass" : `FAIL[${(T?.score?.failed ?? []).join(",")}]`} ${f(T?.score?.score, 2)}${j ? ` j ${j}` : ""}`
				}).filter(Boolean)
				console.log(`- ${cid} (${splitOf(cid)}): ${row.join(" · ")}`)
			}
		}
	}
}

/** Recompute the direct observation metrics of stored observe results (after a change to lib/observe-metrics.mjs); no model calls. */
async function cmdRemetric() {
	const dir = path.join(HERE, "results", RUN, String(opt.phase ?? "observe"))
	let n = 0
	for (const cid of fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory()))
		for (const f of fs.readdirSync(path.join(dir, cid)).filter((x) => x.endsWith(".json"))) {
			const file = path.join(dir, cid, f)
			const rec = readJson(file)
			const c = bench.cases.get(rec.case)
			if (!rec.output || c?.kind !== "gt-render") continue
			rec.metrics = observeMetrics(rec.output, readJson(path.join(HERE, c.meta)), c.file, gtSceneOf(c), score.loadCatalog())
			writeJson(file, rec)
			n++
		}
	log(`remetric: ${n} observations rescored`)
}

/** Re-score stored results with the current case file and scorer (after a case or scorer fix): re-runs the engine on the stored scenes, no
 *  model calls. --phase p (default: every phase of the run). */
async function cmdRescore() {
	const dir = path.join(HERE, "results", RUN)
	const phases = list(opt.phase) ?? fs.readdirSync(dir).filter((p) => fs.statSync(path.join(dir, p)).isDirectory() && p !== "renders")
	let n = 0
	for (const phase of phases)
		for (const cid of fs.readdirSync(path.join(dir, phase)).filter((f) => fs.statSync(path.join(dir, phase, f)).isDirectory())) {
			const files = fs.readdirSync(path.join(dir, phase, cid)).filter((x) => x.endsWith(".json"))
			await runJobs(files.map((f) => ({ f, label: f })), async ({ f }) => {
				const file = path.join(dir, phase, cid, f)
				const rec = readJson(file)
				const c = bench.cases.get(rec.case)
				if (!c) return
				const T = phase.startsWith("refine") ? rec.after : rec
				if (!T?.scene) return
				const plan = T.plan ?? rec.output ?? null
				let sim = null
				try {
					sim = await simPool().simulate(T.scene)
				} catch (e) {
					sim = { error: String(e?.message ?? e) }
				}
				const gt = gtSceneOf(c)
				if (gt) {
					try {
						T.gt = score.scoreAgainstGT(gt, T.scene)
					} catch (e) {
						T.gt = { error: e.message }
					}
				}
				T.score = compactScore(await score.scoreCase(c, { plan, scene: T.scene, sim, reply: rec.chat?.reply ?? rec.reply ?? rec.report?.reply ?? undefined, suggestions: rec.chat?.suggestions ?? undefined }, scoreOpts(c, T.gt)))
				if (phase.startsWith("refine") && rec.before?.score) rec.delta = Math.round((rec.after.score.score - rec.before.score.score) * 10000) / 10000
				writeJson(file, rec)
				n++
			}, { parallel: 8 })
		}
	log(`rescore: ${n} results re-scored`)
}

// ================================================================ main
const COMMANDS = { remetric: cmdRemetric, rescore: cmdRescore, plan: cmdPlan, observe: cmdObserve, downstream: cmdDownstream, refine: cmdRefine, edit: cmdEdit, pipeline: cmdPipeline, judge: cmdJudge, report: cmdReport }
if (!COMMANDS[cmd]) {
	const lines = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1)
	console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n"))
	process.exit(cmd ? 2 : 0)
}
if (!["report", "remetric", "rescore"].includes(cmd) && !process.env.TRUEFOUNDRY_API_KEY) {
	console.error("TRUEFOUNDRY_API_KEY is not set: run it as zsh -c 'source ~/.config/truefoundry/env && node ai/bench/run.mjs ...'")
	process.exit(2)
}
await getCatalog()
try {
	await COMMANDS[cmd]()
} finally {
	pool?.close()
	if (rendererP) await (await rendererP)?.close()
}
process.exit(0)
