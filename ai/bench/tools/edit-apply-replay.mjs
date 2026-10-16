#!/usr/bin/env node
// The application replay (round-3 plan §6, it decides §4.2 (3)): the STORED n7 edit answers (the shipped server step's first answer of each
// case, from the integrated runs, benchmark §14) applied two ways, with NO model calls:
//   live  the live browser application: web/ai/orchestrator.js in mode "edit", called as the panel calls it (./edit-live.mjs runCase), its
//         api() answering the edit step with the stored answer (applyPatches, pinUntouched / restoreExact, riders, editScope, room-making, one
//         solve + run; for a request that states the outcome, the fix search inside the build as the app does it);
//   v3    ai/experiments/edit/integrate/apply-edit.js (pin the rest byte for byte, swaps keep their seat, what rests on or hovers ≤ 6 cm above
//         a moved thing follows, a changed thing inside a safety wall slides off, the overlaps returned), on the same client's solver and engine.
// Both scored with the experiment's hard checks (ai/experiments/edit/lib/check.mjs, read-only) without the grader ("says why" is not graded:
// the mechanical pass leaves it out, and the goals each one loses are counted instead). Per case: which checks each fails, the items where the
// two scenes differ, and which v3 behaviours acted on those items. The summary names the v3 behaviours the live application fails, with cases.
//   node ai/bench/tools/edit-apply-replay.mjs --client <dir> [--from i1,i2] [--cases a,b] [--cat swap] [--jobs 8] [--out <dir>] [--verdict <file.md>]
//   node ai/bench/tools/edit-apply-replay.mjs --summary [--from i1,i2] [--out <dir>] [--verdict <file.md>]      (tables only, from stored replays)
// --from: runs of the integrated n7 records ($EDIT_N7_OUT, default this session's scratchpad n7int/results; each <run>/n7/<case>.json).
// The repair turn after new overlaps (§4.2 (4)) and the fix rounds (§4.2 (6)) are model turns: not replayed (only the first answer is).
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { setup, runCase, N7_OUT, SCRATCH, REPO, clone, log, writeJson, readJson, parseArgs, list, clientHashes } from "./edit-live.mjs"

const opt = parseArgs(process.argv.slice(2))
const OUT = path.resolve(String(opt.out ?? path.join(SCRATCH, "partB", "B", "replay")))
const FROM = list(opt.from) ?? ["i1", "i2"]
const EXP = path.join(REPO, "ai", "experiments", "edit")
const HARD = ["exact", "untouched", "extra", "overlap", "noChange", "ask", "answer", "reply"]
const SHOWN = ["exact", "untouched", "untouched_byte", "extra", "overlap", "noChange", "ask", "answer"]
const mechPass = (ev) => !!ev && !ev.checks?.error && HARD.every((k) => ev.checks?.[k] !== false)
const fails = (ev) => (ev?.checks?.error === false ? ["error"] : SHOWN.filter((k) => ev?.checks?.[k] === false))

// ---------------------------------------------------------------- v3 on one answer
const idsOf = (p) => (Array.isArray(p?.ids) ? p.ids : p?.id !== undefined ? [p.id] : [])
const SIZE_KEYS = new Set(["diameter", "width", "height", "length", "thickness", "wall", "depth", "count", "first_height", "growth", "spacing", "radius", "size", "scale", "bob_diameter"])
function v3Apply(S, applyEdit, B, ans) {
	const { solver, ORCH, sim } = S.v3deps
	const patches = Array.isArray(ans?.patches) ? ans.patches : []
	if (ans?.mode === "new" || !patches.length || ans?.undo === true) return { scene: null, reply: String(ans?.reply ?? ""), notes: [], behaviours: [], replyOnly: true }
	const r = applyEdit({ scene: B.scene, plan: B.plan }, patches, { solve: solver.solve, planFromScene: solver.planFromScene, isStaticItem: solver.isStaticItem, applyPatches: ORCH.applyPatches, digestScene: ORCH.digestScene, layout: (s) => sim.layout(s) })
	if (r.error) return { scene: null, reply: `${ans.reply ?? ""} (Couldn't place it: ${r.error})`, notes: [r.error], behaviours: [{ b: "error", ids: [] }], error: r.error }
	// which of its behaviours acted here (for the attribution of a difference)
	const d0 = ORCH.digestScene(B.scene)
	const rests = new Map(d0.items.map((x) => [x.id, x.rests_on && !/^(nothing|held)/.test(x.rests_on) ? x.rests_on : null]))
	const given = new Set(patches.flatMap((p) => (Array.isArray(p?.ids) && p.id === undefined ? p.ids.map((id) => JSON.stringify({ ...p, ids: undefined, id })) : [JSON.stringify(p)])))
	const added = (r.patches ?? []).filter((p) => !given.has(JSON.stringify(p)))
	const seatIds = new Set(patches.filter((p) => p.op === "replace_type" || (["set_props", "props"].includes(p.op) && Object.keys(p.props ?? p.set ?? {}).some((k) => SIZE_KEYS.has(k)))).flatMap(idsOf))
	const movedIds = new Set(patches.filter((p) => p.op === "move" && (typeof p.dx === "number" || typeof p.dy === "number")).flatMap(idsOf))
	const B_ = []
	const seat = added.filter((p) => p.op === "set_place" && seatIds.has(p.id)).map((p) => p.id)
	if (seat.length) B_.push({ b: "swap/resize keeps its seat (same support and x; held: lowest point kept)", ids: seat })
	const hover = (r.followers ?? []).filter((id) => !rests.get(id) && !seatIds.has(id))
	const rideFollow = (r.followers ?? []).filter((id) => rests.get(id) && movedIds.has(rests.get(id)))
	const reseatOn = (r.followers ?? []).filter((id) => rests.get(id) && !movedIds.has(rests.get(id)) && !hover.includes(id))
	if (hover.length) B_.push({ b: "a thing held ≤ 6 cm above a moved thing follows it", ids: hover })
	if (rideFollow.length) B_.push({ b: "what rests on a moved thing follows it", ids: rideFollow })
	if (reseatOn.length) B_.push({ b: "what rests on a changed thing is re-seated on it", ids: reseatOn })
	if ((r.dependents ?? []).length) B_.push({ b: "what refers to a changed thing in its plan place follows it", ids: r.dependents })
	const wall = (r.madeRoom ?? []).filter((t) => /safety wall/.test(t))
	if (wall.length) B_.push({ b: "a changed thing inside a safety wall slides off it", ids: wall.map((t) => t.replace(/ slid .*$/, "")), words: wall })
	const room = (r.madeRoom ?? []).filter((t) => /to make room/.test(t))
	if (room.length) B_.push({ b: "a pinned neighbour the change overlaps is let go (the solver's least move)", ids: room.map((t) => t.replace(/ moved .*$/, "")), words: room })
	if ((r.overlaps ?? []).length) B_.push({ b: "new start-up overlaps left (the repair turn's job)", ids: r.overlaps.flatMap((w) => w.items ?? []), words: r.overlaps.map((w) => w.text) })
	return { scene: r.scene, reply: [ans.reply, ...(r.madeRoom ?? [])].filter(Boolean).join(" "), notes: [...(r.madeRoom ?? []), ...(r.skipped ?? []).map((s) => `Not done: ${s}`)], behaviours: B_, pinned: (r.pinned ?? []).length, overlaps: (r.overlaps ?? []).map((w) => w.text) }
}

/** The items where two final scenes differ at all (any type, prop, held or fixed difference; a pose to 0.001 mm), the pose in mm. */
function sceneDiff(itemDiff, a, b) {
	const A = new Map((a?.items ?? []).map((i) => [i.id, i]))
	const Bm = new Map((b?.items ?? []).map((i) => [i.id, i]))
	const out = []
	const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
	for (const id of new Set([...A.keys(), ...Bm.keys()])) {
		const x = A.get(id)
		const y = Bm.get(id)
		if (!x || !y) {
			out.push({ id, d: !x ? "only in v3" : "only in live" })
			continue
		}
		const bits = []
		const other = itemDiff({ ...x, x: 0, y: 0, angle: 0 }, { ...y, x: 0, y: 0, angle: 0 })
		if (other) bits.push(other)
		const dx = (n(y.x) - n(x.x)) * 1000
		const dy = (n(y.y) - n(x.y)) * 1000
		const da = n(y.angle) - n(x.angle)
		if (Math.abs(dx) > 1e-3 || Math.abs(dy) > 1e-3) bits.push(`moved (${dx.toFixed(2)}, ${dy.toFixed(2)}) mm`)
		if (Math.abs(da) > 1e-4) bits.push(`turned ${da.toFixed(3)}°`)
		if (bits.length) out.push({ id, d: `live → v3: ${bits.join(", ")}`, mm: Math.max(Math.abs(dx), Math.abs(dy)), other: !!other })
	}
	for (const k of ["seconds", "release"]) if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push({ id: `scene.${k}`, d: `live ${a?.[k]} → v3 ${b?.[k]}` })
	return out
}

// ---------------------------------------------------------------- the summary and the verdict text
function summarize(recs) {
	const md = []
	const nonFix = recs.filter((r) => r.cat !== "fix")
	const fix = recs.filter((r) => r.cat === "fix")
	const count = (rs, side, k) => {
		const xs = rs.filter((r) => r[side]?.eval?.checks?.[k] !== undefined && r[side]?.eval?.checks?.[k] !== null)
		return `${xs.filter((r) => r[side].eval.checks[k] !== false).length}/${xs.length}`
	}
	const lost = (rs, side) => rs.reduce((s, r) => s + (r[side]?.eval?.lost?.length ?? 0), 0)
	md.push(`| application | replays | mechanical pass (all hard checks but "says why") | ${SHOWN.join(" | ")} | goals lost (sum) | edits that lose a goal |`)
	md.push(`|---|---|---|${SHOWN.map(() => "---").join("|")}|---|---|`)
	for (const [name, rs] of [["non-fix", nonFix], ["fix (make it work: not like for like)", fix]])
		for (const side of ["live", "v3"]) md.push(`| ${side} · ${name} | ${rs.length} | ${rs.filter((r) => mechPass(r[side]?.eval)).length}/${rs.length} | ${SHOWN.map((k) => count(rs, side, k)).join(" | ")} | ${lost(rs, side)} | ${rs.filter((r) => (r[side]?.eval?.lost?.length ?? 0) > 0).length} |`)
	// live fails, v3 passes: by the v3 behaviour that acted on the items where the two differ
	const liveWorse = nonFix.filter((r) => !mechPass(r.live?.eval) && mechPass(r.v3?.eval))
	const v3Worse = nonFix.filter((r) => mechPass(r.live?.eval) && !mechPass(r.v3?.eval))
	const bothFail = nonFix.filter((r) => !mechPass(r.live?.eval) && !mechPass(r.v3?.eval))
	const byB = new Map()
	for (const r of liveWorse) {
		const diffIds = new Set(r.diff.map((d) => d.id))
		const hit = r.v3.behaviours.filter((x) => x.ids.some((id) => diffIds.has(id)) || (x.words ?? []).some((w) => [...diffIds].some((id) => w.includes(id))))
		const keys = hit.length ? hit.map((x) => x.b) : [r.diff.length && r.diff.every((d) => !d.other && (d.mm ?? 99) < 1) ? "(sub-millimetre: the two scenes differ by < 1 mm, the run diverges)" : `(no v3 behaviour on the differing items: ${[...diffIds].join(", ") || "same scene"})`]
		for (const k of keys) byB.set(k, [...(byB.get(k) ?? []), r])
	}
	md.push(`\n### The live application fails, v3 passes: ${liveWorse.length} of ${nonFix.length} non-fix replays (v3 fails where live passes: ${v3Worse.length}; both fail: ${bothFail.length})\n`)
	for (const [b, rs] of [...byB].sort((x, y) => y[1].length - x[1].length)) {
		md.push(`- **${b}**: ${rs.length} — ${[...new Set(rs.map((r) => r.case))].join(", ")}`)
		for (const r of rs) md.push(`  - ${r.case} (${r.from}): live fails ${fails(r.live.eval).join(", ")}: ${(r.live.eval.fail ?? []).join(" | ").slice(0, 260)} · differs: ${r.diff.map((d) => `${d.id} ${d.d}`).join("; ").slice(0, 260)}`)
	}
	// every v3 behaviour: how often it acted, and in how many of those the live application failed a check v3 passed
	const all = new Map()
	for (const r of nonFix) for (const x of r.v3?.behaviours ?? []) all.set(x.b, [...(all.get(x.b) ?? []), r])
	md.push(`\n### Each v3 behaviour: where it acted, and where live then fails a check v3 passes\n\n| v3 behaviour | acted in | live fails there (v3 passes) | cases where live fails |\n|---|---|---|---|`)
	for (const [b, rs] of [...all].sort((x, y) => y[1].length - x[1].length)) {
		const lw = (byB.get(b) ?? []).length
		md.push(`| ${b} | ${rs.length} | ${lw} | ${[...new Set((byB.get(b) ?? []).map((r) => r.case))].join(", ") || "–"} |`)
	}
	if (v3Worse.length) {
		md.push(`\n### v3 fails, the live application passes: ${v3Worse.length}\n`)
		for (const r of v3Worse) md.push(`- ${r.case} (${r.from}): v3 fails ${fails(r.v3.eval).join(", ")}: ${(r.v3.eval.fail ?? []).join(" | ").slice(0, 260)}${r.v3.behaviours.length ? ` · v3 did: ${r.v3.behaviours.map((x) => x.b).join("; ")}` : ""}`)
	}
	if (bothFail.length) {
		md.push(`\n### Both fail: ${bothFail.length}\n`)
		for (const r of bothFail) md.push(`- ${r.case} (${r.from}): live ${fails(r.live.eval).join(", ")} (${(r.live.eval.fail ?? []).join(" | ").slice(0, 160)}) · v3 ${fails(r.v3.eval).join(", ")} (${(r.v3.eval.fail ?? []).join(" | ").slice(0, 160)})`)
	}
	// goals lost: where live loses more than v3 on the same answer (the application, not the change, broke something)
	const moreLost = nonFix.filter((r) => (r.live?.eval?.lost?.length ?? 0) > (r.v3?.eval?.lost?.length ?? 0))
	const lessLost = nonFix.filter((r) => (r.live?.eval?.lost?.length ?? 0) < (r.v3?.eval?.lost?.length ?? 0))
	md.push(`\n### Goals lost by the application itself (same answer): live loses more in ${moreLost.length}, v3 loses more in ${lessLost.length}\n`)
	for (const r of moreLost) md.push(`- live loses more: ${r.case} (${r.from}): live ${JSON.stringify(r.live.eval.lost)} vs v3 ${JSON.stringify(r.v3.eval.lost)} · differs: ${r.diff.map((d) => `${d.id} ${d.d}`).join("; ").slice(0, 200)}`)
	for (const r of lessLost) md.push(`- v3 loses more: ${r.case} (${r.from}): v3 ${JSON.stringify(r.v3.eval.lost)} vs live ${JSON.stringify(r.live.eval.lost)} · differs: ${r.diff.map((d) => `${d.id} ${d.d}`).join("; ").slice(0, 200)}`)
	// byte-identity of what was not asked (untouched_byte), per side
	const byteLive = nonFix.filter((r) => r.live?.eval?.checks?.untouched_byte === false)
	const byteV3 = nonFix.filter((r) => r.v3?.eval?.checks?.untouched_byte === false)
	md.push(`\n### Untouched byte for byte: live misses in ${byteLive.length} (${byteLive.map((r) => r.case).join(", ") || "none"}), v3 in ${byteV3.length} (${byteV3.map((r) => r.case).join(", ") || "none"})`)
	// fix cases, for the record
	if (fix.length) {
		md.push(`\n### "Make it work" answers (the first answer only; live also runs its fix search, v3 here does not aim or tune: not like for like)\n`)
		for (const r of fix) md.push(`- ${r.case} (${r.from}): live ${r.live?.eval?.checks?.works === false ? "still fails" : "works"}${mechPass(r.live?.eval) ? "" : ` [${fails(r.live?.eval).join(", ")}]`}${r.live?.fixApplied ? ` (fix applied: ${r.live.fixApplied})` : ""} · v3 ${r.v3?.eval?.checks?.works === false ? "still fails" : "works"}${mechPass(r.v3?.eval) ? "" : ` [${fails(r.v3?.eval).join(", ")}]`}`)
	}
	return { md: md.join("\n"), liveWorse: [...byB].map(([b, rs]) => ({ behaviour: b, cases: [...new Set(rs.map((r) => r.case))], n: rs.length })), v3Worse: v3Worse.map((r) => r.case), bothFail: bothFail.map((r) => r.case) }
}

// ---------------------------------------------------------------- main
const loadReplays = () =>
	FROM.flatMap((run) => {
		const d = path.join(OUT, run)
		return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json") && f !== "run.json").map((f) => readJson(path.join(d, f))) : []
	})
function writeSummary() {
	const recs = loadReplays()
	const s = summarize(recs)
	const head = `## Apply replay: the stored n7 answers (${FROM.join(" + ")}, ${recs.length} replays), live application vs apply-edit.js v3\n`
	console.log(head + "\n" + s.md)
	writeJson(path.join(OUT, "summary.json"), { at: new Date().toISOString(), from: FROM, n: recs.length, liveWorse: s.liveWorse, v3Worse: s.v3Worse, bothFail: s.bothFail })
	fs.writeFileSync(path.join(OUT, "summary.md"), head + "\n" + s.md + "\n")
	return { head, ...s }
}

if (opt.summary) {
	writeSummary()
	process.exit(0)
}
const S = await setup({ client: opt.client ?? null, scoreEnv: opt["score-env"] ?? null })
const web = S.web
S.v3deps = { solver: await import(pathToFileURL(path.join(web, "ai", "solver.js")).href), ORCH: S.ORCH, sim: await import(pathToFileURL(path.join(web, "sim", "index.js")).href) }
const { applyEdit } = await import(pathToFileURL(path.join(EXP, "integrate", "apply-edit.js")).href)
const { itemDiff } = await import(pathToFileURL(path.join(EXP, "lib", "check.mjs")).href)
let cs = S.CASES
if (list(opt.cases)) cs = cs.filter((c) => list(opt.cases).includes(c.id))
if (list(opt.cat)) cs = cs.filter((c) => list(opt.cat).includes(c.cat))
const meta = { at: new Date().toISOString(), client: web, clientHashes: clientHashes(web), scoreEnv: S.env, from: FROM, n7: N7_OUT }
for (const run of FROM) writeJson(path.join(OUT, run, "run.json"), meta)
const grid = FROM.flatMap((run) => cs.map((c) => ({ run, c })))
log(`replay: ${grid.length} stored answers (${FROM.join(", ")}) × {live, v3}, the client in ${web}; no model calls`)
let i = 0
let done = 0
await Promise.all(
	Array.from({ length: Number(opt.jobs ?? 8) }, async () => {
		while (i < grid.length) {
			const { run, c } = grid[i++]
			const file = path.join(OUT, run, `${c.id}.json`)
			if (!opt.force && fs.existsSync(file)) continue
			const src = path.join(N7_OUT, run, "n7", `${c.id}.json`)
			if (!fs.existsSync(src)) continue
			const stored = readJson(src)
			const ans = (stored.answers ?? []).find((a) => a.step === "edit")?.result
			if (!ans) continue
			const B = await S.prepareCase(c)
			// live: the orchestrator, its edit step answered with the stored answer
			const L = await runCase(S, c, `replay-${run}`, { fixSearch: false, stored: { edit: ans } })
			// v3: the experiment's application of the same answer
			let V
			try {
				const v = v3Apply(S, applyEdit, B, ans)
				V = { ...v, eval: await S.evaluate(c, B, { scene: v.scene, reply: v.reply, notes: v.notes }, { grade: false }) }
			} catch (e) {
				V = { error: String(e?.message ?? e), behaviours: [], eval: { pass: false, checks: { error: false }, fail: [`error: ${String(e?.message ?? e).slice(0, 200)}`] } }
			}
			const rec = {
				case: c.id,
				cat: c.cat,
				from: run,
				text: c.text,
				kind: ans.kind ?? null,
				patches: ans.patches ?? [],
				live: { eval: L.eval, ms: L.ms, error: L.error ?? null, replyOnly: !!L.report?.replyOnly, reply: L.reply, fixApplied: L.report?.fixApplied?.did ?? null, scene: L.scene },
				v3: { eval: V.eval, behaviours: V.behaviours, error: V.error ?? null, pinned: V.pinned ?? null, overlaps: V.overlaps ?? [], scene: V.scene },
				diff: sceneDiff(itemDiff, L.scene ?? B.scene, V.scene ?? B.scene)
			}
			writeJson(file, rec)
			done++
			const lp = mechPass(L.eval)
			const vp = mechPass(V.eval)
			if (lp !== vp || done % 20 === 0) log(`${run} ${c.id}: live ${lp ? "pass" : `FAIL [${fails(L.eval).join(",")}]`} · v3 ${vp ? "pass" : `FAIL [${fails(V.eval).join(",")}]`}${rec.diff.length ? ` · differs on ${rec.diff.map((d) => d.id).join(",")}` : ""} (${done} done)`)
		}
	})
)
const s = writeSummary()
if (opt.verdict && opt.verdict !== true) fs.writeFileSync(path.resolve(String(opt.verdict)), `${s.head}\n${s.md}\n`)
process.exit(0)
