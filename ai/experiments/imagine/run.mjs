#!/usr/bin/env node
// EXPERIMENT imagine-first: for a NEW scene from text only, first generate a concept image of the described setup (gateway image models),
// then observe it and plan from the words + the observation; measured against the text-only pipeline on the bench's 25 text cases + the
// 15 new realistic prompts in cases-new.json. Nothing here edits the app: it imports the app's modules read-only (ai/steps.mjs through the
// bench's gateway lib, the frozen browser client in ./client/web/ai, web/sim, the bench's scorer, judge, renderer and engine pool) and
// writes only under ./results/<run>/ (renders and full-size PNGs go to the scratchpad).
//
//   zsh -c 'source ~/.config/truefoundry/env && node ai/experiments/imagine/run.mjs <command> [options]'
//
// Commands
//   prepass   the cheap cast pre-pass (request vs the catalog brief) per case
//   concepts  --models sunburst,flare,gemini --templates naive,photo,photo_arrows,render_labels [--n 1] [--quality high]
//   phase1    concepts -> [check, observe] -> plan alone for every model × template, plus text plans (one process: one cap)
//   check     --check-model opus-low   the cheap vision check of each concept (buildability)
//   observe   the app's observe step (models.json routing) on each concept
//   plan      --arms text,img:<model>:<template>,imgobs:...,imgnoobs:... [--samples 1]   plan step alone -> solve -> run -> score
//   pipeline  --arms T,IFplan,IFfull,IFbest3 --samples 1 [--concept-model sunburst --concept-template photo --nconcepts 3 --check-model opus-low]
//             the whole app pipeline (frozen web/ai orchestrator: observe -> plan -> solve -> run -> render -> refine <= 3 -> tune), with
//             the imagine stage in front for the IF arms (pre-pass -> concepts in parallel -> [vision check, pick best])
//   judge     --phase pipeline --judges opus-high,astra-high   blinded judges (they never see the concept image)
//   report    tables (markdown) + results/<run>/report.json
// Options: --run <name> (default "main") · --set phase1|all|text25|new15 · --cases a,b · --force · --jobs n
// Gateway politeness: at most 4 model calls in flight in this process (lib/sem.mjs), image calls included; 429s back off.
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../..")
const SCRATCH = process.env.IMAGINE_SCRATCH || "/private/tmp/claude-501/-Users-ramsarma-Downloads-science-map-share/cb014d17-1cd6-4220-a508-cf6ce5539a35/scratchpad/imagine"
// the prompts as they were when the experiment started (other agents are editing ai/prompts): every arm reads the same ones
process.env.AI_PROMPTS_DIR = path.join(HERE, "prompts-frozen")

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
const RUN = String(opt.run ?? "main")
const RES = path.join(HERE, "results", RUN)
const SCR = path.join(SCRATCH, RUN)
const FORCE = !!opt.force

const gw = await import(pathToFileURL(path.join(ROOT, "ai/bench/lib/gateway.mjs")).href)
gw.setConcurrency(4)
const { judge } = await import(pathToFileURL(path.join(ROOT, "ai/bench/lib/judge.mjs")).href)
const { createSimPool } = await import(pathToFileURL(path.join(ROOT, "ai/bench/lib/sim-pool.mjs")).href)
const score = await import(pathToFileURL(path.join(ROOT, "ai/bench/score.mjs")).href)
const { solve } = await import(pathToFileURL(path.join(HERE, "client/web/ai/solver.js")).href)
const ORCH = await import(pathToFileURL(path.join(HERE, "client/web/ai/orchestrator.js")).href)
const { getCatalog } = await import(pathToFileURL(path.join(ROOT, "ai/catalog-digest.mjs")).href)
const { gated, gateStats } = await import("./lib/sem.mjs")
const { generateImage, IMAGE_MODELS } = await import("./lib/image.mjs")
const { castFor } = await import("./lib/cast.mjs")
const { imagePrompt } = await import("./lib/prompts.mjs")
const { checkConcept, checkSummary } = await import("./lib/check.mjs")
const { castMatch } = await import("./lib/metrics.mjs")

// the shipped routing, read once (frozen for the whole run)
const ROUTING = JSON.parse(fs.readFileSync(path.join(ROOT, "ai/models.json"), "utf8"))

// ---------------------------------------------------------------- cases
const bench = score.loadBench()
const NEW = JSON.parse(fs.readFileSync(path.join(HERE, "cases-new.json"), "utf8")).cases
const ALL = [...bench.text.filter((c) => c.mode === "new"), ...NEW].map((c) => ({ ...c, source: "text", set: c.id.startsWith("n") && /^n\d\d-/.test(c.id) ? "new15" : "text25" }))
const CASES = new Map(ALL.map((c) => [c.id, c]))
export const PHASE1 = ["s1-ball-ramp", "c1-rube-cup", "c2-marble-zigzag", "e1-phone-board-pillow", "m2-seesaw-catapult", "m5-trampoline-bucket", "i1-cat-water", "g2-chain-reaction", "n10-desk-four-stage", "n12-five-stage-seesaw"]
function selectCases() {
	let cs = ALL
	const set = String(opt.set ?? "all")
	if (set === "phase1") cs = cs.filter((c) => PHASE1.includes(c.id))
	else if (set === "text25" || set === "new15") cs = cs.filter((c) => c.set === set)
	const ids = list(opt.cases)
	if (ids) cs = cs.filter((c) => ids.includes(c.id))
	if (opt.limit) cs = cs.slice(0, Number(opt.limit))
	return cs
}
/** How many stages a case has (new cases say; bench cases: chains 4+, mechanisms 2, the rest 1). */
const stagesOf = (c) => c.stages ?? (c.category === "chain" ? 4 : c.category === "vague" ? 3 : c.category === "mechanisms" ? 2 : 1)

// ---------------------------------------------------------------- helpers
const writeJson = (f, v) => {
	fs.mkdirSync(path.dirname(f), { recursive: true })
	const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
	fs.writeFileSync(tmp, JSON.stringify(v, null, 1))
	fs.renameSync(tmp, f)
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"))
const exists = (f) => fs.existsSync(f)
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
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
async function runJobs(jobs, fn, parallel = Number(opt.jobs ?? 6)) {
	let i = 0
	let done = 0
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
			if (done % 5 === 0 || done === jobs.length) log(`${done}/${jobs.length} done (${Math.round((Date.now() - t0) / 1000)} s; gate ${JSON.stringify(gateStats())})`)
		}
	}
	await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker))
}

/** The words sent with a concept image (observe, plan, and the critic when it sees the image): the picture is the app's own suggestion. */
export const CONCEPT_NOTE =
	"(The attached picture is a concept image the app generated from these words to suggest a buildable layout; it is not the user's own picture. The words are the request: where the picture differs from them or would not work in the physics, follow the words and make it work, so every outcome they state really happens.)"
const conceptText = (c) => `${c.prompt}\n\n${CONCEPT_NOTE}`
const conceptName = "concept image generated by the app from the request"

/** A JPEG as the app sends pictures (≤ 1536 px, q 0.85) from the model's PNG; -> {jpgFile, dataUrl} */
function toJpeg(b64, pngFile, jpgFile) {
	fs.mkdirSync(path.dirname(pngFile), { recursive: true })
	fs.mkdirSync(path.dirname(jpgFile), { recursive: true })
	fs.writeFileSync(pngFile, Buffer.from(b64, "base64"))
	execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", "1536", pngFile, "--out", jpgFile], { stdio: "ignore" })
	return `data:image/jpeg;base64,${fs.readFileSync(jpgFile).toString("base64")}`
}
const dataUrlOf = (jpg) => `data:image/jpeg;base64,${fs.readFileSync(jpg).toString("base64")}`

// estimated $ for an image call (the gateway's image answers carry tokens, not a price): OpenAI image models at gpt-image-1 list prices
// ($5 / 1M text-in, $40 / 1M image-out tokens), Gemini 3 Pro Image at $120 / 1M output tokens (≈ $0.13-0.16 an image).
export function imageCost(model, usage) {
	if (!usage) return null
	if (/gemini/.test(model)) return ((usage.output_tokens ?? 0) * 120 + (usage.input_tokens ?? 0) * 2) / 1e6
	return ((usage.output_tokens_details?.image_tokens ?? usage.output_tokens ?? 0) * 40 + (usage.input_tokens ?? 0) * 5) / 1e6
}
const costOf = (u) => (u ? u.costInUSD ?? u.cost ?? null : null)

// ---------------------------------------------------------------- engine pool + renderer
let pool = null
const simPool = () => (pool ??= createSimPool({ size: Number(opt.sims ?? 8) }))
let rendererP = null
async function renderer() {
	if (opt["no-render"]) return null
	rendererP ??= (async () => {
		const { createRenderer } = await import(pathToFileURL(path.join(ROOT, "ai/bench/lib/render.mjs")).href)
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
			return { label: s.label, t: s.t, file }
		})
	} catch (e) {
		log(`render failed for ${name}: ${e.message}`)
		return []
	}
}
const shotData = (shots) => (shots ?? []).filter((s) => fs.existsSync(s.file)).map((s) => ({ ...s, dataUrl: `data:image/jpeg;base64,${fs.readFileSync(s.file).toString("base64")}` }))
const trimSummary = (s) => (s ? { goals: s.goals, events: (s.events ?? []).slice(0, 30), stories: (s.stories ?? []).slice(0, 40) } : null)
const compactScore = (s) => (s ? { pass: s.pass, score: s.score, failed: s.failed, parts: s.parts, checks: s.checks, notes: s.notes } : null)

/** plan -> solve (frozen client) -> run -> score (-> render) */
async function evaluate(c, plan, { scene: given = null, renderDir = null, name } = {}) {
	const ev = { solve: null, scene: null, sim: null, score: null, shots: [] }
	let scene = given
	if (!scene) {
		try {
			const s = solve(plan)
			scene = s.scene
			ev.solve = { ok: s.ok !== false, errors: (s.errors ?? []).map((e) => e.text ?? String(e)).slice(0, 10) }
		} catch (e) {
			ev.solve = { ok: false, error: String(e?.message ?? e) }
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
	ev.score = compactScore(await score.scoreCase(c, { plan, scene, sim: sim ?? (ev.sim?.error ? { error: ev.sim.error } : null) }, { simulate: false }))
	if (renderDir && sim && scene) ev.shots = await shootAndSave(sim, scene, renderDir, name)
	return ev
}

/** One app step with the shipped routing, under the experiment's cap. Never throws. */
async function step(name, payload, track = null, signal) {
	return gated(() => gw.runConfigWithRouting(name, payload, ROUTING, { signal }), track)
}

// ---------------------------------------------------------------- the imagine stage: pre-pass -> concepts (parallel) -> check -> pick
const prepassFile = (cid, run = RUN) => path.join(HERE, "results", run, "prepass", `${cid}.json`)
const prepassMemo = new Map()
/** The case's pre-pass, made once per file (concurrent askers share the one call). */
function getPrepass(c, o = {}) {
	const file = o.file ?? prepassFile(c.id)
	if (!prepassMemo.has(file)) prepassMemo.set(file, makePrepass(c, { ...o, file }))
	return prepassMemo.get(file)
}
async function makePrepass(c, { file, track } = {}) {
	if (!FORCE && exists(file)) return readJson(file)
	const r = await castFor(c.prompt, { model: String(opt["cast-model"] ?? "opus-low") })
	const rec = { case: c.id, request: c.prompt, ok: r.ok, result: r.ok ? r.result : null, ms: r.ms, usage: r.usage, model: r.model, error: r.ok ? null : r.error, at: new Date().toISOString() }
	if (track) track.prepassMs = r.ms
	writeJson(file, rec)
	return rec
}
const conceptId = (cid, model, template, k) => `${cid}__${model}__${template}__${k}`
async function makeConcept(c, pre, model, template, k, { dir, quality = String(opt.quality ?? "high"), size = "1536x1024" } = {}) {
	const id = conceptId(c.id, model, template, k)
	const file = path.join(dir, `${id}.json`)
	if (!FORCE && exists(file)) return readJson(file)
	const prompt = await imagePrompt(template, c.prompt, pre.result)
	const r = await generateImage({ model: IMAGE_MODELS[model], prompt, quality, size })
	const rec = { id, case: c.id, model, route: IMAGE_MODELS[model], template, k, quality, prompt, ok: r.ok, ms: r.ms, wallMs: r.wallMs, usage: r.usage ?? null, cost_est: imageCost(IMAGE_MODELS[model], r.usage), error: r.ok ? null : r.error, attempts: r.attempts, at: new Date().toISOString() }
	if (r.ok) {
		const jpg = path.join(dir, `${id}.jpg`)
		toJpeg(r.b64, path.join(SCR, "png", `${id}.${r.mime === "image/jpeg" ? "jpg" : "png"}`), jpg)
		rec.jpg = path.relative(HERE, jpg)
		rec.bytes = fs.statSync(jpg).size
	}
	writeJson(file, rec)
	log(`concept ${id}: ${r.ok ? `${Math.round(r.ms / 1000)} s` : `ERROR ${r.error}`}`)
	return rec
}
const conceptData = (rec) => dataUrlOf(path.join(HERE, rec.jpg))

// ================================================================ commands
async function cmdPrepass() {
	const cases = selectCases()
	await runJobs(cases.map((c) => ({ c, label: c.id })), async ({ c }) => {
		const r = await getPrepass(c)
		log(`prepass ${c.id}: ${r.ok ? `${r.result.cast.length} types, ${Math.round(r.ms / 1000)} s` : `ERROR ${r.error?.message}`}`)
	}, 4)
}

async function cmdConcepts() {
	const cases = selectCases()
	const models = list(opt.models) ?? ["sunburst", "flare", "gemini"]
	const templates = list(opt.templates) ?? ["naive", "photo", "photo_arrows", "render_labels"]
	const n = Number(opt.n ?? 1)
	const dir = path.join(RES, "concepts")
	const jobs = []
	for (const c of cases) for (const m of models) for (const tp of templates) for (let k = 0; k < n; k++) jobs.push({ c, m, tp, k, label: conceptId(c.id, m, tp, k) })
	log(`concepts: ${jobs.length} images (${cases.length} cases × ${models.join(",")} × ${templates.join(",")} × ${n})`)
	await runJobs(jobs, async ({ c, m, tp, k }) => {
		const pre = await getPrepass(c)
		if (!pre.ok) return log(`no prepass for ${c.id}`)
		await makeConcept(c, pre, m, tp, k, { dir })
	}, 8)
}

function conceptRecords(filter = {}) {
	const dir = path.join(RES, "concepts")
	if (!exists(dir)) return []
	const ids = new Set(selectCases().map((c) => c.id))
	return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(dir, f))).filter((r) => r.ok && ids.has(r.case) && (!filter.models || filter.models.includes(r.model)) && (!filter.templates || filter.templates.includes(r.template)))
}

async function cmdCheck() {
	const cm = String(opt["check-model"] ?? "opus-low")
	const recs = conceptRecords({ models: list(opt.models), templates: list(opt.templates) })
	log(`check (${cm}): ${recs.length} concepts`)
	await runJobs(recs.map((r) => ({ r, label: r.id })), async ({ r }) => {
		const file = path.join(RES, "check", cm, `${r.id}.json`)
		if (!FORCE && exists(file)) return
		const c = CASES.get(r.case)
		const pre = await getPrepass(c)
		const out = await checkConcept({ dataUrl: conceptData(r), request: c.prompt, prepass: pre.result, model: cm })
		const rec = { id: r.id, case: r.case, model: r.model, template: r.template, checker: cm, ok: out.ok, result: out.ok ? out.result : null, summary: out.ok ? checkSummary(out.result, pre.result) : null, ms: out.ms, usage: out.usage, error: out.ok ? null : out.error }
		writeJson(file, rec)
		log(`check ${r.id}: ${out.ok ? `score ${out.result.score_0_10} side ${out.result.side_view} extras ${out.result.extras?.length}` : `ERROR ${out.error?.message}`} (${Math.round(out.ms / 1000)} s)`)
	}, 8)
}

async function observeConcept(rec, c, dir) {
	const file = path.join(dir, `${rec.id}.json`)
	if (!FORCE && exists(file)) return readJson(file)
	const out = await step("observe", { text: conceptText(c), images: [{ data: conceptData(rec), label: conceptName }] })
	const pre = await getPrepass(c)
	const o = { id: rec.id, case: rec.case, model: rec.model, template: rec.template, ok: out.ok, observation: out.ok ? out.result : null, ms: out.ms, usage: out.usage, repaired: out.repaired, error: out.ok ? null : out.error, metrics: out.ok ? castMatch(out.result, pre.result) : null }
	writeJson(file, o)
	log(`observe ${rec.id}: ${out.ok ? `${out.result.objects?.length} objects, cast recall ${o.metrics?.recall?.toFixed(2)}, ${Math.round(out.ms / 1000)} s` : `ERROR ${out.error?.message}`}`)
	return o
}
async function cmdObserve() {
	const recs = conceptRecords({ models: list(opt.models), templates: list(opt.templates) }).filter((r) => r.k === 0 || opt["all-k"])
	log(`observe: ${recs.length} concepts`)
	await runJobs(recs.map((r) => ({ r, label: r.id })), async ({ r }) => observeConcept(r, CASES.get(r.case), path.join(RES, "observe")), 8)
}

/** plan step alone, per arm: text | img:<model>:<template> (words + observation + picture) | imgobs: (no picture) | imgnoobs: (no observation) */
async function cmdPlan() {
	const arms = list(opt.arms) ?? ["text"]
	const samples = Number(opt.samples ?? 1)
	const cases = selectCases()
	const jobs = []
	for (const c of cases) for (const a of arms) for (let s = 0; s < samples; s++) jobs.push({ c, a, s, label: `${a}/${c.id}/${s}` })
	log(`plan: ${arms.join(", ")} × ${cases.length} cases × ${samples}`)
	await runJobs(jobs, async ({ c, a, s }) => {
		const file = path.join(RES, "plan", a.replace(/:/g, "_"), `${c.id}__s${s}.json`)
		if (!FORCE && exists(file)) return
		let payload
		let obsMs = 0
		let conceptMs = 0
		if (a === "text") payload = { text: c.prompt }
		else {
			const [kind, model, template] = a.split(":")
			const cf = path.join(RES, "concepts", `${conceptId(c.id, model, template, 0)}.json`)
			if (!exists(cf)) return log(`plan ${a} ${c.id}: no concept`)
			const rec = readJson(cf)
			if (!rec.ok) return log(`plan ${a} ${c.id}: concept failed`)
			conceptMs = rec.ms
			const img = { data: conceptData(rec), label: conceptName }
			let observation = null
			if (kind !== "imgnoobs") {
				const o = await observeConcept(rec, c, path.join(RES, "observe"))
				if (!o.ok) return log(`plan ${a} ${c.id}: observe failed`)
				observation = o.observation
				obsMs = o.ms
			}
			payload = { text: conceptText(c), ...(observation ? { observation } : {}), ...(kind === "imgobs" ? {} : { images: [img] }) }
		}
		const out = await step("plan", payload)
		const rec = { case: c.id, set: c.set, arm: a, sample: s, ok: out.ok, ms: out.ms, obsMs, conceptMs, usage: out.usage, repaired: out.repaired, error: out.ok ? null : out.error, output: out.ok ? out.result : null, at: new Date().toISOString() }
		if (out.ok) Object.assign(rec, await evaluate(c, out.result))
		else rec.score = compactScore(await score.scoreCase(c, { error: out.error?.message }, { simulate: false }))
		writeJson(file, rec)
		log(`plan ${a} ${c.id} s${s}: ${out.ok ? `det ${rec.score?.score?.toFixed(3)} ${rec.score?.pass ? "PASS" : `fail [${rec.score?.failed?.join(",")}]`}` : `ERROR ${out.error?.message?.slice(0, 120)}`} (${Math.round(out.ms / 1000)} s)`)
	}, Number(opt.jobs ?? 8))
}

/** Phase 1 in one process (the cap is per process): per (case, model, template) concept -> [check, observe] -> plan alone; plus the text
 *  arm's plans (--text-samples, default 3), all interleaved so the 4 slots stay busy. */
async function cmdPhase1() {
	const cases = selectCases()
	const models = list(opt.models) ?? ["sunburst", "flare", "gemini"]
	const templates = list(opt.templates) ?? ["naive", "photo", "photo_arrows", "render_labels"]
	const cm = String(opt["check-model"] ?? "opus-low")
	const textSamples = Number(opt["text-samples"] ?? 3)
	const dir = path.join(RES, "concepts")
	const jobs = []
	for (const c of cases) for (let s = 0; s < textSamples; s++) jobs.push({ kind: "text", c, s, label: `text/${c.id}/${s}` })
	for (const tp of templates) for (const m of models) for (const c of cases) jobs.push({ kind: "img", c, m, tp, label: conceptId(c.id, m, tp, 0) })
	// interleave so text plans and images overlap
	jobs.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "img" ? -1 : 1))
	log(`phase 1: ${cases.length} cases, ${models.length} models × ${templates.length} templates, text × ${textSamples}`)
	const planOne = async (c, arm, s, payload, extra = {}) => {
		const file = path.join(RES, "plan", arm.replace(/:/g, "_"), `${c.id}__s${s}.json`)
		if (!FORCE && exists(file)) return
		const out = await step("plan", payload)
		const rec = { case: c.id, set: c.set, arm, sample: s, ok: out.ok, ms: out.ms, usage: out.usage, repaired: out.repaired, error: out.ok ? null : out.error, output: out.ok ? out.result : null, at: new Date().toISOString(), ...extra }
		if (out.ok) Object.assign(rec, await evaluate(c, out.result))
		else rec.score = compactScore(await score.scoreCase(c, { error: out.error?.message }, { simulate: false }))
		writeJson(file, rec)
		log(`plan ${arm} ${c.id} s${s}: ${out.ok ? `det ${rec.score?.score?.toFixed(3)} ${rec.score?.pass ? "PASS" : `fail [${rec.score?.failed?.join(",")}]`}` : `ERROR ${out.error?.message?.slice(0, 120)}`} (${Math.round(out.ms / 1000)} s)`)
	}
	await runJobs(jobs, async (j) => {
		const { c } = j
		if (j.kind === "text") return planOne(c, "text", j.s, { text: c.prompt })
		const pre = await getPrepass(c)
		if (!pre.ok) return log(`no prepass for ${c.id}`)
		const rec = await makeConcept(c, pre, j.m, j.tp, 0, { dir })
		if (!rec.ok) return
		const checkFile = path.join(RES, "check", cm, `${rec.id}.json`)
		const doCheck = async () => {
			if (!FORCE && exists(checkFile)) return
			const out = await checkConcept({ dataUrl: conceptData(rec), request: c.prompt, prepass: pre.result, model: cm })
			writeJson(checkFile, { id: rec.id, case: rec.case, model: rec.model, template: rec.template, checker: cm, ok: out.ok, result: out.ok ? out.result : null, summary: out.ok ? checkSummary(out.result, pre.result) : null, ms: out.ms, usage: out.usage, error: out.ok ? null : out.error })
		}
		const [, o] = await Promise.all([doCheck(), observeConcept(rec, c, path.join(RES, "observe"))])
		if (!o?.ok) return
		// --plan-configs model:template,... (default: all): the plan step (the slow part) only for these concept variants
		const pc = list(opt["plan-configs"])
		if (pc && !pc.includes(`${j.m}:${j.tp}`) && !pc.includes(`${j.m}:*`) && !pc.includes(`*:${j.tp}`)) return
		await planOne(c, `img:${j.m}:${j.tp}`, 0, { text: conceptText(c), observation: o.observation, images: [{ data: conceptData(rec), label: conceptName }] }, { obsMs: o.ms, conceptMs: rec.ms })
	}, Number(opt.jobs ?? 10))
}

// ---------------------------------------------------------------- the pipeline (A/B)
const imagineMemo = new Map()
/** The imagine stage of (case, sample), shared by the IF arms: pre-pass, nconcepts concepts in parallel, the vision check of each. */
function imagine(c, s) {
	const key = `${c.id}#${s}`
	if (imagineMemo.has(key)) return imagineMemo.get(key)
	const p = (async () => {
		const dir = path.join(RES, "imagine", `${c.id}__s${s}`)
		const file = path.join(dir, "imagine.json")
		if (!FORCE && exists(file)) return readJson(file)
		const model = String(opt["concept-model"] ?? "sunburst")
		const template = String(opt["concept-template"] ?? "photo")
		const n = Number(opt.nconcepts ?? 3)
		const cm = String(opt["check-model"] ?? "opus-low")
		const pre = await getPrepass(c, { file: path.join(dir, "prepass.json") })
		if (!pre.ok) return { ok: false, error: "prepass failed", pre }
		const concepts = await Promise.all(Array.from({ length: n }, (_, k) => makeConcept(c, pre, model, template, k, { dir })))
		const checks = await Promise.all(
			concepts.map(async (r) => {
				if (!r.ok) return null
				const out = await checkConcept({ dataUrl: conceptData(r), request: c.prompt, prepass: pre.result, model: cm })
				return { id: r.id, ok: out.ok, result: out.ok ? out.result : null, summary: out.ok ? checkSummary(out.result, pre.result) : null, ms: out.ms, usage: out.usage }
			})
		)
		const okIdx = concepts.map((r, i) => (r.ok ? i : -1)).filter((i) => i >= 0)
		const scoreOfIdx = (i) => (checks[i]?.ok ? checks[i].result.score_0_10 + (checks[i].summary?.exact ?? 0) * 0.5 - Math.min(3, checks[i].summary?.extras ?? 0) * 0.2 : -1)
		const best = okIdx.length ? okIdx.reduce((a, b) => (scoreOfIdx(b) > scoreOfIdx(a) ? b : a)) : -1
		const rec = {
			ok: okIdx.length > 0,
			case: c.id,
			sample: s,
			model,
			template,
			n,
			checker: cm,
			prepass: { ms: pre.ms, usage: pre.usage, result: pre.result },
			concepts: concepts.map((r) => ({ id: r.id, ok: r.ok, ms: r.ms, wallMs: r.wallMs, jpg: r.jpg, usage: r.usage, cost_est: r.cost_est, error: r.error })),
			checks,
			first: okIdx[0] ?? -1,
			best,
			// the critical path of the stage as a user would wait for it: pre-pass, then the concept(s) in parallel, then the checks in parallel
			ms_one: pre.ms + (concepts[okIdx[0]]?.ms ?? 0),
			ms_best: pre.ms + Math.max(...concepts.map((r) => r.ms ?? 0)) + Math.max(0, ...checks.filter(Boolean).map((x) => x.ms ?? 0))
		}
		writeJson(file, rec)
		return rec
	})()
	imagineMemo.set(key, p)
	return p
}

function makeApi(arm, track, original) {
	return async (p, body, signal) => {
		const name = p.replace("/api/ai/", "")
		let payload = body.payload
		if (arm === "IFplan" && name === "refine") {
			// the concept informs the plan only: the critic works as in a text build (the words, no picture, no observation, no covers)
			payload = { ...payload, text: original, images: [], plan: { ...payload.plan, covers: undefined } }
			delete payload.observation
		}
		const r = await step(name, payload, track, signal)
		if (!r.ok) return { ok: false, error: r.error?.message, code: r.error?.code, retryable: false }
		return { ok: true, result: r.result, model: r.model, ms: r.ms, usage: r.usage }
	}
}

async function cmdPipeline() {
	const arms = list(opt.arms) ?? ["T", "IFplan", "IFfull", "IFbest3"]
	const samples = Number(opt.samples ?? 1)
	const s0 = Number(opt["sample-from"] ?? 0)
	const cases = selectCases()
	const shot = opt["no-render"] ? null : { render: async (sim, { scene }) => ((await renderer()) ? (await (await renderer()).render(sim, scene)).shots : []) }
	const jobs = []
	for (let s = s0; s < s0 + samples; s++) for (const c of cases) for (const a of arms) jobs.push({ c, a, s, label: `${a}/${c.id}/${s}` })
	log(`pipeline: ${arms.join(", ")} × ${cases.length} cases × ${samples} samples = ${jobs.length} builds`)
	await runJobs(jobs, async ({ c, a, s }) => {
		const file = path.join(RES, "pipeline", a, `${c.id}__s${s}.json`)
		if (!FORCE && exists(file)) return
		const track = { waitMs: 0, callMs: 0, n: 0 }
		const rec = { case: c.id, set: c.set, stages: stagesOf(c), arm: a, sample: s, at: new Date().toISOString() }
		let req = { text: c.prompt }
		let imaginedMs = 0
		let imageCost = 0
		if (a !== "T") {
			const im = await imagine(c, s)
			if (!im.ok) {
				rec.call = { ok: false, error: { message: im.error ?? "imagine failed" } }
				return writeJson(file, rec)
			}
			const idx = a === "IFbest3" ? im.best : im.first
			const con = im.concepts[idx]
			rec.concept = { id: con.id, jpg: con.jpg, idx, picked: a === "IFbest3" ? im.checks.map((x) => x?.result?.score_0_10 ?? null) : undefined }
			imaginedMs = a === "IFbest3" ? im.ms_best : im.ms_one
			imageCost = (a === "IFbest3" ? im.concepts.reduce((s2, r) => s2 + (r.cost_est ?? 0), 0) + im.checks.reduce((s2, x) => s2 + (costOf(x?.usage) ?? 0), 0) : con.cost_est ?? 0) + (costOf(im.prepass.usage) ?? 0)
			req = { text: conceptText(c), images: [{ name: conceptName, dataUrl: dataUrlOf(path.join(HERE, con.jpg)), width: 1536, height: 1024 }] }
		}
		const orch = ORCH.createOrchestrator({ api: makeApi(a, track, c.prompt), shot, simulate: (scene, signal) => simPool().simulate(scene, signal) })
		const t0 = Date.now()
		try {
			const job = orch.build(req, { onEvent: () => {}, reconcile: a === "IFfull" })
			const rep = await job.result
			const wall = Date.now() - t0
			rec.report = { title: rep.title, calls: rep.calls, timings: rep.timings, refine: rep.refine, tune: rep.tune, issues: rep.issues, score: rep.score ?? null, missing: rep.missing, goals: rep.goals ?? null, differences: rep.differences, coverage: rep.coverage ?? null, observation: rep.observation ?? null }
			rec.buildWallMs = wall
			rec.buildWaitMs = track.waitMs
			rec.imagineMs = imaginedMs
			// a user's latency: the imagine stage + the build without the waits this experiment's cap adds
			rec.totalMs = imaginedMs + wall - track.waitMs
			rec.cost = (rep.calls ?? []).reduce((s2, x) => s2 + (costOf(x.usage) ?? 0), 0) + imageCost
			rec.imageCost = imageCost
			rec.initialPlan = rep.initialPlan
			const ev = await evaluate(c, rep.plan, { scene: rep.scene, renderDir: path.join(SCR, "renders", a), name: `${c.id}__s${s}` })
			Object.assign(rec, { plan: rep.plan, scene: ev.scene, sim: ev.sim, score: ev.score, shots: ev.shots, call: { ok: true } })
			const g = rep.goals ?? []
			rec.goalsMet = g.length ? g.filter((x) => x.ok === true).length / g.length : null
			rec.goalsN = g.length
		} catch (e) {
			rec.totalMs = imaginedMs + (Date.now() - t0) - track.waitMs
			rec.call = { ok: false, error: { code: e?.kind ?? e?.code ?? "error", message: String(e?.message ?? e).slice(0, 400) } }
			rec.score = compactScore(await score.scoreCase(c, { error: rec.call.error.message }, { simulate: false }))
		}
		writeJson(file, rec)
		log(`pipeline ${a} ${c.id} s${s}: ${rec.call.ok ? `det ${rec.score?.score?.toFixed(3)} ${rec.score?.pass ? "PASS" : `fail [${rec.score?.failed?.join(",")}]`} goals ${rec.goalsMet ?? "-"} in ${Math.round(rec.totalMs / 1000)} s (wait ${Math.round(track.waitMs / 1000)} s)` : `ERROR ${rec.call.error.message.slice(0, 160)}`}`)
	}, Number(opt.jobs ?? 6))
}

async function cmdJudge() {
	const phase = String(opt.phase ?? "pipeline")
	const judges = (list(opt.judges) ?? ["opus-high", "astra-high"]).map((id) => gw.configOf("judge", id))
	const dir = path.join(RES, phase)
	const arms = list(opt.arms) ?? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
	const ids = new Set(selectCases().map((c) => c.id))
	const jobs = []
	for (const a of arms)
		for (const f of fs.readdirSync(path.join(dir, a)).filter((x) => x.endsWith(".json"))) {
			const caseId = f.replace(/__s\d+\.json$/, "")
			if (!ids.has(caseId)) continue
			for (const j of judges) jobs.push({ file: path.join(dir, a, f), caseId, j, label: `${j.id}:${a}/${f}` })
		}
	jobs.sort((x, y) => (x.j.id < y.j.id ? 1 : -1))
	log(`judge ${phase}: ${judges.map((j) => j.id).join(", ")} on ${jobs.length / judges.length} results`)
	const locks = new Map()
	await runJobs(jobs, async ({ file, caseId, j }) => {
		const c = CASES.get(caseId)
		let rec = readJson(file)
		if (!FORCE && rec.judge?.[j.id] && !rec.judge[j.id].error) return
		let res
		if (!rec.scene || rec.call?.ok === false) res = { score_0_10: 0, request_fidelity: 0, outcome: 0, physical_sense: 0, honesty: 0, reference_match: null, rubric_met: false, issues: ["nothing was built"], auto: true }
		else {
			// blinded: the request, the rubric, the built scene, its run, its renders and the honesty report; never the arm or the concept image
			const out = await gated(() => judge(c, { scene: rec.scene, plan: rec.plan, sim: rec.sim, shots: shotData(rec.shots ?? []), refs: [], base: null, reply: null }, j, { text: c.prompt }))
			res = out.ok ? { ...out.result, ms: out.ms, usage: out.usage, model: out.model } : { error: out.error, ms: out.ms }
		}
		const prev = locks.get(file) ?? Promise.resolve()
		const next = prev.then(() => {
			rec = readJson(file)
			rec.judge = { ...(rec.judge ?? {}), [j.id]: res }
			writeJson(file, rec)
		})
		locks.set(file, next.catch(() => {}))
		await next
		log(`judge ${j.id} ${path.basename(path.dirname(file))}/${path.basename(file)}: ${res.error ? `ERROR ${res.error.message?.slice(0, 120)}` : res.score_0_10}`)
	}, Number(opt.jobs ?? 8))
}

const { cmdReport } = await import("./report.mjs")
const COMMANDS = { phase1: cmdPhase1, prepass: cmdPrepass, concepts: cmdConcepts, check: cmdCheck, observe: cmdObserve, plan: cmdPlan, pipeline: cmdPipeline, judge: cmdJudge, report: () => cmdReport({ RES, opt, CASES, PHASE1, selectCases }) }
if (!COMMANDS[cmd]) {
	const lines = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1)
	console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n"))
	process.exit(cmd ? 2 : 0)
}
if (cmd !== "report" && !process.env.TRUEFOUNDRY_API_KEY) {
	console.error("TRUEFOUNDRY_API_KEY is not set: run it as zsh -c 'source ~/.config/truefoundry/env && node ai/experiments/imagine/run.mjs ...'")
	process.exit(2)
}
await getCatalog()
fs.mkdirSync(RES, { recursive: true })
if (!exists(path.join(RES, "routing.json"))) writeJson(path.join(RES, "routing.json"), ROUTING)
try {
	await COMMANDS[cmd]()
} finally {
	pool?.close()
	if (rendererP) await (await rendererP)?.close()
}
process.exit(0)
