// Live smoke test: every step once through the REAL gateway with small inputs, using ai/models.json's routing (costs real tokens).
//   zsh -c 'source ~/.config/truefoundry/env && node ai/test/live-smoke.mjs'            all steps (observe -> plan-from-pictures chained)
//   zsh -c 'source ~/.config/truefoundry/env && node ai/test/live-smoke.mjs plan edit'  just these
// Prints one line per step (model, time, tokens, cost, repaired?, a summary of the answer) and writes every answer to
// ai/research/live-smoke.json (answers and usage only; the key is never printed or written). Exit 1 if any step failed.
// refine gets a real run: the rube-goldberg scenario simulated by the local server (http://127.0.0.1:8790), when it is up.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runStep } from "../steps.mjs"
import { planFromScene } from "../schemas.mjs"
import { getCatalog } from "../catalog-digest.mjs"
import { scrub } from "../core.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = dirname(dirname(HERE))
if (!process.env.TRUEFOUNDRY_API_KEY) {
	console.error("TRUEFOUNDRY_API_KEY is not set: run through zsh -c 'source ~/.config/truefoundry/env && node ai/test/live-smoke.mjs'")
	process.exit(2)
}
const want = new Set(process.argv.slice(2))
const on = (s) => !want.size || want.has(s)
const scenario = (id) => JSON.parse(readFileSync(join(PG, "web", "scenarios", `${id}.json`), "utf8"))
const IMG = "data:image/jpeg;base64," + readFileSync(join(HERE, "fixtures", "ramp-ball-cup.jpg")).toString("base64")

async function realRun(scene) {
	try {
		const r = await fetch("http://127.0.0.1:8790/api/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene }), signal: AbortSignal.timeout(60000) })
		if (!r.ok) return null
		const s = await r.json()
		return { summary: s.summary, warnings: s.warnings }
	} catch {
		return null
	}
}

const summarise = {
	observe: (r) => `${r.objects.length} objects (${r.objects.map((o) => o.label).join(", ")}); camera ${r.view.camera}`,
	plan: (r) => `"${r.title}": ${r.items.map((i) => `${i.id}:${i.type}`).join(", ")}; missing ${r.missing.length}; goals ${r.goals.length}; tune ${r.tune.length}; ${r.seconds} s`,
	refine: (r) => `done ${r.done}, score ${r.score_0_10}, ${r.issues.length} issues, ${r.patches.length} patches (${r.patches.map((p) => p.op).join(", ")})`,
	edit: (r) => `${r.mode}: ${r.mode === "patch" ? r.patches.map((p) => `${p.op} ${p.id ?? p.item?.id ?? ""}`).join(", ") : r.plan.title} | "${r.reply}"`
}

const results = []
async function one(label, step, payload) {
	const t0 = Date.now()
	try {
		const out = await runStep(step, payload)
		const u = out.usage ?? {}
		const row = { label, step, ok: true, model: out.model, servedModel: out.servedModel, ms: out.ms, prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, cache_read: u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0, costUSD: u.costInUSD, repaired: !!out.repaired, attempts: out.attempts, warnings: out.warnings, result: out.result }
		results.push(row)
		console.log(`OK   ${label.padEnd(16)} ${out.model.padEnd(32)} ${String(out.ms).padStart(6)} ms  in ${u.prompt_tokens ?? "?"} (cached ${row.cache_read}) out ${u.completion_tokens ?? "?"}  $${(u.costInUSD ?? 0).toFixed(4)}${out.repaired ? "  REPAIRED" : ""}${out.warnings.length ? `  ${out.warnings.length} warnings` : ""}\n     ${summarise[step](out.result)}`)
		for (const a of out.attempts) if (a.error) console.log(`       attempt ${a.model}${a.repair ? " (repair)" : ""}: ${a.error.slice(0, 600)}`)
		return out
	} catch (e) {
		results.push({ label, step, ok: false, ms: Date.now() - t0, code: e.code, error: e.message, attempts: e.attempts, details: e.details })
		console.log(`FAIL ${label.padEnd(16)} ${e.code ?? "error"} after ${Date.now() - t0} ms: ${scrub(String(e.message)).slice(0, 400)}`)
		for (const a of e.attempts ?? []) console.log(`       ${a.model} ${a.status ?? ""} ${a.ms} ms ${a.error ?? (a.ok ? "ok" : "")}`)
		return null
	}
}

const cat = await getCatalog()
console.log(`catalog ${cat.source} ${cat.fingerprint}: ${cat.stats.types} types, ~${cat.stats.tokens} tokens (full), ~${cat.stats.briefTokens} (brief)\n`)
const rg = scenario("rube-goldberg")
const jobs = []
if (on("observe") || on("plan-from-pictures"))
	jobs.push(
		(async () => {
			const obs = await one("observe", "observe", { text: "The red ball should roll down the ramp and land in the cup.", images: [{ data: IMG, label: "side view" }] })
			if (obs && on("plan-from-pictures")) await one("plan-from-pictures", "plan", { text: "Build this: the red ball rolls down the ramp and lands in the cup.", observation: obs.result, images: [{ data: IMG, label: "side view" }] })
		})()
	)
if (on("plan")) jobs.push(one("plan", "plan", { text: "A golf ball rolls down a ramp, knocks over five dominoes, and the last domino pushes a marble off the table edge into a bucket. My cat watches." }))
if (on("refine"))
	jobs.push(
		(async () => {
			const sim = await realRun(rg)
			await one("refine", "refine", { text: "A Rube Goldberg machine: a superball rolls down two ramps, topples a row of growing dominoes, and the last one hits a seesaw that flings a ball into a hanging box.", plan: planFromScene(rg, cat.index), scene: rg, sim: sim ?? undefined, round: 1, rounds: 3 })
		})()
	)
if (on("edit")) jobs.push(one("edit", "edit", { text: "Make ball 1 a tennis ball, and add a cup on the table about 30 cm left of the seesaw.", scene: rg, history: [] }))
await Promise.all(jobs)

mkdirSync(join(PG, "ai", "research"), { recursive: true })
writeFileSync(join(PG, "ai", "research", "live-smoke.json"), scrub(JSON.stringify({ at: new Date().toISOString(), catalog: { fingerprint: cat.fingerprint, ...cat.stats }, results }, null, 1)))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps ok; answers in ai/research/live-smoke.json`)
process.exit(failed.length ? 1 : 0)
