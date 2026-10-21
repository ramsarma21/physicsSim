#!/usr/bin/env node
// The edit experiment's eval (ai/experiments/edit: 105 cases on 11 scenes, its hard checks lib/check.mjs and its "says why" grader, imported
// read-only) run through the LIVE browser pipeline: web/ai/orchestrator.js in mode "edit", called exactly as the panel calls it (web/ai/panel.js
// start(): {text, images: [], mode: "edit", scene, sim: the run of the scene on screen, plan + planScene of the last AI build, history}), with
// the shipped server step (ai/steps.mjs runStep, in process, HTTP/1.1) behind its api(). After a plain edit that stopped a goal the panel's
// own fix search runs too (ai.findFix(report.fixCtx): the pre-checked fix chip), so the card's words are what the person reads. round-3
// plan §6: E0 = the live client before C1/C2 (a frozen copy: --client), E1 = after.
//   zsh -c 'source ~/.config/truefoundry/env && node ai/bench/tools/edit-live.mjs --run e0-1 --client <dir> [--cases a,b] [--cat fix] [--jobs 6]'
//   zsh -c '... --run e0-f2,e0-f3,e0-f4,e0-f5 --cat fix --client <dir>'         (more samples of the 4 "make it work" cases, one queue)
//   node ai/bench/tools/edit-live.mjs --report --runs e0-1 [--fix-runs e0-1,e0-f2,...] [--ref i1,i2] [--fix-ref i1,i2,i3,i4,i5] [--save <file.md>]
// --client <dir>: the browser half from <dir> (<dir>/web/ai + <dir>/web/sim, or <dir>/ai + <dir>/sim); default this tree's web/. Its runs
//   use its own web/sim (engine threads). The server step is always this tree's ai/ (shipped runStep).
// --score-env <dir>: the scorer's frozen copy (EDIT_FROZEN for check.mjs: ai/ + web/ai + web/sim). Made on first use from this tree's ai/ and
//   the client's web/; reuse the same one for E0 and E1 so the checks never change between them (its hashes are in each run's run.json).
// --no-fix-search: skip the panel's fix search after a plain edit (the card then has no fix offer).
// Results: one JSON per (run, case) under $EDIT_LIVE_OUT (default: this session's scratchpad partB/B/edit-live/<run>/), resumable (a finished
// file is skipped unless --force; an errored one is run again). At most 4 model calls in flight (the experiment's lib/pool.mjs withSlot,
// shared with the grader). The key is read by ai/core.mjs from the environment only; nothing here prints or stores it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { Worker } from "node:worker_threads"
import { fileURLToPath, pathToFileURL } from "node:url"
import { missingLine } from "../../../web/ai/missing-words.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.join(HERE, "..", "..", "..")
const EXP = path.join(REPO, "ai", "experiments", "edit")
export const SCRATCH = "/private/tmp/claude-501/-Users-ramsarma-Downloads-science-map-share/cb014d17-1cd6-4220-a508-cf6ce5539a35/scratchpad"
export const OUT_ROOT = process.env.EDIT_LIVE_OUT ?? path.join(SCRATCH, "partB", "B", "edit-live")
export const N7_OUT = process.env.EDIT_N7_OUT ?? path.join(SCRATCH, "n7int", "results") // the integrated n7 records (benchmark §14): the reference
export const clone = (o) => (o === undefined || o === null ? o : JSON.parse(JSON.stringify(o)))
export const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
export const writeJson = (f, v) => {
	fs.mkdirSync(path.dirname(f), { recursive: true })
	const tmp = `${f}.${process.pid}.tmp`
	fs.writeFileSync(tmp, JSON.stringify(v, null, 1))
	fs.renameSync(tmp, f)
}
export const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"))
const sha = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16)
export function parseArgs(argv) {
	const opt = {}
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue
		const v = argv[i + 1]
		if (v === undefined || v.startsWith("--")) opt[argv[i].slice(2)] = true
		else (opt[argv[i].slice(2)] = v), i++
	}
	return opt
}
export const list = (v) => (v === undefined || v === true ? null : String(v).split(",").map((s) => s.trim()).filter(Boolean))

// ---------------------------------------------------------------- the client (the browser half under test)
/** <dir> -> the directory that holds the client's ai/ (orchestrator.js) and sim/ (index.js). */
export function clientWeb(dir) {
	if (!dir || dir === true) return path.join(REPO, "web")
	const d = path.resolve(String(dir))
	for (const w of [path.join(d, "web"), d]) if (fs.existsSync(path.join(w, "ai", "orchestrator.js")) && fs.existsSync(path.join(w, "sim", "index.js"))) return w
	throw new Error(`no client in ${d} (wanted web/ai/orchestrator.js + web/sim/index.js, or ai/orchestrator.js + sim/index.js)`)
}
const hashDir = (d, filter = (f) => /\.(m?js|json)$/.test(f) && !f.endsWith(".map")) =>
	Object.fromEntries(
		fs
			.readdirSync(d)
			.filter((f) => fs.statSync(path.join(d, f)).isFile() && filter(f))
			.sort()
			.map((f) => [f, sha(path.join(d, f))])
	)
export const clientHashes = (web) => ({ ai: hashDir(path.join(web, "ai")), sim: hashDir(path.join(web, "sim")) })

// ---------------------------------------------------------------- the scorer's frozen copy (check.mjs reads EDIT_FROZEN: ai/ + web/ai + web/sim)
export function ensureScoreEnv(env, web) {
	if (fs.existsSync(path.join(env, "made.json"))) return readJson(path.join(env, "made.json"))
	fs.mkdirSync(path.join(env, "ai", "prompts"), { recursive: true })
	for (const f of fs.readdirSync(path.join(REPO, "ai"))) if (f.endsWith(".mjs") || f === "models.json") fs.copyFileSync(path.join(REPO, "ai", f), path.join(env, "ai", f))
	fs.cpSync(path.join(REPO, "ai", "prompts"), path.join(env, "ai", "prompts"), { recursive: true })
	fs.copyFileSync(path.join(REPO, "ai", "research", "fetch-h1.mjs"), path.join(env, "ai", "fetch-h1.mjs"))
	// (ai/imagine.mjs imports ./research/fetch-h1.mjs)
	fs.mkdirSync(path.join(env, "ai", "research"), { recursive: true })
	fs.copyFileSync(path.join(REPO, "ai", "research", "fetch-h1.mjs"), path.join(env, "ai", "research", "fetch-h1.mjs"))
	fs.mkdirSync(path.join(env, "web", "ai"), { recursive: true })
	for (const f of fs.readdirSync(path.join(web, "ai"))) if (f.endsWith(".js")) fs.copyFileSync(path.join(web, "ai", f), path.join(env, "web", "ai", f))
	fs.cpSync(path.join(web, "sim"), path.join(env, "web", "sim"), { recursive: true, filter: (s) => !s.endsWith(".map") })
	const made = { at: new Date().toISOString(), from: { ai: path.join(REPO, "ai"), web }, ai: hashDir(path.join(env, "ai")), webai: hashDir(path.join(env, "web", "ai")), sim: hashDir(path.join(env, "web", "sim")) }
	writeJson(path.join(env, "made.json"), made)
	return made
}

// ---------------------------------------------------------------- engine threads on the client's own web/sim (as POST /api/simulate answers)
export function enginePool(simDir, size = Math.max(2, Math.min(8, os.cpus().length - 6))) {
	const url = pathToFileURL(path.join(EXP, "lib", "sim-worker.mjs"))
	const idle = []
	const waiting = []
	const jobs = new Map()
	let next = 1
	const spawn = () => {
		const w = new Worker(url, { workerData: { sim: simDir } })
		w.unref()
		w.on("message", (m) => {
			const j = jobs.get(m.id)
			if (!j) return
			jobs.delete(m.id)
			w.job = null
			if (m.ok) j.resolve(m.sim)
			else j.reject(new Error(m.error))
			release(w)
		})
		w.on("error", (e) => {
			if (w.job) {
				const j = jobs.get(w.job)
				jobs.delete(w.job)
				j?.reject(new Error(`engine thread died: ${e.message}`))
			}
			release(spawn())
		})
		return w
	}
	const release = (w) => {
		const job = waiting.shift()
		if (job) run(w, job)
		else idle.push(w)
	}
	const run = (w, job) => {
		w.job = job.id
		jobs.set(job.id, job)
		w.postMessage({ id: job.id, scene: job.scene, rate: job.rate })
	}
	for (let i = 0; i < size; i++) idle.push(spawn())
	const simulate = (scene, signal, rate = 120) =>
		new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }))
			const job = { id: next++, scene: JSON.parse(JSON.stringify(scene)), rate, resolve, reject }
			const w = idle.pop()
			if (w) run(w, job)
			else waiting.push(job)
		})
	return { simulate, size }
}

// ---------------------------------------------------------------- setup: env first, then the modules (check.mjs's env.mjs reads it on import)
/**
 * -> {web, env, made, CASES, prepareCase, evaluate, withSlot, runStep, fetchH1, ORCH, engine, simOnScreen}
 * opts: {client, scoreEnv, out}
 */
export async function setup({ client = null, scoreEnv = null, out = OUT_ROOT } = {}) {
	const web = clientWeb(client)
	const tag = client && client !== true ? path.basename(path.resolve(String(client))) : "live"
	const env = path.resolve(String(scoreEnv ?? path.join(out, `score-env-${tag}`)))
	const made = ensureScoreEnv(env, web)
	process.env.EDIT_FROZEN = env
	process.env.EDIT_OUT = out // (check.mjs keeps its grade cache there)
	process.env.AI_CACHE_DIR = path.join(out, ".cache") // (the catalog digest cache, of the live ai/ and the scorer's copy: never ai/.cache)
	process.env.EDIT_MAX_CALLS = String(Math.max(1, Math.min(4, Number(process.env.EDIT_MAX_CALLS ?? 4) || 4)))
	// the grades already made (the experiment's and the integrated runs'): a grade is keyed by the request, what broke and the words shown
	const gc = path.join(out, "grade-cache.json")
	if (!fs.existsSync(gc)) {
		const merged = {}
		for (const f of [path.join(SCRATCH, "edit-results", "grade-cache.json"), path.join(N7_OUT, "grade-cache.json")])
			try {
				Object.assign(merged, readJson(f))
			} catch {}
		writeJson(gc, merged)
	}
	const imp = (p) => import(pathToFileURL(p).href)
	const [{ CASES }, check, pool, steps, h1, ORCH] = await Promise.all([imp(path.join(EXP, "cases.mjs")), imp(path.join(EXP, "lib", "check.mjs")), imp(path.join(EXP, "lib", "pool.mjs")), imp(path.join(REPO, "ai", "steps.mjs")), imp(path.join(REPO, "ai", "research", "fetch-h1.mjs")), imp(path.join(web, "ai", "orchestrator.js"))])
	await (await imp(path.join(REPO, "ai", "catalog-digest.mjs"))).getCatalog()
	try {
		clientOffer = (await imp(path.join(web, "ai", "edit-turns.js"))).offerWords ?? null
	} catch {
		clientOffer = null
	}
	const engine = enginePool(path.join(web, "sim"))
	// the run of the scene on screen (what host.getSim() hands the panel): the scene as it is, on the client's engine; once per starting scene
	const onScreen = new Map()
	const simOnScreen = (B) => {
		const k = JSON.stringify(B.scene)
		if (!onScreen.has(k)) onScreen.set(k, engine.simulate(clone(B.scene)))
		return onScreen.get(k)
	}
	return { web, env, made, CASES, prepareCase: check.prepareCase, evaluate: check.evaluate, withSlot: pool.withSlot, runStep: steps.runStep, fetchH1: h1.fetchH1, ORCH, engine, simOnScreen }
}

// ---------------------------------------------------------------- the app's api() over the shipped step, recording every call
export function makeApi(S, rec, { stored = null } = {}) {
	return async (p, body, signal) => {
		if (/^\/api\/ai\/progress/.test(p)) throw new Error("no progress endpoint here")
		if (p === "/api/simulate") return S.engine.simulate(body.scene, signal)
		const step = p.replace("/api/ai/", "")
		const t0 = Date.now()
		// (the replay: a stored answer stands in for the model's; no model call)
		if (stored) {
			if (step === "edit" && stored.edit) {
				rec.calls.push({ step, ms: 0, stored: true })
				return { ok: true, result: clone(stored.edit), model: "(stored answer)", ms: 0, usage: {} }
			}
			rec.calls.push({ step, ms: 0, stored: true, error: "no stored answer" })
			return { ok: false, error: `the replay has no stored answer for ${step}`, code: "bad_input", retryable: false }
		}
		try {
			const out = await S.withSlot(() => S.runStep(step, body.payload, { fetch: S.fetchH1, signal }))
			rec.calls.push({ step, ms: out.ms, wallMs: Date.now() - t0, model: out.model, usage: out.usage, warnings: out.warnings?.slice?.(0, 8) })
			rec.answers.push({ step, result: out.result })
			return { ok: true, result: out.result, model: out.model, ms: out.ms, usage: out.usage }
		} catch (e) {
			rec.calls.push({ step, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 300), code: e?.code })
			return { ok: false, error: String(e?.message ?? e), code: e?.code ?? "error", status: e?.status, retryable: !!e?.retryable }
		}
	}
}

// ---------------------------------------------------------------- what the person reads on the card (web/ai/panel.js renderReport / fixOffer / headsUp)
const capFirst = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : "")
let clientOffer = null // (the client's own words for the offer, web/ai/edit-turns.js offerWords, when it has them: ai/DESIGN.md §16)
export function offerWords(fx) {
	if (!fx || fx.state === "searching") return ""
	if (clientOffer) {
		const w = clientOffer(fx)
		if (!w) return ""
		return fx.state === "found" ? ` ${w.before}${w.say}? (checked: ${w.checked} ✓${fx.fragile ? ", only just" : ""})` : w.text ? ` ${w.text}` : ""
	}
	if (fx.state === "found") return ` Want me to ${fx.say}? (checked: ${fx.checked} ✓${fx.fragile ? ", only just" : ""})`
	if (fx.state === "none") return " I couldn’t find a small fix that I could check works — want the AI to rework it?"
	if (fx.state === "stopped") return " I stopped looking for a fix. Want the AI to rework it?"
	return " I couldn’t look for a fix just now. Want the AI to rework it?"
}
function headsUp(r) {
	const warn = (r.issues ?? []).find((i) => i.level === "warn" || i.level === "error")
	const miss = (r.missing ?? [])[0]
	if (warn) return `Heads-up: ${warn.text}`
	// (worded as web/ai/panel.js words it: ../../../web/ai/missing-words.js)
	if (miss) return `Heads-up: ${missingLine(miss)}.`
	if (r.differences?.length) return `Heads-up: ${String(r.differences[0]).replace(/\.$/, "")}.`
	return null
}
/** -> {scene (on the table after; null = unchanged), reply (the card's first line; for a reply-only answer the reply), notes (the rest of the card)} */
export function cardOf(rep, fx = null) {
	if (rep.replyOnly) return { scene: null, reply: String(rep.reply ?? ""), notes: [rep.planned].filter((x) => typeof x === "string" && x) }
	const lead = `${rep.lead ?? ""}${offerWords(fx ?? rep.fix)}`
	// (round 3, C1/C2: an edit card also says what stopped happening in the new run: "Heads-up, in the new run: …" from report.edit.headsUp)
	const lc = (x) => (x ? String(x)[0].toLowerCase() + String(x).slice(1) : "")
	const and = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`)
	const runHeads = rep.edit?.headsUp?.length ? `Heads-up, in the new run: ${and(rep.edit.headsUp.slice(0, 3).map((x) => lc(String(x).replace(/[.!]+$/, ""))))}.` : null
	const notes = [headsUp(rep), runHeads, ...(rep.issues ?? []).filter((i) => i.level !== "info").map((i) => i.text), (rep.planned ?? rep.edit?.reply) ? `What I planned: ${rep.planned ?? rep.edit.reply}` : null, ...(rep.human ?? []).map(capFirst), rep.quickNote, ...(rep.targets ?? []).filter((t) => t.ok === false && t.happened).map((t) => t.happened)].filter((x) => typeof x === "string" && x)
	// (the reply the checks read: the lead the card shows, then what the AI planned (its Details line): a "can't" said either place counts)
	return { scene: rep.scene, reply: [lead, rep.planned ?? rep.edit?.reply].filter(Boolean).join("\n"), notes }
}

// ---------------------------------------------------------------- one case, as the panel runs it
export async function runCase(S, c, run, { fixSearch = true, stored = null } = {}) {
	const B = await S.prepareCase(c)
	const sim = await S.simOnScreen(B)
	const rec = { case: c.id, cat: c.cat, run, text: c.text, at: new Date().toISOString(), calls: [], answers: [] }
	const orch = S.ORCH.createOrchestrator({ api: makeApi(S, rec, { stored }), shot: null, simulate: (scene, signal) => S.engine.simulate(scene, signal) })
	// (web/ai/panel.js start(): the scene on screen, its run, the last AI build's plan and the scene it put on the table, the earlier turns)
	const req = { text: c.text, images: [], mode: "edit", scene: clone(B.scene), sim, plan: B.plan ? clone(B.plan) : null, planScene: B.plan ? clone(B.scene) : null, history: (c.history ?? []).map((h) => ({ role: h.role, text: h.text })) }
	const t0 = Date.now()
	try {
		const job = orch.build(req, { onEvent: () => {} })
		const rep = await job.result
		rec.ms = Date.now() - t0
		// the panel's fix search after a plain edit that stopped a goal (the change is on the table; the card then offers the checked fix)
		let fx = null
		if (fixSearch && rep.fixNeeded && rep.fixCtx) {
			const t1 = Date.now()
			try {
				// (the panel's search after the change: the fix search, and side by side the AI's rework in the background, when the client has it
				// (makeItWork, §16); an older client's fix search alone)
				if (typeof orch.makeItWork === "function") {
					const history = [...req.history, { role: "user", text: c.text }, { role: "assistant", text: `${rep.lead ?? ""}${rep.human?.length ? ` Changes: ${rep.human.join("; ")}.` : ""}` }].slice(-20)
					const mw = await orch.makeItWork(rep.fixCtx, { job: { text: c.text, history, plan: rep.plan ?? null, keep: rep.edit?.touched ?? null } })
					fx = mw.status === "ok" ? null : mw.info
				} else {
					const fr = await orch.findFix(rep.fixCtx, {})
					fx = fr.status === "ok" ? null : S.ORCH.fixInfo(fr, rep.fixCtx.scene, fr.targets)
				}
			} catch (e) {
				fx = { state: "error", error: String(e?.message ?? e).slice(0, 200) }
			}
			rec.fixMs = Date.now() - t1
		}
		const card = cardOf(rep, fx)
		rec.reply = card.reply
		rec.notes = card.notes
		rec.scene = card.scene
		const first = rec.answers.find((a) => a.step === "edit")?.result ?? (stored?.edit ?? null)
		rec.report = {
			replyOnly: !!rep.replyOnly,
			suggestNew: !!rep.suggestNew,
			undo: !!rep.undo,
			quick: !!rep.quick,
			lead: rep.lead ?? null,
			planned: rep.planned ?? null,
			kind: first?.kind ?? null,
			targets: first?.targets ?? null,
			edit: rep.edit ? { mode: rep.edit.mode, changes: rep.edit.changes, unchanged: rep.edit.unchanged, noChange: rep.edit.noChange, touched: rep.edit.touched, kind: rep.edit.kind, targetWords: rep.edit.targetWords, skipped: rep.edit.skipped, headsUp: rep.edit.headsUp, repair: rep.edit.repair, fixFlow: rep.edit.fixFlow, stillFails: rep.edit.stillFails, slid: rep.edit.slid } : null,
			human: rep.human ?? null,
			goals: rep.goals ?? null,
			targetsRun: rep.targets ?? null,
			fixNeeded: !!rep.fixNeeded,
			fixApplied: rep.fixApplied ?? null,
			fix: fx ? { state: fx.state, how: fx.how ?? null, say: fx.say ?? null, checked: fx.checked ?? null, label: fx.label ?? null, reworked: fx.reworked ?? null } : rep.fix ? { state: rep.fix.state, say: rep.fix.say ?? null } : null,
			issues: rep.issues ?? [],
			suggestions: rep.suggestions ?? [],
			timings: rep.timings ?? null,
			totalMs: rep.totalMs ?? null
		}
		rec.eval = await S.evaluate(c, B, { scene: card.scene, reply: card.reply, notes: card.notes }, { grade: !stored })
	} catch (e) {
		rec.ms ??= Date.now() - t0
		rec.error = String(e?.stack ?? e).slice(0, 1500)
		rec.eval = { pass: false, pass_byte: false, checks: { error: false }, fail: [`error: ${String(e?.message ?? e).slice(0, 300)}`] }
	}
	rec.cost = rec.calls.reduce((s, x) => s + (x.usage?.costInUSD ?? 0), 0)
	return rec
}

// ---------------------------------------------------------------- the report (shaped like ai/research/benchmark.md §14)
export const pct = (a, p) => {
	const s = a.filter(Number.isFinite).sort((x, y) => x - y)
	if (!s.length) return NaN
	const i = (s.length - 1) * p
	return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i))
}
const CHECKS = ["exact", "untouched", "untouched_byte", "extra", "overlap", "works_or_said", "noChange", "ask", "answer"]
export function row(name, rs) {
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
export function rowsTable(rows) {
	return [
		"| arm | n | pass | byte-identical pass | exact change | others untouched (≤ 3 mm) | untouched byte | no unasked items | no new overlaps | works or says why | questions / ambiguous unchanged | asks when ambiguous | answers right | errors | p50 / p90 s | edit calls | $ per edit |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
		...rows.map((r) => `| ${r.arm} | ${r.n} | ${f3(r.pass)} | ${f3(r.pass_byte)} | ${frac(r.exact)} | ${frac(r.untouched)} | ${frac(r.untouched_byte)} | ${frac(r.extra)} | ${frac(r.overlap)} | ${frac(r.works_or_said)} | ${frac(r.noChange)} | ${frac(r.ask)} | ${frac(r.answer)} | ${r.errors} | ${f1(r.p50_s)} / ${f1(r.p90_s)} | ${r.edit_calls.toFixed(2)} | ${r.usd.toFixed(3)} |`)
	].join("\n")
}
const loadRec = (dir, run, id, arm = null) => {
	const f = arm ? path.join(dir, run, arm, `${id}.json`) : path.join(dir, run, `${id}.json`)
	return fs.existsSync(f) ? readJson(f) : null
}

async function report(opt) {
	const { CASES } = await import(pathToFileURL(path.join(EXP, "cases.mjs")).href)
	const runs = list(opt.runs) ?? ["e0-1"]
	const fixRuns = list(opt["fix-runs"]) ?? runs
	const refRuns = list(opt.ref) ?? ["i1", "i2"]
	const fixRef = list(opt["fix-ref"]) ?? ["i1", "i2", "i3", "i4", "i5"]
	const live = (r, c) => loadRec(OUT_ROOT, r, c.id)
	const ref = (r, c) => loadRec(N7_OUT, r, c.id, "n7")
	const L = runs.flatMap((r) => CASES.map((c) => live(r, c)).filter(Boolean))
	const R = refRuns.flatMap((r) => CASES.map((c) => ref(r, c)).filter(Boolean))
	const md = []
	const label = opt.label ?? "live client"
	md.push(`## All ${CASES.length} cases (${label}: ${runs.join(" + ")})\n`)
	md.push(rowsTable([row(`${label} (${runs.join("+")})`, L), row(`integrated n7, the experiment's browser half (${refRuns.join("+")})`, R)]))
	const fixCases = CASES.filter((c) => c.cat === "fix")
	const FL = fixRuns.flatMap((r) => fixCases.map((c) => live(r, c)).filter(Boolean))
	const FR = fixRef.flatMap((r) => fixCases.map((c) => ref(r, c)).filter(Boolean))
	md.push(`\n## "Make it work again": ${fixCases.length} cases × samples\n`)
	md.push(`| arm | n | pass | ${fixCases.map((c) => c.id).join(" | ")} | p50 / p90 s | $ |\n|---|---|---|${fixCases.map(() => "---").join("|")}|---|---|`)
	const fixRow = (name, rs) => `| ${name} | ${rs.length} | ${rs.filter((r) => r.eval?.pass).length}/${rs.length} | ${fixCases.map((c) => { const x = rs.filter((r) => r.case === c.id); return `${x.filter((r) => r.eval?.pass).length}/${x.length}` }).join(" | ")} | ${f1(pct(rs.map((r) => r.ms), 0.5) / 1000)} / ${f1(pct(rs.map((r) => r.ms), 0.9) / 1000)} | ${(rs.reduce((q, r) => q + (r.cost ?? 0), 0) / Math.max(1, rs.length)).toFixed(3)} |`
	md.push(fixRow(`${label} (${fixRuns.join("+")})`, FL))
	md.push(fixRow(`integrated n7 (${fixRef.join("+")})`, FR))
	const cats = [...new Set(CASES.map((c) => c.cat))]
	md.push(`\n## By category\n\n| category | cases | ${label} | integrated n7 |\n|---|---|---|---|`)
	for (const cat of cats) {
		const ids = new Set(CASES.filter((c) => c.cat === cat).map((c) => c.id))
		const a = L.filter((r) => ids.has(r.case))
		const b = R.filter((r) => ids.has(r.case))
		md.push(`| ${cat} | ${ids.size} | ${a.filter((r) => r.eval?.pass).length}/${a.length} | ${b.filter((r) => r.eval?.pass).length}/${b.length} |`)
	}
	const baseOf = (c) => (typeof c.base === "string" ? c.base : c.base.from)
	md.push(`\n## By base scene\n\n| base | cases | ${label} | integrated n7 |\n|---|---|---|---|`)
	for (const b of [...new Set(CASES.map(baseOf))]) {
		const ids = new Set(CASES.filter((c) => baseOf(c) === b).map((c) => c.id))
		const a = L.filter((r) => ids.has(r.case))
		const z = R.filter((r) => ids.has(r.case))
		md.push(`| ${b} | ${ids.size} | ${a.filter((r) => r.eval?.pass).length}/${a.length} | ${z.filter((r) => r.eval?.pass).length}/${z.length} |`)
	}
	// what failed, case by case (the live client)
	const fails = L.filter((r) => !r.eval?.pass)
	md.push(`\n## Failures (${label}): ${fails.length}\n`)
	for (const r of fails.sort((a, b) => a.case.localeCompare(b.case))) md.push(`- ${r.case} (${r.run}, ${r.cat}): ${(r.eval?.fail ?? []).join(" | ").slice(0, 400)}${r.report?.kind ? ` [kind ${r.report.kind}]` : ""}`)
	// the fix chip (the panel's search after a plain edit that stopped a goal)
	const plain = L.filter((r) => r.report?.fixNeeded)
	if (plain.length) {
		const st = {}
		for (const r of plain) st[r.report.fix?.state ?? "none-run"] = (st[r.report.fix?.state ?? "none-run"] ?? 0) + 1
		md.push(`\n## The pre-checked fix chip after a plain edit that stopped a goal: ${plain.length} edits; ${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(", ")}; search p50 ${f1(pct(plain.map((r) => r.fixMs), 0.5) / 1000)} s`)
	}
	const real = CASES.find((c) => c.id === "s-swap-user")
	md.push(`\n## The user's real request ("${real.text}")`)
	for (const r of runs) {
		const x = live(r, real)
		if (x) md.push(`- ${r}: ${x.eval?.pass ? "PASS" : "fail"}${x.eval?.pass_byte ? " (untouched byte-identical)" : ""}, ${(x.ms / 1000).toFixed(1)} s, kind ${x.report?.kind ?? "?"} — “${String(x.reply).split("\n")[0].slice(0, 300)}”${x.report?.fix?.state ? ` [fix chip: ${x.report.fix.state}${x.report.fix.say ? `: ${x.report.fix.say}` : ""}]` : ""}`)
	}
	const text = md.join("\n")
	console.log(text)
	if (opt.save && opt.save !== true) {
		fs.mkdirSync(path.dirname(path.resolve(String(opt.save))), { recursive: true })
		fs.writeFileSync(path.resolve(String(opt.save)), text + "\n")
		writeJson(path.resolve(String(opt.save)).replace(/\.md$/, "") + ".json", { at: new Date().toISOString(), runs, fixRuns, refRuns, fixRef, rows: [row(label, L), row("integrated n7", R)], fix: { live: { pass: FL.filter((r) => r.eval?.pass).length, n: FL.length }, ref: { pass: FR.filter((r) => r.eval?.pass).length, n: FR.length } }, perCase: CASES.map((c) => ({ id: c.id, cat: c.cat, live: runs.map((r) => live(r, c)?.eval?.pass ?? null), ref: refRuns.map((r) => ref(r, c)?.eval?.pass ?? null), fails: runs.map((r) => (live(r, c)?.eval?.fail ?? []).join(" | ").slice(0, 300)) })) })
	}
}

// ---------------------------------------------------------------- main
async function main() {
	const opt = parseArgs(process.argv.slice(2))
	if (opt.report) return report(opt)
	const runs = list(opt.run) ?? ["e0-1"]
	const S = await setup({ client: opt.client ?? null, scoreEnv: opt["score-env"] ?? null })
	let cs = S.CASES
	if (list(opt.cases)) cs = cs.filter((c) => list(opt.cases).includes(c.id))
	if (list(opt.cat)) cs = cs.filter((c) => list(opt.cat).includes(c.cat))
	if (opt.limit) cs = cs.slice(0, Number(opt.limit))
	const meta = { at: new Date().toISOString(), client: S.web, clientHashes: clientHashes(S.web), scoreEnv: S.env, scoreEnvMade: S.made, server: { ai: hashDir(path.join(REPO, "ai")) }, fixSearch: !opt["no-fix-search"], maxCalls: Number(process.env.EDIT_MAX_CALLS) }
	for (const r of runs) writeJson(path.join(OUT_ROOT, r, "run.json"), meta)
	log(`edit-live ${runs.join(",")}: the client in ${S.web} × ${cs.length} cases (≤ ${meta.maxCalls} model calls in flight)`)
	const grid = runs.flatMap((r) => cs.map((c) => ({ r, c })))
	let i = 0
	await Promise.all(
		Array.from({ length: Number(opt.jobs ?? 6) }, async () => {
			while (i < grid.length) {
				const { r, c } = grid[i++]
				const file = path.join(OUT_ROOT, r, `${c.id}.json`)
				if (!opt.force && fs.existsSync(file) && !readJson(file).error) continue
				const rec = await runCase(S, c, r, { fixSearch: !opt["no-fix-search"] })
				writeJson(file, rec)
				log(`${r} ${c.id}: ${rec.eval.pass ? "PASS" : "fail"}${rec.eval.pass && !rec.eval.pass_byte ? " (not byte)" : ""} ${(rec.ms / 1000).toFixed(1)} s $${rec.cost.toFixed(3)}${rec.report?.fix?.state ? ` [fix ${rec.report.fix.state}]` : ""} ${rec.eval.pass ? "" : `— ${(rec.eval.fail ?? []).join(" | ").slice(0, 300)}`}`)
			}
		})
	)
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
	await main()
	process.exit(0)
}
