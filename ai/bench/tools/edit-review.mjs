// The review's adversarial edit requests (ai/bench/cases/edit-review.mjs) end to end through the browser contract's reference code:
// ai/browser/edit-path.js runEdit (applyEdit v4, the one repair turn, the heads-up, the aim rule) with every edit call made to the running
// local server, POST /api/ai/edit with intent "edit" as the drawer sends it (the shipped ai/: prompt, digest, validator), and every run made by
// ai/steps.mjs runScene (the same run as /api/simulate). One JSON per case under --out (default: $EDIT_REVIEW_OUT, else a temp dir); the
// summary: node ai/bench/tools/edit-review.mjs --report [--out dir]. ai/research/benchmark.md §15.
//   node ai/bench/tools/edit-review.mjs [--only id,id] [--jobs 4] [--force] [--out dir]        (the server: web/server.py on :8790, or $AI_SERVER)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..")
const argv = process.argv.slice(2)
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const OUT = opt("out", process.env.EDIT_REVIEW_OUT || join(tmpdir(), "edit-review"))
mkdirSync(OUT, { recursive: true })
const imp = (r) => import(pathToFileURL(join(ROOT, r)).href)
const solver = await imp("web/ai/solver.js")
const orch = await imp("web/ai/orchestrator.js")
const sim = await imp("web/sim/index.js")
const steps = await imp("ai/steps.mjs")
const { applyEdit } = await imp("ai/browser/apply-edit.js")
const { runEdit } = await imp("ai/browser/edit-path.js")
const applyDeps = { solve: solver.solve, planFromScene: solver.planFromScene, isStaticItem: solver.isStaticItem, applyPatches: orch.applyPatches, digestScene: orch.digestScene, layout: (s) => sim.layout(s) }
const { CASES } = await imp("ai/bench/cases/edit-review.mjs")
const SERVER = process.env.AI_SERVER || "http://localhost:8790"
const only = opt("only", null)?.split(",")
const jobs = +opt("jobs", 4)
const force = argv.includes("--force")

function loadBase(key) {
	if (key.startsWith("ai:")) {
		const r = JSON.parse(readFileSync(join(ROOT, "ai/bench/results/ab4/pipeline-new/app", key.slice(3) + ".json"), "utf8"))
		return { scene: r.scene, plan: r.plan }
	}
	return { scene: JSON.parse(readFileSync(join(ROOT, "web/scenarios", key + ".json"), "utf8")), plan: null }
}
const goalsOf = (sum) => (sum?.goals ?? []).map((g) => `${g.ok ? "MET" : "FAILED"}: ${g.label ?? g.item + "→" + g.container}`)
function diff(a, b) {
	const out = []
	const A = new Map(a.items.map((i) => [i.id, i]))
	const B = new Map(b.items.map((i) => [i.id, i]))
	for (const [id, x] of A) {
		const y = B.get(id)
		if (!y) {
			out.push(`REMOVED ${id}`)
			continue
		}
		if (JSON.stringify(x) === JSON.stringify(y)) continue
		const parts = []
		if (x.type !== y.type) parts.push(`type ${x.type}→${y.type}`)
		if (x.name !== y.name) parts.push(`name "${x.name}"→"${y.name}"`)
		for (const k of ["x", "y", "angle"]) if (Math.abs((x[k] ?? 0) - (y[k] ?? 0)) > 1e-6) parts.push(`${k} ${(+(x[k] ?? 0)).toFixed(4)}→${(+(y[k] ?? 0)).toFixed(4)} (Δ${((y[k] ?? 0) - (x[k] ?? 0)).toFixed(4)})`)
		const ks = new Set([...Object.keys(x.props ?? {}), ...Object.keys(y.props ?? {})])
		for (const k of ks) if (JSON.stringify(x.props?.[k]) !== JSON.stringify(y.props?.[k])) parts.push(`props.${k} ${JSON.stringify(x.props?.[k])}→${JSON.stringify(y.props?.[k])}`)
		for (const k of ["held", "fixed"]) if (x[k] !== y[k]) parts.push(`${k} ${x[k]}→${y[k]}`)
		out.push(`CHANGED ${id}: ${parts.join("; ") || "(other fields)"}`)
	}
	for (const [id, y] of B) if (!A.has(id)) out.push(`ADDED ${id}: ${y.type} "${y.name}" x ${(+y.x).toFixed(3)} y ${(+y.y).toFixed(3)} ${JSON.stringify(y.props ?? {})}`)
	for (const k of ["seconds", "release"]) if (a[k] !== b[k]) out.push(`SCENE ${k} ${a[k]}→${b[k]}`)
	return out
}

async function post(payload, acc) {
	const t0 = Date.now()
	for (let attempt = 0; attempt < 6; attempt++) {
		const r = await fetch(`${SERVER}/api/ai/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload, client: { requestId: `review-${Math.random().toString(36).slice(2, 10)}` } }) })
		const j = await r.json()
		if (r.status === 429) {
			await new Promise((res) => setTimeout(res, (j.retryAfterMs ?? 5000) + 500))
			continue
		}
		if (!j?.ok) throw new Error(`edit ${r.status}: ${JSON.stringify(j).slice(0, 300)}`)
		acc.push({ ms: Date.now() - t0, serverMs: j.ms, cost: j.usage?.costInUSD ?? 0, attempts: (j.attempts ?? []).length, warnings: j.warnings, feedback: !!payload.feedback, answer: { kind: j.result.kind, reply: j.result.reply, patches: j.result.patches, missing: j.result.missing, plan_missing: j.result.plan_missing, suggestions: j.result.suggestions, targets: j.result.targets, mode: j.result.mode } })
		return j.result
	}
	throw new Error("busy")
}

async function one(c) {
	const file = join(OUT, `${c.id}.json`)
	if (!force && existsSync(file)) return
	let base = loadBase(c.base)
	if (c.pre) {
		const r = applyEdit(base, c.pre, applyDeps)
		if (r.error) throw new Error(`pre: ${r.error}`)
		base = { scene: r.scene, plan: base.plan ? r.plan : null }
	}
	const goals0 = base.plan?.goals?.length ? base.plan.goals : base.scene.goals ?? []
	const withGoals = (s) => {
		const x = JSON.parse(JSON.stringify(s))
		const ids = new Set(x.items.map((i) => i.id))
		x.goals = (x.goals ?? []).filter((g) => ids.has(g.item) && ids.has(g.container))
		for (const g of goals0) if ((g.kind ?? "in") === "in" && ids.has(g.item) && ids.has(g.container) && !x.goals.some((q) => q.item === g.item && q.container === g.container)) x.goals.push({ kind: "in", item: g.item, container: g.container, label: g.label })
		return x
	}
	const run0 = await steps.runScene(withGoals(base.scene))
	const calls = []
	const t0 = Date.now()
	const deps = {
		edit: (payload) => post(payload, calls),
		simulate: (s) => steps.runScene(s),
		applyDeps,
		goalResults: orch.goalResults,
		lostStages: orch.lostStages,
		tune: orch.tune,
		goalDistance: orch.goalDistance,
		describeDiff: orch.describeDiff,
		propSpec: solver.propSpec,
		propDefault: solver.propDefault
	}
	const rec = { id: c.id, base: c.base, text: c.text, expect: c.expect }
	try {
		const out = await runEdit({ text: c.text, scene: base.scene, plan: base.plan, history: c.history ?? [], lastChange: c.pre ? { patches: c.pre } : undefined, sim: run0 }, deps)
		rec.ms = Date.now() - t0
		rec.kind = out.kind
		rec.reply = out.reply
		rec.replyOnly = out.replyOnly
		rec.calls = calls
		rec.cost = calls.reduce((s, x) => s + x.cost, 0)
		rec.steps = out.calls
		if (!out.replyOnly) {
			const run1 = await steps.runScene(withGoals(out.scene))
			rec.apply = { changes: diff(base.scene, out.scene), madeRoom: out.madeRoom, shortfalls: out.shortfalls, overlaps: (out.overlaps ?? []).map((w) => w.text ?? w), diffWords: out.diffWords, heads: out.heads, failing: out.failing, goalsBefore: goalsOf(run0.summary), goalsAfter: goalsOf(run1.summary) }
			rec.patches = out.answer?.patches
		} else rec.apply = { changes: [], goalsBefore: goalsOf(run0.summary) }
	} catch (e) {
		rec.error = String(e.stack ?? e)
	}
	writeFileSync(file, JSON.stringify(rec, null, 1))
	console.log(`${c.id}: ${rec.kind ?? "ERR"} ${((rec.ms ?? 0) / 1000).toFixed(1)}s $${(rec.cost ?? 0).toFixed(3)} calls ${calls.length} | ${rec.reply ?? rec.error?.slice(0, 200)} | ${(rec.apply?.changes ?? []).join(" || ").slice(0, 300)}`)
}
if (argv.includes("--report")) {
	const { readdirSync } = await import("node:fs")
	const recs = readdirSync(OUT).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(OUT, f), "utf8")))
	const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]
	const words = (t) => String(t ?? "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
	const ms = recs.map((r) => (r.ms ?? 0) / 1000)
	const cost = recs.map((r) => r.cost ?? 0)
	const kinds = {}
	for (const r of recs) kinds[r.kind ?? "error"] = (kinds[r.kind ?? "error"] ?? 0) + 1
	const modelReply = (r) => r.calls?.at(-1)?.answer?.reply ?? ""
	const out = {
		n: recs.length,
		kinds,
		p50_s: +q(ms, 0.5).toFixed(1),
		p90_s: +q(ms, 0.9).toFixed(1),
		cost_p50: +q(cost, 0.5).toFixed(3),
		cost_total: +cost.reduce((a, b) => a + b, 0).toFixed(2),
		validator_repairs: recs.filter((r) => (r.calls ?? []).some((c) => c.attempts > 1)).map((r) => r.id),
		repair_turns: recs.filter((r) => (r.calls ?? []).length > 1).map((r) => r.id),
		replies_over_40_words: recs.filter((r) => words(modelReply(r)) > 40).map((r) => `${r.id} (${words(modelReply(r))})`),
		with_overlaps: recs.filter((r) => r.apply?.overlaps?.length).map((r) => r.id),
		with_shortfalls: recs.filter((r) => r.apply?.shortfalls?.length).map((r) => r.id),
		with_missing: recs.filter((r) => (r.calls ?? []).some((c) => c.answer?.missing?.length)).map((r) => r.id),
		errors: recs.filter((r) => r.error).map((r) => r.id)
	}
	console.log(JSON.stringify(out, null, 1))
	process.exit(0)
}
let cs = CASES
if (only) cs = cs.filter((c) => only.includes(c.id))
let i = 0
await Promise.all(
	Array.from({ length: jobs }, async () => {
		while (i < cs.length) {
			const c = cs[i++]
			try {
				await one(c)
			} catch (e) {
				console.log(c.id, "HARNESS ERROR", e.stack)
			}
		}
	})
)
