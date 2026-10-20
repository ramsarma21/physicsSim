// The softbody module through the AI layer and the engine, end to end (node tools/softbody/test.mjs):
//   registry  its goal kinds (and their spellings), knobs, prompt lines, digest lines and change words in web/sim/plugins.js
//   digest    the AI's catalog digest lists its types, readings, how-to and goal kinds; the plan, edit and refine prompts get its lines
//   build     plans as the AI writes them (its goals by their spellings, loads on a ruler's end, a car on a launcher's board, a bridge) validate,
//             the solver places them, they run, and their goals are met in the run's summary, by ai/goals.mjs and by web/ai/goals.js alike
//   edit      the edit step's digest shows its readings and lines; change lines word its props in real units; an edit that stops a goal gets a fix
//             from the make-it-work search through the module's knobs, said in the knob's words, and the fix works when run again
//   fuzz      random scenes of every softbody type (props at random, things dropped on them): no exception, everything finite, the same twice
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const imp = (p) => import(pathToFileURL(join(PG, p)).href)
let failed = 0
let passed = 0
const ok = (cond, what, detail = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
	if (cond) passed++
	else failed++
}

const sim = await imp("web/sim/index.js")
const { handle } = await imp("web/sim/engine-worker.js")
const pl = sim.plugins
const simulate = async (scene, signal) => {
	if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" })
	const { scene: s, doc, resolved } = sim.prepare(scene)
	const msg = handle({ id: 1, doc, rate: 120 })
	if (msg.error !== undefined) throw new Error(msg.error)
	const meta = sim.finish(s, doc, resolved, msg.track)
	return { key: "k", ms: msg.ms, track: msg.track, doc: meta.doc, summary: meta.summary, warnings: meta.warnings, resolved, scene: s }
}

// ---- registry
for (const [spelling, kind] of [["squashes", "squashes"], ["dents", "squashes"], ["springs_back", "springs_back"], ["elastic", "springs_back"], ["bends", "bends"], ["sags", "bends"], ["deforms_more", "deforms_more"], ["bends_more", "deforms_more"], ["stores", "stores"], ["stores_energy", "stores"]])
	ok(pl.goalKind(spelling)?.kind === kind, `goal kind ${spelling} → ${kind}`)
ok(pl.goalProblem({ kind: "bends" }, new Set(["r"])) === "bends needs item" && pl.goalProblem({ kind: "deforms_more", a: "r1", b: "r2" }, new Set(["r1", "r2"])) === null, "goalProblem checks its fields")
ok(pl.knobOf("flex-ruler", "overhang")?.how === "rel" && pl.knobOf("band-launcher", "draw")?.how === "m" && pl.knobOf("toy-car", "band_turns")?.how === "abs", "knobs: overhang, draw, band turns")
ok(/Soft and bendy/.test(pl.promptSnippets("plan")) && /Soft & bendy/.test(pl.promptSnippets("edit")) && /Soft & bendy/.test(pl.promptSnippets("refine")), "prompt lines for plan, edit and refine")
ok(/it bends 3\.3[78]× as much \(L³\)/.test(pl.changeWords("flex-ruler", "overhang", 0.2, 0.3) ?? ""), "change words: overhang", pl.changeWords("flex-ruler", "overhang", 0.2, 0.3))
ok(/wood → steel, E 12 → 200 GPa/.test(pl.changeWords("flex-ruler", "material", "varnished hardwood", "steel") ?? ""), "change words: material", pl.changeWords("flex-ruler", "material", "varnished hardwood", "steel"))
ok(/pulled back 10 cm → 15 cm/.test(pl.changeWords("band-launcher", "draw", 0.1, 0.15) ?? ""), "change words: draw")
ok(/rubber band wound 0 turns → 10 turns/.test(pl.changeWords("toy-car", "band_turns", 0, 10) ?? ""), "change words: band turns", pl.changeWords("toy-car", "band_turns", 0, 10))

// ---- digest and prompts
const { digestFromCatalog } = await imp("ai/catalog-digest.mjs")
const dg = digestFromCatalog(sim.catalog())
for (const k of ["soft-clay", "playground-ball", "exercise-ball", "foam-ball", "flex-ruler", "springboard", "flex-plank", "band-launcher", "coil-spring"]) ok(dg.text.includes(k) && dg.index.types[k] !== undefined, `digest lists ${k}`)
ok(/### Soft and bendy things/.test(dg.text) && /goal squashes \{item, at_least_mm\?\}/.test(dg.text) && /goal deforms_more \{a, b\}/.test(dg.text), "digest: how-to and goal kinds")
ok(/bend_mm \(Bend, mm\)/.test(dg.text) || /Bend, mm/.test(dg.text), "digest: a beam's readings")
ok(/band_turns/.test(dg.text), "digest: a toy car's rubber band (common prop)")
const { moduleSnippets } = await imp("ai/steps.mjs")
ok(/Soft and bendy/.test(moduleSnippets("plan")) && /deforms_more/.test(moduleSnippets("refine")), "the plan and refine prompts get the module's lines")

// ---- build: plans as the AI writes them
const schemas = await imp("ai/schemas.mjs")
const { solve } = await imp("web/ai/solver.js")
const aiGoals = await imp("ai/goals.mjs")
const webGoals = await imp("web/ai/goals.js")
const plans = {
	coins: {
		title: "More coins, more bend", seconds: 3, items: [
			{ id: "r1", type: "flex-ruler", name: "Ruler with 1 mass", props: { material: "acrylic" }, place: { on: "table", x: 0.3 } },
			{ id: "r2", type: "flex-ruler", name: "Ruler with 4 masses", props: { material: "acrylic" }, place: { on: "table", x: 1.3 } },
			{ id: "m1", type: "gram-mass", props: { grams: "20 g" }, place: { on: "r1", x: 0.485 } },
			{ id: "m2", type: "gram-mass", props: { grams: "100 g" }, place: { on: "r2", x: 1.485 } }
		],
		missing: [], goals: [{ kind: "bends_more", label: "the heavier load bends its ruler more", a: "r2", b: "r1" }, { kind: "bends", label: "it bends", item: "r2", at_least_mm: 5 }], tune: [], notes: ""
	},
	drop: {
		title: "Clay vs a playground ball", seconds: 3, items: [
			{ id: "clay", type: "soft-clay", name: "Clay ball", place: { on: "air", x: 0.6, y_m: 1.0 }, held: true },
			{ id: "ball", type: "playground-ball", name: "Rubber ball", place: { on: "air", x: 1.4, y_m: 1.0 }, held: true }
		],
		missing: [], goals: [{ kind: "dents", label: "the clay stays squashed", item: "clay", at_least_mm: 3 }, { kind: "elastic", label: "the ball springs back", item: "ball" }], tune: [], notes: ""
	},
	launch: {
		title: "Pull it back farther", seconds: 4, items: [
			{ id: "L1", type: "band-launcher", name: "Short pull", props: { draw: 0.05 }, place: { on: "table", x: 0.5 } },
			{ id: "c1", type: "toy-car", name: "Car 1", place: { on: "L1", x: 0.553 } },
			{ id: "L2", type: "band-launcher", name: "Long pull", props: { draw: 0.15 }, place: { on: "air", x: 0.5, y_m: 0.4 }, fixed: true },
			{ id: "c2", type: "toy-car", name: "Car 2", place: { on: "L2", x: 0.453 } }
		],
		missing: [], goals: [{ kind: "stores", label: "the long pull stores more", item: "L2", at_least_j: 0.5 }, { kind: "moves", label: "car 2 is launched", item: "c2", min_m: 0.3 }], tune: [], notes: ""
	}
}
const solved = {}
for (const [name, plan] of Object.entries(plans)) {
	const vp = schemas.validatePlan(plan, { catalog: dg.index })
	ok(vp.ok, `plan "${name}" validates (its goals by their spellings)`, vp.errors.join("; "))
	if (!vp.ok) continue
	const { scene, warnings } = solve(vp.value)
	const run = await simulate(scene)
	solved[name] = { scene, run, plan: vp.value }
	const mine = run.summary.goals.filter((g) => ["squashes", "springs_back", "bends", "deforms_more", "stores", "moves"].includes(g.kind))
	ok(mine.length > 0 && mine.every((g) => g.ok), `plan "${name}": solved, run, its goals met`, JSON.stringify(mine.map((g) => [g.kind, g.ok, g.a_mm ?? g.dent_mm ?? g.peak_mm ?? g.bend_mm ?? g.energy_j ?? ""])) + (warnings?.length ? ` warnings ${JSON.stringify(warnings).slice(0, 200)}` : ""))
	const checked = aiGoals.checkGoals(vp.value.goals, { doc: run.doc, track: run.track, summary: run.summary })
	ok(checked.every((g) => g.ok === true), `plan "${name}": ai/goals.mjs agrees`, JSON.stringify(checked.map((g) => [g.kind, g.ok])))
	ok(JSON.stringify(webGoals.checkGoals(vp.value.goals, { doc: run.doc, track: run.track })) === JSON.stringify(aiGoals.checkGoals(vp.value.goals, { doc: run.doc, track: run.track })), `plan "${name}": web/ai/goals.js judges as ai/goals.mjs`)
}
// where the solver put the loads and the car: on the ruler's end, on the launcher's board in front of its pouch
if (solved.coins) {
	const s = solved.coins.scene
	const r2 = s.items.find((i) => i.id === "r2")
	const m2 = s.items.find((i) => i.id === "m2")
	ok(Math.abs(m2.x - (r2.x + 0.185)) < 0.01 && Math.abs(m2.y - (0.05 + 0.003)) < 0.004, "the solver rests a mass on the ruler's end", `ruler at ${r2.x}, mass at ${m2.x}, ${m2.y}`)
}
if (solved.launch) {
	const s = solved.launch.scene
	const L1 = s.items.find((i) => i.id === "L1")
	const c1 = s.items.find((i) => i.id === "c1")
	ok(Math.abs(c1.y - 0.012) < 0.003 && c1.x - 0.1 >= L1.x - 0.05 - 0.002, "the solver sets the car on the launcher's board in front of the pouch", `launcher ${L1.x}, car ${c1.x}, ${c1.y}`)
}

// ---- edit: the rich digest, change lines, and a fix through the module's knobs
const { richDigestFrom } = await imp("ai/rich-digest.mjs")
const { sceneDigest } = await imp("ai/scene-digest.mjs")
if (solved.coins) {
	const { scene, run } = solved.coins
	const rd = richDigestFrom(run.scene ?? scene, await sceneDigest(scene, dg.index), { sim: run, cat: dg })
	ok(/readings in the last run: bend 0\.0 → \d+\.\d mm/.test(rd.text), "the edit step's digest: a ruler's bend", rd.text.match(/.*readings in the last run: bend.*/)?.[0]?.slice(0, 160))
	ok(/an acrylic \(plastic\) ruler 3 mm thick/.test(rd.text) && /100 g on its very end bends it about 12\.\d+ mm/.test(rd.text), "the edit step's digest: the module's lines (E·I, the bend per 100 g)", rd.text.match(/.*acrylic \(plastic\) ruler.*/)?.[0]?.slice(0, 200))
	const { describeDiff, createOrchestrator } = await imp("web/ai/orchestrator.js")
	const s2 = structuredClone(scene)
	s2.items.find((i) => i.id === "r1").props.overhang = 0.25
	s2.items.find((i) => i.id === "r2").props.material = "steel"
	const dd = describeDiff(scene, s2)
	ok(dd.some((l) => /overhang 20 cm → 25 cm: it bends 1\.95× as much \(L³\)/.test(l)) && dd.some((l) => /acrylic \(plastic\) → steel/.test(l)), "change lines in real units", JSON.stringify(dd))
	const { fixWords } = await imp("web/ai/fixer.js")
	const fw = fixWords([{ kind: "prop", id: "r1", key: "overhang", from: 0.2, to: 0.24 }], scene)
	ok(/^push Ruler with 1 mass out farther over the edge \(20 cm → 24 cm\)$/i.test(fw.say ?? "") && /^pushed /.test(fw.did ?? ""), "the make-it-work search says a knob in its words", JSON.stringify(fw))
	// an edit that stops "bends more": 100 g on the 1-mass ruler too (both rulers now bend the same); a fair test holds what the two compared
	// rulers share (their overhang, material, width): the search never changes one of them alone to meet it (the goal now contradicts the
	// request; the card says so). The search through the module's knobs on a ruler of its own: below.
	const mockApi = (patches) => async (path, body, signal) =>
		path === "/api/simulate" ? simulate(body.scene, signal) : { ok: true, result: { mode: "patch", reply: "Done.", patches, suggestions: [] }, model: "mock", ms: 1 }
	const ai = createOrchestrator({ api: mockApi([{ op: "set_props", id: "m1", props: { grams: "100 g" } }]) })
	const r = await ai.build({ text: "put 100 g on the ruler with 1 mass too", mode: "edit", scene, sim: run }).result
	ok(r.fixNeeded === true, "the edit stops a goal (the same load bends both rulers the same)", JSON.stringify(r.goals?.map?.((g) => [g.kind, g.ok]) ?? r.summary?.goals?.map?.((g) => [g.kind, g.ok])))
	if (r.fixNeeded) {
		const fr = await ai.findFix(r.fixCtx, { budgetMs: 60000, minRuns: 200, hardMs: 240000 })
		const unfair = fr.status === "found" && (fr.fix.changes ?? []).some((c) => c.kind === "prop" && ["r1", "r2"].includes(c.id) && ["overhang", "material", "width", "thickness_mm"].includes(c.key))
		ok(!unfair, "a fair test: no fix changes one of the two compared rulers alone", `${fr.status} after ${fr.runs ?? "?"} runs${fr.fix ? `: ${JSON.stringify(fr.fix.changes)}` : ""}`)
	}
	// one ruler on its own: an edit that narrows it to 2.5 cm and asks for 18 mm of bend gets a fix through the module's knobs that keeps 1 cm
	const one = structuredClone(scene)
	one.items = one.items.filter((i) => !["r1", "m1"].includes(i.id))
	one.goals = [{ kind: "bends", item: "r2", at_least_mm: 18, label: "the ruler bends at least 1.8 cm" }]
	const run1 = await simulate(one)
	const ai1 = createOrchestrator({ api: mockApi([{ op: "set_props", id: "r2", props: { width: 0.025 } }]) })
	const r1 = await ai1.build({ text: "make the ruler 2.5 cm wide", mode: "edit", scene: one, sim: run1 }).result
	ok(r1.fixNeeded === true, "an edit that misses a goal on a ruler of its own", JSON.stringify(r1.goals?.map?.((g) => [g.kind, g.ok])))
	if (r1.fixNeeded) {
		const fr = await ai1.findFix(r1.fixCtx, { budgetMs: 60000, minRuns: 200, hardMs: 240000 })
		ok(fr.status === "found", "the make-it-work search finds a fix", `${fr.status} after ${fr.runs ?? "?"} runs${fr.near ? `; nearest ${JSON.stringify(fr.near.words ?? fr.near).slice(0, 200)}` : ""}`)
		if (fr.status === "found") {
			const kept = fr.fix.scene.items.find((i) => i.id === "r2").props?.width === 0.025
			const knobs = (fr.fix.changes ?? []).every((c) => c.kind === "prop" && c.id === "r2" && ["overhang", "material", "thickness_mm"].includes(c.key))
			ok(kept && knobs, "it keeps what was asked for (2.5 cm wide) and turns the ruler's knob", JSON.stringify(fr.fix.changes))
			const again = await simulate(fr.fix.scene)
			ok(again.summary.goals.every((g) => g.ok), "the fix works when run again", JSON.stringify(again.summary.goals.map((g) => [g.kind, g.ok])))
			console.log(`      the fix: ${JSON.stringify(fr.fix.words ?? fr.fix.changes)}`)
		}
	}
}

// ---- fuzz: random scenes of every softbody type, things dropped on them
let seed = 20261019
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const types = sim.catalog().types.filter((t) => t.module === "softbody")
const droppers = ["gram-mass", "steel-ball", "tennis-ball", "wooden-block", "soft-clay", "playground-ball", "foam-ball", "steel-weight-1kg"]
let broke = 0
let nonFinite = 0
let differ = 0
for (let k = 0; k < 60; k++) {
	const items = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	const n = 1 + Math.floor(rnd() * 3)
	for (let j = 0; j < n; j++) {
		const t = pick(types)
		const props = {}
		for (const p of t.props) {
			if (p.common || rnd() < 0.5) continue
			if (p.kind === "choice") props[p.key] = pick(p.choices)
			else if (p.kind === "int") props[p.key] = p.min + Math.floor(rnd() * (p.max - p.min + 1))
			else if (p.kind === "number") props[p.key] = Number((p.min + rnd() * ((p.slider_max ?? p.max) - p.min)).toFixed(4))
		}
		const x = 0.2 + j * 1.0 + rnd() * 0.3
		items.push({ id: `s${j}`, type: t.key, x, y: t.anchor === "its middle" ? 0.15 + rnd() * 0.6 : t.key === "flex-plank" ? 0.3 : 0, angle: rnd() < 0.15 ? pick([15, -20, 90]) : 0, props })
		for (let q = 0; q < 1 + Math.floor(rnd() * 2); q++) items.push({ id: `d${j}_${q}`, type: pick(droppers), x: x + rnd() * 0.3, y: 0.3 + rnd() * 0.8, props: {} })
	}
	if (rnd() < 0.3) items.push({ id: "car", type: "toy-car", x: 0.1, y: 0, props: { band_turns: Number((rnd() * 30).toFixed(1)) } })
	const scene = { version: 2, id: "f", name: "f", items, seconds: 2.5, release: rnd() * 0.4, settings: rnd() < 0.2 ? { gravity: pick(["moon", "mars", 20]) } : undefined }
	try {
		const a = await simulate(scene)
		const b = await simulate(scene)
		if (JSON.stringify(a.track).includes("null") || JSON.stringify(a.track).includes("NaN")) nonFinite++
		if (JSON.stringify(a.track) !== JSON.stringify(b.track)) differ++
	} catch (e) {
		broke++
		console.log(`      scene ${k}: ${String(e.message).slice(0, 160)}`)
	}
}
ok(broke === 0 && nonFinite === 0 && differ === 0, "60 random softbody scenes: no exception, nothing non-finite, the same twice", `${broke} broke, ${nonFinite} non-finite, ${differ} differ`)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
