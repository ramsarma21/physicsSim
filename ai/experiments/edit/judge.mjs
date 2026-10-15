#!/usr/bin/env node
// A blinded LLM judge for edit results, with real renders (the app's own critique camera, web/ai/shot.js, in a HEADLESS Chromium via
// ai/bench/lib/render.mjs): the scene before, the scene after (start and end of its run), the exact change list, the run's outcomes before and
// after, and the reply. It never sees which arm made the result. A secondary measure next to the hard checks (lib/check.mjs).
//   zsh -c 'source ~/.config/truefoundry/env && node ai/experiments/edit/judge.mjs --run r1 --arms base,n2 [--cases ...]'
// Writes <OUT>/<run>/<arm>/<case>.judge.json; prints a table.
import fs from "node:fs"
import path from "node:path"
import { CASES } from "./cases.mjs"
import { OUT, SUMMARY, frozen } from "./lib/env.mjs"
import { simPool, withSlot } from "./lib/pool.mjs"
import { prepareCase } from "./lib/check.mjs"
import { exactDiff } from "./lib/verify.mjs"

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) (argv[i + 1] === undefined || argv[i + 1].startsWith("--") ? (opt[argv[i].slice(2)] = true) : ((opt[argv[i].slice(2)] = argv[i + 1]), i++))
const list = (v) => (v === undefined || v === true ? null : String(v).split(",").filter(Boolean))
const RUN = String(opt.run ?? "r1")
const ARMS = list(opt.arms) ?? ["base", "n2"]
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)

const SYSTEM = `You are a strict, impartial judge of follow-up EDITS in a physics sandbox (real rigid-body physics in one vertical plane; a fixed library of catalog items with true sizes). A user had a scene on screen and asked for something in chat. An assistant answered (with a reply) and possibly changed the scene. You see: the request (and earlier turns), pictures of the scene BEFORE and AFTER (the after scene at the start and at the end of its physics run), the app's exact list of everything that changed (item by item, computed, trustworthy), the run's outcomes before and after, and the reply the user read.
Two see-through safety walls at the table's ends are scenery: ignore them.
Score 0-10 each:
- fidelity: exactly the change asked for, on the item(s) the user meant (colours and looks identify items), by the right amount and direction. A question or a hypothetical must change nothing (10 if nothing changed and it is answered). A request that does not say which of several look-alikes it means is best answered with a short question and no change (10); guessing one is at most 5.
- kept: nothing the user did not ask about changed (things resting on a moved item moving with it, a swapped item re-seated on its support, and a neighbour moved the least to make room — said in the reply — are fine). For "make it work (again)" requests, changes that serve that are fine, but the user's chosen objects must stay.
- works_or_told: the machine still does what it did (or, for "make it work", now works); when the change made an outcome stop, the reply tells the user plainly (10) — an outcome silently lost is 0-3.
- reply: clear, short, honest, matches what actually changed and happened.
- overall: your single score for how good this answer is for the user.
Answer ONE JSON object only: {"fidelity": n, "kept": n, "works_or_told": n, "reply": n, "overall": n, "issues": ["short, concrete, most important first (≤ 4)"]}`

let rendererP = null
const renderer = () => (rendererP ??= import("../../bench/lib/render.mjs").then((m) => m.createRenderer({ pages: 2 })))
const shotsCache = new Map()
async function shots(key, scene, goalsOf) {
	if (shotsCache.has(key)) return shotsCache.get(key)
	const p = (async () => {
		const s = JSON.parse(JSON.stringify(scene))
		const sim = await simPool().simulate(s)
		const r = await renderer()
		const out = (await r.render(sim, s)).shots
		return { shots: out, sim, goals: goalsOf ? goalsOf(sim) : null }
	})()
	shotsCache.set(key, p)
	return p
}
const pick = (ss, label) => ss.find((s) => s.label === label) ?? null

async function judgeOne(arm, c) {
	const file = path.join(OUT, RUN, arm, `${c.id}.json`)
	const jf = file.replace(/\.json$/, ".judge.json")
	if (!fs.existsSync(file)) return null
	if (!opt.force && fs.existsSync(jf)) return JSON.parse(fs.readFileSync(jf, "utf8"))
	const rec = JSON.parse(fs.readFileSync(file, "utf8"))
	const F = await frozen()
	const B = await prepareCase(c)
	const checksOf = (sim) => F.goals.checkGoals(B.checks, { doc: sim.doc, track: sim.track, summary: sim.summary })
	const before = await shots(`base:${JSON.stringify(c.base)}`, B.scene, checksOf)
	const after = rec.scene ? await shots(`${arm}:${c.id}`, rec.scene, checksOf) : before
	const diff = rec.scene ? await exactDiff(B.scene, rec.scene) : []
	const imgs = []
	const pics = []
	const add = (s, words) => {
		if (!s) return
		imgs.push(s.dataUrl)
		pics.push(`picture ${imgs.length - 1}: ${words} (t = ${Number(s.t ?? 0).toFixed(2)} s)`)
	}
	const sb = before.shots ?? []
	const sa = after.shots ?? []
	add(sb[0], "BEFORE the request, at the start")
	add(sa[0], rec.scene ? "AFTER, at the start" : "AFTER (nothing changed), at the start")
	add(sa.find((s) => /end/i.test(s.label ?? "")) ?? sa.at(-1), "AFTER, at the end of its run")
	const outcome = (r) => r.map((g) => `${g.ok === true ? "happens" : "does NOT happen"}: ${g.label}${g.detail ? ` (${g.detail})` : ""}`).join("; ") || "(none tracked)"
	const content = [
		c.history?.length ? `# Earlier turns\n${c.history.map((h) => `${h.role}: ${h.text}`).join("\n")}` : null,
		`# The request\n"""\n${c.text}\n"""`,
		`# Everything that changed in the scene (exact)\n${diff.length ? diff.map((d) => `- ${d}`).join("\n") : "(nothing changed)"}`,
		`# Outcomes in the run\nBefore: ${outcome(before.goals)}\nAfter: ${outcome(after.goals)}`,
		`# The reply the user read\n"""\n${rec.reply ?? ""}\n"""${rec.notes?.length ? `\nOther notes on its card: ${rec.notes.join("; ")}` : ""}`,
		`# Pictures\n${pics.join("; ")}.`,
		"Judge it and answer as one JSON object."
	].filter(Boolean).join("\n\n")
	const routing = { version: 2, defaults: { retries: 2, backoffMs: 1500, maxBackoffMs: 20000, timeoutMs: 180000, budgetMs: 400000, minAttemptMs: 8000, idleTimeoutMs: 90000 }, models: { "claude-group/claude-opus-5-5": { family: "claude", vision: true, cache: true, drop: ["temperature", "top_p"], stream: true } }, steps: { judge: { model: "claude-group/claude-opus-5-5", fallbacks: [], params: { max_tokens: 8000, reasoning_effort: "medium" }, timeoutMs: 180000, budgetMs: 400000, retries: 2, stream: true, needsVision: true } } }
	const keys = ["fidelity", "kept", "works_or_told", "reply", "overall"]
	const validate = (v) => {
		const errors = keys.filter((k) => !(typeof v?.[k] === "number" && v[k] >= 0 && v[k] <= 10)).map((k) => `${k} must be 0-10`)
		return { ok: !errors.length, errors, warnings: [], value: v }
	}
	try {
		const out = await withSlot(() => F.core.callModel("judge", { system: SYSTEM, content, images: imgs, routing, fetch: F.fetchH1, validate }))
		const j = { case: c.id, arm, ...out.result, ms: out.ms, cost: out.usage?.costInUSD ?? 0 }
		fs.writeFileSync(jf, JSON.stringify(j, null, 1))
		log(`judge ${arm} ${c.id}: ${j.overall} (fid ${j.fidelity}, kept ${j.kept}, works ${j.works_or_told}) ${j.issues?.[0] ?? ""}`.slice(0, 300))
		return j
	} catch (e) {
		log(`judge ${arm} ${c.id}: ERROR ${e.message}`)
		return null
	}
}

let cases = CASES
if (list(opt.cases)) cases = cases.filter((c) => list(opt.cases).includes(c.id))
if (opt.cat) cases = cases.filter((c) => list(opt.cat).includes(c.cat))
const grid = []
for (const c of cases) for (const a of ARMS) grid.push([a, c])
let i = 0
const results = []
await Promise.all(Array.from({ length: Number(opt.jobs ?? 6) }, async () => {
	while (i < grid.length) {
		const [a, c] = grid[i++]
		const j = await judgeOne(a, c)
		if (j) results.push(j)
	}
}))
const mean = (xs) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : NaN)
const rows = ARMS.map((a) => {
	const js = results.filter((r) => r.arm === a)
	return { arm: a, n: js.length, overall: mean(js.map((j) => j.overall)), fidelity: mean(js.map((j) => j.fidelity)), kept: mean(js.map((j) => j.kept)), works_or_told: mean(js.map((j) => j.works_or_told)), reply: mean(js.map((j) => j.reply)), low: js.filter((j) => j.overall <= 5).length }
})
console.log("| arm | n | overall | fidelity | kept | works_or_told | reply | overall ≤ 5 |\n|---|---|---|---|---|---|---|---|")
for (const r of rows) console.log(`| ${r.arm} | ${r.n} | ${r.overall.toFixed(2)} | ${r.fidelity.toFixed(2)} | ${r.kept.toFixed(2)} | ${r.works_or_told.toFixed(2)} | ${r.reply.toFixed(2)} | ${r.low} |`)
fs.mkdirSync(SUMMARY, { recursive: true })
fs.writeFileSync(path.join(SUMMARY, `${RUN}-judge.json`), JSON.stringify({ run: RUN, arms: ARMS, rows, at: new Date().toISOString() }, null, 1))
if (rendererP) (await rendererP).close()
process.exit(0)
