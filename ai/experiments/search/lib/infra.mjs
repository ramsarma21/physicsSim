// Infrastructure of the physics-verified planning experiment: the frozen pipeline modules (frozen/: a snapshot of ai/ and web/ai taken at the
// start, so other agents' edits cannot change the code under test mid-run), the cap on model calls in flight (4 for this experiment), a ledger
// per build (each call's own time, its wait for a slot, its cost), the engine pool and the headless renderer.
//
// The key is read by frozen/ai/core.mjs from process.env only (the runner is started inside `zsh -c 'source ~/.config/truefoundry/env && ...'`);
// nothing here reads, prints or stores it.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const EXP = path.dirname(HERE)
export const F = path.join(EXP, "frozen")
export const SCRATCH = process.env.SEARCH_SCRATCH || "/private/tmp/claude-501/-Users-ramsarma-Downloads-science-map-share/cb014d17-1cd6-4220-a508-cf6ce5539a35/scratchpad/search"
fs.mkdirSync(SCRATCH, { recursive: true })
// before any frozen module loads: the catalog digest's cache and the routing file
process.env.AI_CACHE_DIR ??= path.join(SCRATCH, "ai-cache")
process.env.AI_MODELS ??= path.join(F, "ai/models.json")

const imp = (rel) => import(pathToFileURL(path.join(F, rel)).href)
export const core = await imp("ai/core.mjs")
export const steps = await imp("ai/steps.mjs")
export const schemas = await imp("ai/schemas.mjs")
export const goalsMod = await imp("ai/goals.mjs")
export const digest = await imp("ai/catalog-digest.mjs")
export const sceneDigest = await imp("ai/scene-digest.mjs")
export const solver = await imp("web/ai/solver.js")
export const orch = await imp("web/ai/orchestrator.js")
export const score = await imp("ai/bench/score.mjs")
export const gateway = await imp("ai/bench/lib/gateway.mjs")
export const judgeLib = await imp("ai/bench/lib/judge.mjs")
const { fetchH1 } = await imp("ai/research/fetch-h1.mjs")
const { createSimPool } = await imp("ai/bench/lib/sim-pool.mjs")
export { fetchH1 }

export const ROUTING = JSON.parse(fs.readFileSync(process.env.AI_MODELS, "utf8"))
export const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)))
export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
export const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const now = () => Date.now()
const ts = () => new Date().toISOString().slice(11, 19)
export const log = (...a) => console.log(`[${ts()}]`, ...a)

// ---------------------------------------------------------------- the cap on model calls in flight (this experiment: 4)
const LIMIT = Number(process.env.SEARCH_CONCURRENCY ?? 4)
let active = 0
const waiters = []
async function acquire() {
	if (active < LIMIT) {
		active++
		return
	}
	await new Promise((r) => waiters.push(r))
	active++
}
function release() {
	active--
	const w = waiters.shift()
	if (w) w()
}
export const inFlight = () => ({ active, waiting: waiters.length })

/** A ledger of one build: every model call with its own time (ms, without the wait for a slot), the wait, its cost and tokens. */
export function ledger(name) {
	return { name, calls: [], add(c) { this.calls.push(c) } }
}
export const costOf = (u) => num(u?.costInUSD) ?? num(u?.cost) ?? 0
export function ledgerTotals(L) {
	const c = L.calls
	return {
		calls: c.length,
		failed: c.filter((x) => !x.ok).length,
		cost: Math.round(c.reduce((s, x) => s + (x.cost ?? 0), 0) * 10000) / 10000,
		modelMs: c.reduce((s, x) => s + (x.ms ?? 0), 0),
		waitMs: c.reduce((s, x) => s + (x.waitMs ?? 0), 0),
		byStep: Object.fromEntries([...new Set(c.map((x) => x.step))].map((s) => [s, { n: c.filter((x) => x.step === s).length, ms: c.filter((x) => x.step === s).reduce((a, x) => a + (x.ms ?? 0), 0), cost: Math.round(c.filter((x) => x.step === s).reduce((a, x) => a + (x.cost ?? 0), 0) * 10000) / 10000 }]))
	}
}

const BUSY = (e) => e?.code === "busy" || e?.status === 429 || /\b429\b|rate limit|too many requests/i.test(String(e?.message ?? ""))
const TRANSIENT = (e) => BUSY(e) || e?.code === "gateway" || e?.code === "timeout" || e?.code === "budget" || (e?.status ?? 0) >= 500
/**
 * One model call under the cap, recorded in the ledger (step, label, own ms, wait, cost). fn() does the call (it gets no slot of its own).
 * A busy gateway (429) or a failing backend is waited out and tried again (20 s, 40 s), so a slow hour never costs a case.
 */
export async function modelCall(L, step, label, fn) {
	let lastErr
	for (let attempt = 0; attempt < 3; attempt++) {
		const tw = now()
		await acquire()
		const t0 = now()
		try {
			const out = await fn()
			L?.add({ step, label, ok: true, ms: out?.ms ?? now() - t0, wallMs: now() - t0, waitMs: t0 - tw, cost: costOf(out?.usage), usage: out?.usage ?? null, model: out?.model ?? null, attempt })
			return out
		} catch (e) {
			lastErr = e
			L?.add({ step, label, ok: false, ms: now() - t0, wallMs: now() - t0, waitMs: t0 - tw, cost: costOf(e?.usage), error: String(e?.message ?? e).slice(0, 300), code: e?.code ?? null, attempt })
			if (!TRANSIENT(e) || attempt === 2) throw e
		} finally {
			release()
		}
		const wait = (BUSY(lastErr) ? 20000 : 8000) * (attempt + 1)
		log(`${step} ${label}: ${lastErr?.code ?? "error"} (${String(lastErr?.message ?? "").slice(0, 100)}); trying again in ${wait / 1000} s`)
		await sleep(wait)
	}
	throw lastErr
}

/** An app step (frozen ai/steps.mjs runStep) with the frozen shipped routing (fallbacks included), over HTTP/1.1. */
export function runStep(L, step, payload, { label = step, params, routeStep } = {}) {
	return modelCall(L, routeStep ?? step, label, () => steps.runStep(step, payload, { routing: ROUTING, fetch: fetchH1, ...(params ? { params } : {}) }))
}

// ---------------------------------------------------------------- the engine (worker threads; the same runs as POST /api/simulate)
let pool = null
export const simPool = () => (pool ??= createSimPool({ size: Number(process.env.SEARCH_SIMS ?? 6) }))
export async function simulate(scene, signal) {
	return simPool().simulate(scene, signal)
}

// ---------------------------------------------------------------- renders (frozen bench renderer: the app's own critique camera, headless Chromium)
let rendererP = null
export async function renderer() {
	if (process.env.SEARCH_NO_RENDER) return null
	rendererP ??= (async () => {
		const { createRenderer } = await imp("ai/bench/lib/render.mjs")
		return createRenderer({ pages: Number(process.env.SEARCH_RENDER_PAGES ?? 3), log: (l) => log(`render: ${l}`) })
	})()
	return rendererP
}
/** The critique pictures of a run ({label, t, dataUrl}[]), or [] when rendering fails. */
export async function shots(sim, scene) {
	try {
		const r = await renderer()
		if (!r) return []
		return (await r.render(sim, scene)).shots
	} catch (e) {
		log(`render failed: ${e.message}`)
		return []
	}
}
export const wire = (s, label) => ({ data: s.dataUrl, label: label ?? s.label })
export function saveShots(list, dir, name) {
	fs.mkdirSync(dir, { recursive: true })
	return list.map((s) => {
		const f = path.join(dir, `${name}-${s.label}.jpg`)
		fs.writeFileSync(f, Buffer.from(s.dataUrl.slice(s.dataUrl.indexOf(",") + 1), "base64"))
		return { label: s.label, t: s.t, file: f }
	})
}
export const loadShots = (list) => (list ?? []).filter((s) => fs.existsSync(s.file)).map((s) => ({ ...s, dataUrl: `data:image/jpeg;base64,${fs.readFileSync(s.file).toString("base64")}` }))

export async function closeAll() {
	try {
		pool?.close()
	} catch {}
	try {
		const r = await rendererP
		await r?.close()
	} catch {}
}
