// The plug-in framework, end to end, with its toy module (tools/plugin-toy: never in the catalog). Checks:
//   catalog   the toy's types (links, readouts, module) and a scene's document, resolved props and warnings: machines/items.py == web/sim
//   engine    the server's engine (node, the bundle's math) and the browser bundle (built here with the toy registered) give the same track,
//             byte for byte: readings, an event, a resized body, a force; and the settings (gravity, air, time-lapse) act
//   summary   items.py summarize == web/sim summarize (the toy_melts goal kind, readings, happenings)
//   plugins   the AI's registry: the goal kind (checkModuleGoal), knobs, prompt snippets, digest lines, change words
//   identity  a scene without module items builds and runs exactly as without the framework (the 22 scenes: tools/plugin-toy/identity.sh)
//   node tools/plugin-toy/test.mjs [--browser]   (--browser: also the bundle in headless Chromium)
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const OUT = process.env.TOY_OUT || join(process.env.TMPDIR || "/tmp", "plugin-toy")
mkdirSync(OUT, { recursive: true })
let failed = 0
const ok = (cond, what, detail = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
	if (!cond) failed++
}

// ---- the JS side, with the toy registered as web/sim/modules/index.js would
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const items = await import(pathToFileURL(join(PG, "web/sim/items.js")).href)
const toy = await import(pathToFileURL(join(HERE, "toy.js")).href)
items.use_catalog_module("mod_toy", toy.register_all)
const mod = sim.plugins.registerModule({ ...toy.plugin, name: "mod_toy" })
for (const k of mod.goals) items.register_goal_kind(k.kind, (ctx, g) => k.summarize(ctx, g))

const scene = (extra = {}) => ({
	version: 2, id: "toy", name: "Toy", seconds: 4, release: 0.2, stage: { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 },
	items: [
		{ id: "table", type: "table", x: 1.3, y: 0, props: {} },
		{ id: "pad", type: "toy-heater", x: 1.0, y: 0.0, props: { power: 60 } },
		{ id: "cube", type: "toy-cube", x: 1.0, y: 0.0165, props: { heater: "pad" } },
		{ id: "lifted", type: "toy-cube", x: 1.6, y: 0.3, props: { lift: 0.5 } },
		{ id: "ball", type: "superball", x: 2.0, y: 0.5, props: {} }
	],
	goals: [{ kind: "toy_melts", item: "cube" }, { kind: "toy_melts", item: "cube", before_s: 0.5 }, { kind: "moves", item: "lifted", min_m: 0.05 }],
	...extra
})
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_toy.py")], { input: JSON.stringify(req), maxBuffer: 1 << 28 }).toString())

// ---- catalog and document parity
const S = scene({ settings: { time_lapse: 120 } })
const clean = sim.clean(S)
const js = sim.layout(clean)
const P = py({ scene: clean })
ok(isDeepStrictEqual(P.doc, js.doc), "document: items.py == web/sim (processes, settings)")
ok(isDeepStrictEqual(P.resolved, js.resolved), "resolved props equal")
ok(isDeepStrictEqual(P.warnings, js.warnings), "warnings equal")
const jsTypes = ["toy-heater", "toy-cube"].map((k) => sim.catalog().types.find((t) => t.key === k)).map(({ preview, ...t }) => t)
ok(isDeepStrictEqual(P.types, jsTypes), "catalog entries equal (links, readouts, module)")
ok(js.doc.processes?.length === 3 && js.doc.processes[0].heater === "pad/pad" && js.doc.processes[1].heater === null, "the cube's link is resolved into its process", JSON.stringify(js.doc.processes?.[0]))
ok(js.doc.settings?.timeLapse === 120 && !("gravity" in js.doc.settings), "doc.settings has only what differs from the standard", JSON.stringify(js.doc.settings))
const unlinked = sim.layout(sim.clean(scene({ items: [{ id: "table", type: "table", x: 1.3, y: 0 }, { id: "cube", type: "toy-cube", x: 1, y: 0.0165, props: { heater: "nobody" } }] })))
ok(unlinked.doc.processes[0].heater === null, "a link to a missing item builds unlinked")
for (const bad of [{ gravity: "pluto" }, { gravity: 40 }, { air: "no" }, { time_lapse: 0 }]) {
	let a = null
	let b = null
	try {
		sim.layout(sim.clean(scene({ settings: bad })))
	} catch (e) {
		a = e.message
	}
	b = py({ scene: sim.clean(scene({ settings: bad })) }).error
	ok(a !== null && a === `can't build this scene: ${b}`, `bad settings refused alike: ${JSON.stringify(bad)}`, a)
}

// ---- the engine: the server's (node, the bundle's math) and the browser bundle with the toy registered
await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
const plugins = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
const toyEngine = (await import(pathToFileURL(join(HERE, "src/sim/toy.ts")).href)).default
plugins.registerProcess(...toyEngine)
const round = (v, d) => Number(v.toFixed(d))
const serverRun = (doc) => {
	// (research/poc/worker.ts's run, as the server answers)
	const { scene: s } = admitDocument(doc)
	const track = simulate(s, 120)
	const frames = track.frames
	const first = frames[0]?.placements ?? {}
	const still = new Set()
	for (const part of s.solids) {
		const a = first[part.id]
		if (part.kind !== "static" || a === undefined) continue
		let same = true
		for (let k = 1; k < frames.length && same; k++) {
			const b = frames[k]?.placements[part.id]
			same = b !== undefined && b.x === a.x && b.y === a.y && b.angle === a.angle && b.squash === a.squash && b.scale === a.scale
		}
		if (same) still.add(part.id)
	}
	const slim = frames.map((f, k) => {
		const placements = {}
		for (const id in f.placements) {
			if (k > 0 && still.has(id)) continue
			const p = f.placements[id]
			const q = { x: round(p.x, 5), y: round(p.y, 5), angle: round(p.angle, 5) }
			if (p.squash !== undefined) q.squash = round(p.squash, 5)
			if (p.scale !== undefined) q.scale = round(p.scale, 5)
			placements[id] = q
		}
		return { t: round(f.t, 6), placements }
	})
	return JSON.stringify({ fps: track.fps, frames: slim, impacts: track.impacts, ...plugins.slimExtras(track, round) })
}
const serverTrack = serverRun(js.doc)
// the bundle, built as tools/build-engine.mjs builds web/sim/engine-worker.js, from tools/plugin-toy/entry.ts
const { DEFINE, INJECT, LOWER_POW, afterLower, lowerOptions } = await import(pathToFileURL(join(PG, "tools/engine-math-transform.ts")).href)
const { createRequire } = await import("node:module")
const esbuild = createRequire(join(PG, "node_modules", "x.js"))("esbuild")
const bundle = join(OUT, "toy-engine.js")
await esbuild.build({
	entryPoints: [join(HERE, "entry.ts")], outfile: bundle, bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
	legalComments: "none", logLevel: "warning", define: DEFINE, inject: [INJECT],
	plugins: [{
		name: "lower-exponent-operator",
		setup(b) {
			b.onLoad({ filter: LOWER_POW }, async (a) => {
				const t = await esbuild.transform(readFileSync(a.path, "utf8"), lowerOptions(a.path))
				return { contents: afterLower(t.code), loader: "js", resolveDir: dirname(a.path) }
			})
		}
	}, { name: "toy-too", setup(b) { b.onLoad({ filter: /plugin-toy[\\/]src[\\/]sim[\\/].*\.ts$/ }, async (a) => { const t = await esbuild.transform(readFileSync(a.path, "utf8"), lowerOptions(a.path)); return { contents: afterLower(t.code), loader: "js", resolveDir: dirname(a.path) } }) } }]
})
const B = await import(pathToFileURL(bundle).href)
const bundleMsg = B.handle({ id: 1, doc: js.doc, rate: 120 })
ok(bundleMsg.error === undefined, "the bundle runs the toy document", bundleMsg.error)
const bundleTrack = JSON.stringify(bundleMsg.track)
ok(serverTrack === bundleTrack, "track: server's engine == browser bundle, byte for byte", `${serverTrack.length} bytes`)
writeFileSync(join(OUT, "toy-track.json"), bundleTrack)
const track = JSON.parse(bundleTrack)
const melted = track.state?.cube?.melted ?? []
const temps = track.state?.cube?.temperature ?? []
ok(melted.at(-1) === 1 && temps[0] === 20 && Math.abs(temps.at(-1) - 58) < 1e-9, "readings: the cube warms from 20 °C to 58 °C and melts", `T ${temps[0]} → ${temps.at(-1)}, melted ${melted.at(-1)}`)
const sc = track.frames.map((f) => f.placements["cube/wax"]?.scale).filter((v) => v !== undefined)
ok(sc.length > 0 && sc.at(-1) === 0, "the melting cube is resized to nothing (placements carry scale)", `${sc.length} frames, last ${sc.at(-1)}`)
ok(track.events?.length === 1 && track.events[0].text === "cube melted completely", "an event", JSON.stringify(track.events))
// heat budget (time-lapse 120): warming 0.0243 kg × 2500 × 38 K = 2308.5 J, melting 0.0243 × 210000 = 5103 J; 7411.5 J at 60 W = 123.5 s = 1.03 s
// of run, from when the cube lands on the pad after the release (0.2 s; it starts 1.5 mm above it), on the process's 0.1 s beat
const tMelt = track.frames[melted.indexOf(1)]?.t
ok(tMelt > 1.2 && tMelt < 1.4, "it melts when the heat budget says (1.03 s of run at 120× time-lapse, after it lands at 0.2 s)", `${tMelt} s`)
// the lifted cube: half its weight lifted, so it falls with g/2 (less the air's drag and lift) from 0.3 m
const y0 = track.frames[0].placements["lifted/wax"].y
const at = (t) => track.frames.find((f) => f.t >= t)
const fall = y0 - at(0.4).placements["lifted/wax"].y
ok(fall > 0.0 && Math.abs(fall - 0.5 * 4.905 * 0.2 * 0.2) < 0.004, "a force hook: the lifted cube falls at g/2", `${(fall * 1000).toFixed(1)} mm in 0.2 s (g/2: 98.1 mm)`)
// settings: the Moon (1.62) and no air: the ball falls 0.5·1.62·t²
const moon = sim.layout(sim.clean(scene({ settings: { gravity: "moon", air: false } })))
const mt = B.handle({ id: 2, doc: moon.doc, rate: 120 }).track
const mby = (t) => mt.frames.find((f) => f.t >= t).placements["ball/ball"]?.y ?? mt.frames.find((f) => f.t >= t).placements[Object.keys(mt.frames[0].placements).find((k) => k.startsWith("ball/"))].y
const ballId = Object.keys(mt.frames[0].placements).find((k) => k.startsWith("ball/"))
const drop = mt.frames[0].placements[ballId].y - mt.frames.find((f) => f.t >= 0.7).placements[ballId].y
ok(Math.abs(drop - 0.5 * 1.62 * 0.5 * 0.5) < 0.002, "settings: Moon gravity in a vacuum", `${(drop * 1000).toFixed(1)} mm in 0.5 s (½·1.62·t²: 202.5 mm)`)
void mby

// ---- the summary: items.py == web/sim
const meta = sim.finish(clean, js.doc, js.resolved, track)
const P2 = py({ scene: clean, track })
ok(isDeepStrictEqual(P2.summary, meta.summary), "summary: items.py == web/sim (goal kinds, readings, happenings)")
const g = meta.summary.goals
ok(g[0]?.ok === true && g[1]?.ok === false && g[0].kind === "toy_melts", "the toy_melts goal: met, and not by 0.5 s", JSON.stringify(g.slice(0, 2)))
ok(meta.summary.readings?.cube?.melted === 1 && meta.summary.happenings?.length === 1, "readings and happenings in the summary")

// ---- the AI's registry
const pl = sim.plugins
ok(pl.goalKind("toy_melt")?.kind === "toy_melts", "a goal kind by its alias")
ok(pl.goalProblem({ kind: "toy_melts" }, new Set(["cube"])) === "toy_melts needs item" && pl.goalProblem({ kind: "toy_melts", item: "cube" }, new Set(["cube"])) === null, "goalProblem")
const chk = pl.checkModuleGoal({ kind: "toy_melts", item: "cube" }, { doc: js.doc, track })
ok(chk.ok === true, "checkModuleGoal on a run (the AI's check)", JSON.stringify(chk.entry))
ok(pl.knobsFor("toy-heater")[0]?.key === "power" && pl.knobOf("toy-cube", "heater")?.how === "link", "knobs")
ok(/Toy heat/.test(pl.promptSnippets("plan")) && pl.promptSnippets("observe") === "", "prompt snippets by step")
ok(/LINKED/.test(pl.howtoText()), "how-to text for the digest")
ok(pl.digestLines({ type: "toy-cube", id: "c", props: {} }, null)[0] === "not linked to a heater: it never warms", "digest lines")
ok(pl.changeWords("toy-cube", "heater", "a", "b", (id) => `pad ${id}`) === "heater pad a → pad b", "change words")
ok(/toy_melts \{item, before_s\?\}/.test(pl.goalKindLines()), "goal kind lines for the prompts")

// ---- the AI layer: the digest, the plan's checks, the solver, the goal checks, the edit step's digest, the make-it-work search's words
const { digestFromCatalog } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
const dg = digestFromCatalog(sim.catalog())
ok(/heater: link → the id of a toy-heater/.test(dg.text), "digest: a link prop", dg.text.match(/.*heater: link.*/)?.[0]?.slice(0, 120))
ok(/Readings \(the run reports them; goals and edits can use them\): temperature \(Temperature, °C\), melted/.test(dg.text), "digest: readings")
ok(/### Toy heat \(framework test\)\nA toy-cube melts/.test(dg.text) && /goal toy_melts \{item, before_s\?\}/.test(dg.text) && /Scene settings \(plan.settings/.test(dg.text), "digest: the module's how-to, goal kinds and the settings")
const { promptCatalog, FULL_LIMIT } = await import(pathToFileURL(join(PG, "ai/catalog-digest.mjs")).href)
const pcat = promptCatalog(dg, { text: "melt a wax cube on a heater pad" })
ok(dg.text.length <= FULL_LIMIT ? pcat.system === dg.text && pcat.extra === "" : pcat.modules.includes("mod_toy") && /### Toy heat \(framework test\)/.test(pcat.extra) && /### toy-cube/.test(pcat.extra) && !/### toy-cube/.test(pcat.system), "the prompts' catalog: whole, or its core with the request's modules in full", `${dg.text.length} chars; picked ${pcat.modules.join(", ")}`)
const schemas = await import(pathToFileURL(join(PG, "ai/schemas.mjs")).href)
const plan = {
	title: "Melt it", seconds: 4, items: [
		{ id: "pad", type: "toy-heater", name: "Hot pad", props: { power: 60 }, place: { on: "table", x: 1 } },
		{ id: "cube", type: "toy-cube", name: "Wax", props: { heater: "Hot pad" }, place: { on: "pad" } }
	],
	missing: [], goals: [{ kind: "toy_melt", label: "the wax melts", item: "cube" }], tune: [], notes: "", settings: { time_lapse: 120 }
}
const vp = schemas.validatePlan(plan, { catalog: dg.index })
ok(vp.ok && vp.value.goals[0].kind === "toy_melts" && vp.value.settings.time_lapse === 120, "plan: a module goal (by its spelling), a link prop and settings validate", vp.errors.join("; "))
const badPlan = schemas.validatePlan({ ...plan, goals: [{ kind: "toy_melts", label: "x" }] }, { catalog: dg.index })
ok(!badPlan.ok && badPlan.errors.some((e) => /needs item/.test(e)), "plan: a module goal missing its item is refused", badPlan.errors.join("; "))
const { solve } = await import(pathToFileURL(join(PG, "web/ai/solver.js")).href)
const solved = solve(vp.value)
const ss = solved.scene
ok(ss.items.find((i) => i.id === "cube")?.props?.heater === "pad", "solver: the link named by the pad's name is its id", JSON.stringify(ss.items.find((i) => i.id === "cube")?.props))
ok(ss.goals.some((g) => g.kind === "toy_melts" && g.item === "cube") && ss.settings?.time_lapse === 120, "solver: the module goal is in the scene's goals, the settings kept", JSON.stringify(ss.goals))
const sp = sim.prepare(ss)
const sr = B.handle({ id: 3, doc: sp.doc, rate: 120 })
const sm = sim.finish(sp.scene, sp.doc, sp.resolved, sr.track)
ok(sm.summary.goals.find((g) => g.kind === "toy_melts")?.ok === true, "the solved scene's cube melts (its goal is met in the summary)", JSON.stringify(sm.summary.goals))
const aiGoals = await import(pathToFileURL(join(PG, "ai/goals.mjs")).href)
const cg = aiGoals.checkGoals([{ kind: "toy_melts", item: "cube", label: "melts" }, { kind: "toy_melts", item: "cube", before_s: 0.3 }], { doc: sp.doc, track: sr.track, summary: sm.summary })
ok(cg[0].ok === true && cg[1].ok === false && cg[1].before_s === 0.3, "ai/goals.mjs checks a module goal on a run", JSON.stringify(cg))
const cs = aiGoals.checkGoals([{ kind: "toy_melts", item: "cube" }], { summary: sm.summary })
ok(cs[0].ok === true, "ai/goals.mjs reads it from the summary alone", JSON.stringify(cs))
ok(aiGoals.allGoalKinds().includes("toy_melts") && aiGoals.goalLabel({ kind: "toy_melts", item: "cube", before_s: 2 }, { cube: "the wax" }) === "the wax melts by 2 s", "goal kinds and labels")
const wg = await import(pathToFileURL(join(PG, "web/ai/goals.js")).href)
ok(JSON.stringify(wg.checkGoals([{ kind: "toy_melts", item: "cube" }], { doc: sp.doc, track: sr.track })) === JSON.stringify(aiGoals.checkGoals([{ kind: "toy_melts", item: "cube" }], { doc: sp.doc, track: sr.track })), "web/ai/goals.js judges it as ai/goals.mjs")
const { richDigestFrom } = await import(pathToFileURL(join(PG, "ai/rich-digest.mjs")).href)
const { sceneDigest } = await import(pathToFileURL(join(PG, "ai/scene-digest.mjs")).href)
const rd = richDigestFrom(sp.scene, await sceneDigest(sp.scene, dg.index), { sim: { ...sm, track: sr.track }, cat: dg })
writeFileSync(join(OUT, "toy-rich-digest.txt"), rd.text)
// (on a time-lapse the readings say lesson time, the run's seconds × time_lapse (ai/DESIGN.md §19), and the happenings the run's own seconds:
// warmed on the pad's 0.1 s beats from the release, the cube reaches the wax's 58 °C at 0.90 s of the run, 108 s of lesson time, and is all
// melted at 1.60 s, 3 min 12 s: after it reaches 58 °C, and at the happening's time × 120 to within a frame of the 120 fps track)
const lessonS = (w) => [...w.matchAll(/([\d.]+) (h|min|s)\b/g)].reduce((s, [, n, u]) => s + Number(n) * { h: 3600, min: 60, s: 1 }[u], 0)
const reads = rd.text.match(/readings in the last run: temperature 20\.0 → 58\.0 °C \(reaches its end value at ([^)]+) of lesson time\); melted 0\.00 → 1\.00 \(reaches its end value at ([^)]+) of lesson time\)/)
const happened = rd.text.match(/What else happened \(the physics modules\): (1\.\d\d) s cube melted completely/)
ok(!!reads && !!happened && 0 < lessonS(reads[1]) && lessonS(reads[1]) < lessonS(reads[2]) && Math.abs(lessonS(reads[2]) - 120 * Number(happened[1])) <= 1 && /Settings: time_lapse 120/.test(rd.text), "the edit step's digest: readings (in lesson time on a time-lapse), happenings, settings", rd.text.match(/.*readings in the last run.*/)?.[0])
const { fixWords } = await import(pathToFileURL(join(PG, "web/ai/fixer.js")).href)
const fw = fixWords([{ kind: "prop", id: "pad", key: "power", from: 60, to: 72 }], sp.scene)
ok(/^turn the hot pad up \(60 W → 72 W\)$/i.test(fw.say) && /^turned the hot pad up/i.test(fw.did), "the make-it-work search's words for a module knob", JSON.stringify(fw))
const { describeDiff } = await import(pathToFileURL(join(PG, "web/ai/orchestrator.js")).href)
const sc2 = structuredClone(sp.scene)
sc2.items.push({ id: "pad2", type: "toy-heater", name: "Cold pad", x: 2, y: 0, props: {} })
sc2.items.find((i) => i.id === "cube").props.heater = "pad2"
sc2.settings = { gravity: "moon" }
const dd = describeDiff(sp.scene, sc2)
ok(dd.some((l) => /heater Hot pad → Cold pad/.test(l)) && dd.some((l) => /^Settings: /.test(l) && /gravity .*→ .*moon/i.test(l) && /time-lapse 120× → standard/.test(l)), "change lines: a link and the settings", JSON.stringify(dd))
const snip = (await import(pathToFileURL(join(PG, "ai/steps.mjs")).href)).moduleSnippets
ok(/^\n\n## Physics modules\n/.test(snip("plan")) && /### Toy heat \(framework test\)\nTo melt a toy cube/.test(snip("plan")) && /goal toy_melts/.test(snip("refine")) && snip("observe") === "", "the plan, edit and refine prompts get the module's lines")

// ---- stability: random toy scenes (sizes, powers, lifts up to twice the weight, settings at their limits) never break the engine
const R = (() => {
	let a = 20261019
	return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648)
})()
let broke = 0
let nonFinite = 0
for (let k = 0; k < 120; k++) {
	const items = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	const n = 1 + Math.floor(R() * 5)
	for (let j = 0; j < n; j++) {
		items.push({ id: `p${j}`, type: "toy-heater", x: 0.2 + R() * 2.5, y: 0, props: { power: Math.round(R() * 200), width: 0.04 + R() * 0.36 } })
		items.push({ id: `c${j}`, type: "toy-cube", x: 0.2 + R() * 2.5, y: 0.01 + R() * 0.8, props: { size: 0.01 + R() * 0.09, lift: Math.round(R() * 40) / 20, heater: `p${Math.floor(R() * n)}` } })
	}
	const st = { time_lapse: [1, 60, 100000][Math.floor(R() * 3)], gravity: ["earth", "moon", "none", 30][Math.floor(R() * 4)], air: R() < 0.7 }
	try {
		const pr = sim.prepare({ version: 2, items, seconds: 3, release: R() * 0.5, settings: st })
		const m = B.handle({ id: 9, doc: pr.doc, rate: 120 })
		if (m.error) broke++
		else if (JSON.stringify(m.track).includes("null")) nonFinite++
	} catch (e) {
		broke++
	}
}
ok(broke === 0 && nonFinite === 0, "120 random toy scenes: no exception, nothing non-finite", `${broke} broke, ${nonFinite} non-finite`)

console.log(failed ? `${failed} FAILED` : "ALL PASS")
process.exit(failed ? 1 : 0)
