// The focus camera's subject recognition (web/export/subjects.js) scored on hand labels: precision and recall of the primary subjects, scenery
// never framed, context never promoted, and the moments (setup, release, starts, events, stops, the result).
//   node --test web/export/test/subjects.test.mjs                    the scenes of this repository (built-in scenarios, gallery, module demos), run here
//   FOCUS_TESTSET=<subjects-testset.json> node --test ...            also the focus scout's whole labelled set (180 scenes: lesson lanes, pipeline
//                                                                    samples, demos), with the runs saved beside it (work/sims) and each caller's hints
// A scene is "all right" when no expected primary is missed and nothing labelled context, scenery or other comes out primary (scenery: nor context).
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"
import { recognize, registryOf, sceneFromSim } from "../subjects.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..")
const LABELS = JSON.parse(readFileSync(join(HERE, "subjects-labels.json"), "utf8"))

/** Score one recognizer answer against one labelled scene: {hard, miss, falseP, ctxProm, scenLeak, otherProm, P, OP, TP, moments, momentsHit}. */
export function score(lab, out) {
	const ids = (l) => new Set((l ?? []).map((x) => x.item))
	const P = ids(lab.primary)
	const E = ids(lab.either)
	const C = ids(lab.context)
	const S = ids(lab.scenery)
	const O = ids(lab.other)
	const OP = new Set(out.primary)
	const OC = new Set(out.context)
	const miss = [...P].filter((i) => !OP.has(i))
	const falseP = [...OP].filter((i) => !P.has(i) && !E.has(i))
	const ctxProm = [...C].filter((i) => OP.has(i))
	const scenLeak = [...S].filter((i) => OP.has(i) || OC.has(i))
	const otherProm = [...O].filter((i) => OP.has(i))
	const dur = lab.seconds ?? 4.5
	const lapse = (lab.lapse ?? 1) > 1
	const tol = (k) => (k === "result" ? Math.max(0.3, 0.05 * dur) : lapse ? Math.max(0.25, 0.04 * dur) : 0.25)
	const want = (lab.moments ?? []).filter((m) => ["setup", "release", "start", "stop", "event", "result"].includes(m.kind) && typeof m.t === "number" && !m.optional)
	const missed = want.filter(
		(m) =>
			!out.moments.some((o) => {
				if (o.kind !== m.kind) return false
				if (m.kind === "result") return o.t >= m.t - tol(m.kind) && o.t <= (m.t_max ?? m.t) + tol(m.kind)
				if (Math.abs(o.t - m.t) > tol(m.kind)) return false
				if ((m.kind === "start" || m.kind === "stop") && o.item !== m.item) return false
				if (m.kind === "event" && m.items?.length && !(o.items ?? []).some((i) => m.items.includes(i))) return false
				return true
			}),
	)
	return { hard: miss.length + falseP.length + ctxProm.length + scenLeak.length + otherProm.length, miss, falseP, ctxProm, scenLeak, otherProm, P: P.size, OP: OP.size, TP: OP.size - falseP.length, moments: want.length, momentsHit: want.length - missed.length, missed }
}
/** Totals over scored scenes: precision and recall of the primaries, and the rest. */
export function totals(rows) {
	const t = { scenes: rows.length, allRight: 0, primary: 0, found: 0, predicted: 0, correct: 0, falsePrimary: 0, contextPromoted: 0, sceneryLeaks: 0, otherPromoted: 0, moments: 0, momentsHit: 0 }
	for (const r of rows) {
		t.allRight += r.hard ? 0 : 1
		t.primary += r.P
		t.found += r.P - r.miss.length
		t.predicted += r.OP
		t.correct += r.TP
		t.falsePrimary += r.falseP.length
		t.contextPromoted += r.ctxProm.length
		t.sceneryLeaks += r.scenLeak.length
		t.otherPromoted += r.otherProm.length
		t.moments += r.moments
		t.momentsHit += r.momentsHit
	}
	t.recall = t.primary ? t.found / t.primary : 1
	t.precision = t.predicted ? t.correct / t.predicted : 1
	t.momentRecall = t.moments ? t.momentsHit / t.moments : 1
	return t
}
const line = (name, t) =>
	`${name}: ${t.scenes} scenes, ${t.allRight} all right; primaries recall ${(100 * t.recall).toFixed(1)} % (${t.found}/${t.primary}), precision ${(100 * t.precision).toFixed(1)} % (${t.correct}/${t.predicted}); context promoted ${t.contextPromoted}, scenery framed ${t.sceneryLeaks}, other promoted ${t.otherPromoted}; moments ${(100 * t.momentRecall).toFixed(1)} % (${t.momentsHit}/${t.moments})`
const misses = (rows) => rows.filter((r) => r.hard).map((r) => `${r.key}: miss [${r.miss}] false [${r.falseP}] ctx->primary [${r.ctxProm}] scenery [${r.scenLeak}] other [${r.otherProm}]`)

test("subjects: the repository's own scenes (run here), bare: no caller's hints", async () => {
	const { simulate, catalog, plugins } = await import("./sim-node.mjs")
	const cat = catalog()
	const registry = registryOf(plugins())
	assert.ok(Object.keys(registry).length > 50, "the physics modules' goal kinds are registered")
	const fixtures = new Map()
	const sceneOf = (source) => {
		const [path, id] = source.split("#")
		if (!fixtures.has(path)) fixtures.set(path, JSON.parse(readFileSync(join(ROOT, path), "utf8")))
		const f = fixtures.get(path)
		return id ? f.find((s) => s.id === id) : f
	}
	const rows = []
	const derived = []
	for (const lab of LABELS.scenes) {
		const scene = sceneOf(lab.source)
		assert.ok(scene, `${lab.key}: ${lab.source} is in the repository`)
		const run = simulate(scene)
		const out = recognize({ scene, run, catalog: cat, registry, hints: {} })
		rows.push({ key: lab.key, split: lab.split, ...score(lab, out) })
		// as a caller that has only the run (the compositor loads runs into the view without their scenes)
		const outD = recognize({ scene: sceneFromSim(run), run, catalog: cat, registry, hints: {} })
		derived.push({ key: lab.key, split: lab.split, ...score(lab, outD) })
		// pure: the same answer again
		assert.deepEqual(recognize({ scene, run, catalog: cat, registry, hints: {} }), out, `${lab.key}: the same input gives the same answer`)
	}
	const all = totals(rows)
	console.log(line("repository scenes", all))
	for (const split of ["tune", "heldout", "fresh"]) console.log("  " + line(split, totals(rows.filter((r) => r.split === split))))
	for (const m of misses(rows)) console.log("    " + m)
	const d = totals(derived)
	console.log(line("repository scenes, the scene read from its run (sceneFromSim)", d))
	for (const m of misses(derived)) console.log("    " + m)
	// (measured 20 Oct 2026 on these 49 scenes: the bars sit just under it, so a change that loses subjects fails)
	assert.ok(all.recall >= 0.98, `primary recall ${all.recall}`)
	assert.ok(all.precision >= 0.97, `primary precision ${all.precision}`)
	assert.ok(all.sceneryLeaks <= 3, `scenery framed ${all.sceneryLeaks}`)
	assert.ok(all.contextPromoted <= 2, `context promoted ${all.contextPromoted}`)
	assert.ok(all.momentRecall >= 0.97, `moments ${all.momentRecall}`)
	assert.ok(all.allRight >= all.scenes - 4, `${all.allRight} of ${all.scenes} scenes all right`)
	assert.ok(d.recall >= 0.95 && d.precision >= 0.93, `from the run alone: recall ${d.recall}, precision ${d.precision}`)
})

// ---------------------------------------------------------------- the focus scout's whole labelled set (only where it is: FOCUS_TESTSET)
const TESTSET = process.env.FOCUS_TESTSET ?? null
test("subjects: the focus scout's whole labelled set (FOCUS_TESTSET), with each caller's hints", { skip: !TESTSET || !existsSync(TESTSET) ? "FOCUS_TESTSET is not set (a local file)" : false }, async () => {
	const FS = dirname(TESTSET)
	const TS = JSON.parse(readFileSync(TESTSET, "utf8"))
	const cat = JSON.parse(readFileSync(join(FS, "work", "catalog.json"), "utf8"))
	const registry = JSON.parse(readFileSync(join(FS, "work", "registry.json"), "utf8"))
	const sim = (key) => JSON.parse(gunzipSync(readFileSync(join(FS, "work", "sims", `${key}.json.gz`))).toString())
	const hintsFor = makeHints(TS)
	const rows = []
	const derived = []
	let ms = 0
	let worst = 0
	for (const s of TS.scenes) {
		const scene = JSON.parse(readFileSync(s.scene, "utf8"))
		const run = sim(s.key)
		const lab = { ...s.expected, seconds: s.seconds, lapse: scene.settings?.time_lapse ?? 1 }
		const t0 = performance.now()
		const out = recognize({ scene, run, catalog: cat, registry, hints: hintsFor(s) })
		const dt = performance.now() - t0
		ms += dt
		worst = Math.max(worst, dt)
		rows.push({ key: s.key, split: s.split ?? "tune", group: s.group.split(":")[0], ...score(lab, out) })
		const outD = recognize({ scene: sceneFromSim(run), run, catalog: cat, registry, hints: hintsFor(s) })
		derived.push({ key: s.key, split: s.split ?? "tune", group: s.group.split(":")[0], ...score(lab, outD) })
	}
	const all = totals(rows)
	console.log(line("whole labelled set", all))
	for (const split of ["tune", "heldout", "fresh"]) console.log("  " + line(split, totals(rows.filter((r) => r.split === split))))
	for (const g of [...new Set(rows.map((r) => r.group))]) console.log("    " + line(g, totals(rows.filter((r) => r.group === g))))
	for (const m of misses(rows)) console.log("    " + m)
	console.log(`  ${(ms / rows.length).toFixed(1)} ms a scene on average, ${worst.toFixed(0)} ms at most`)
	const d = totals(derived)
	console.log(line("whole labelled set, the scene read from its run (sceneFromSim)", d))
	for (const split of ["tune", "heldout", "fresh"]) console.log("  " + line(split, totals(derived.filter((r) => r.split === split))))
	const fresh = totals(rows.filter((r) => r.split === "fresh"))
	assert.ok(all.recall >= 0.99, `primary recall ${all.recall}`)
	assert.ok(all.precision >= 0.99, `primary precision ${all.precision}`)
	assert.ok(fresh.recall >= 0.97 && fresh.precision >= 0.97, `fresh split: recall ${fresh.recall}, precision ${fresh.precision}`)
	assert.ok(all.sceneryLeaks <= 6, `scenery framed ${all.sceneryLeaks}`)
	assert.ok(all.momentRecall >= 0.98, `moments ${all.momentRecall}`)
})

/** What each kind of caller really has for a scene of the scout's set (its inputs.kind): a lesson lane its lesson's words (the questions and
 *  screens of the segments that use it, its part's opening line), the segments' other lanes and its pauses; a pipeline sample its brief and
 *  binding; a bare scene nothing (the recognizer reads its name and goals). The focus scout's tools/hints.mjs, as the callers should pass it. */
function makeHints(TS) {
	const site = JSON.parse(readFileSync(TS.scenes.find((s) => s.inputs?.site)?.inputs.site, "utf8"))
	const siteItems = Object.fromEntries(site.lessons.map((l) => [l.id, l.items]))
	const byKey = new Map(TS.scenes.map((s) => [s.key, s]))
	const PART_INTRO = { R: 0, S: 8, F: 16 }
	return (s) => {
		const inp = s.inputs ?? {}
		if (inp.kind === "lesson-lane") {
			const les = s.group.split(":")[1]
			const its = siteItems[les]
			const text = []
			const pauses = []
			const pairs = []
			for (const seg of s.lesson_segments ?? []) {
				const intro = PART_INTRO[seg.segment[0]]
				if (les === "fairtest" && intro !== undefined && its[intro]?.need) text.push(its[intro].need)
				for (const it of seg.items) {
					const x = its[it.index]
					if (x?.ask) text.push(x.ask)
					if (x?.need) text.push(x.need)
					pauses.push({ where: it.where })
				}
				if (seg.pair && seg.pair !== s.key && byKey.has(seg.pair)) pairs.push({ scene: JSON.parse(readFileSync(byKey.get(seg.pair).scene, "utf8")) })
			}
			return { text: [...new Set(text)], pauses, pairs }
		}
		if (inp.kind === "lesson-lane-v1") return { text: inp.text ?? [], pauses: (inp.pauses ?? []).map((where) => ({ where })), pairs: inp.pair_scene ? [{ scene: JSON.parse(readFileSync(inp.pair_scene, "utf8")) }] : [] }
		if (inp.kind === "pipeline") {
			const brief = JSON.parse(readFileSync(inp.brief, "utf8"))
			const binding = JSON.parse(readFileSync(inp.binding, "utf8"))
			const text = [...(brief.request_nouns ?? []).map((n) => n.words), ...(brief.chain ?? []).map((c) => c.notice), ...(binding.captions ?? []).map((c) => c.text)]
			return { roles: binding.roles, brief, cues: binding.cues, text }
		}
		return {}
	}
}
