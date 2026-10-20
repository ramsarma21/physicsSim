// The heat module's parity checks (machines/mod_heat.py == web/sim/modules/heat.js, and the engine in node == the browser bundle):
//   catalog   the heat types' catalog entries (props, links, readouts, module) are the same in both languages
//   docs      random heat scenes (every heat type, random props, settings, the ice cubes and rods it extends, a fluids tank whose water it bridges)
//             build the same document, resolved props and warnings in both
//   engine    a sample of those documents run by the server's engine (node, the bundle's math) and by the browser bundle (built here from
//             tools/engine-worker-entry.ts): the same track, byte for byte (readings, events, resized bodies)
//   summary   items.py summarize == web/sim summarize on those tracks (the heat goal kinds: melts, melts_first, melt_fraction, reaches, warmer,
//             boils, freezes, dries, dew)
//   node tools/parity/heat.mjs [--n 200] [--engine 12] [--seed 7]
// Exits 1 on any mismatch. Needs nothing running (it builds with machines/ and web/sim directly).
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i >= 0 ? Number(process.argv[i + 1]) : d
}
const N = arg("--n", 200)
const NENGINE = arg("--engine", 12)
let seed = arg("--seed", 7) >>> 0
const rand = () => {
	// mulberry32
	seed = (seed + 0x6d2b79f5) >>> 0
	let t = seed
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)]
const between = (lo, hi, d = 3) => Number((lo + rand() * (hi - lo)).toFixed(d))
let failed = 0
const ok = (cond, what, detail = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
	if (!cond) failed++
}

// ---- the JS side: web/sim with its modules (heat registered as web/sim/modules/index.js does, when the index does not list it yet)
process.env.PLAYGROUND_MODULES = process.env.PLAYGROUND_MODULES ?? "fluids,heat,flow,optics,granular,mechanics"
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const items = await import(pathToFileURL(join(PG, "web/sim/items.js")).href)
if (!sim.MODULES.includes("mod_heat")) {
	const heat = await import(pathToFileURL(join(PG, "web/sim/modules/heat.js")).href)
	items.use_catalog_module("mod_heat", heat.register_all)
	const mod = sim.plugins.registerModule({ ...heat.plugin, name: "mod_heat" })
	for (const k of mod.goals) items.register_goal_kind(k.kind, (ctx, g) => k.summarize(ctx, g))
}
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_heat.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30, env: { ...process.env } }).toString())

// ---- scenes
const HEAT_TYPES = ["salt-pile", "plate", "bowl", "lamp", "thermometer", "hot-plate", "saucepan", "drink-cup", "spoon", "meltable", "puddle", "sanding-block", "candle-jar", "ball-and-ring", "bimetal-strip"]
// other modules' and the catalog's types heat extends or takes part with (a lit candle, flow's pitchers and taps pouring, a beaker's liquid, sunlight
// through a lens onto paper, a sand tray)
const EXTRA_TYPES = ["candle", "pitcher", "tap", "beaker", "sunlight", "convex-lens", "paper-sheet", "sand-tray"]
const stage = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
function randomProps(type) {
	const T = items.TYPES[type]
	const P = {}
	for (const p of T.props) {
		if (rand() < 0.5) continue
		if (p.kind === "choice") P[p.key] = pick(p.choices)
		else if (p.kind === "bool") P[p.key] = rand() < 0.5
		else if (p.kind === "number" && Number.isFinite(p.lo) && Number.isFinite(p.hi)) P[p.key] = between(p.lo, Math.min(p.hi, p.lo + (p.hi - p.lo)), 4)
	}
	if (T.material && rand() < 0.4) P.material = pick(T.materials.length ? T.materials : [T.material])
	return P
}
function randomScene(k) {
	const its = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	const n = 2 + Math.floor(rand() * 6)
	const cubes = []
	for (let i = 0; i < n; i++) {
		const r = rand()
		const type = r < 0.22 ? "ice-cube" : r < 0.27 ? pick(["steel-rod", "wooden-rod"]) : r < 0.3 ? "water-tank" : r < 0.42 ? pick(EXTRA_TYPES) : pick(HEAT_TYPES)
		const id = `${type.replace(/[^a-z]/g, "")}${i}`
		const props = type === "ice-cube" ? { width: between(0.01, 0.08), height: between(0.01, 0.08), depth: between(0.01, 0.08), ...(rand() < 0.5 ? { start_temp_c: between(-30, 0, 1) } : {}) } : type === "water-tank" ? { liquid: pick(["water", "salt water", "sea water", "vegetable oil", "honey", "rubbing alcohol"]), length: 0.3 } : randomProps(type)
		if (type === "candle") Object.assign(props, { height: 0.08, lit: rand() < 0.8 })
		if (type === "beaker" && rand() < 0.5) props.liquid = pick(["water", "vegetable oil", "corn syrup"])
		if (type === "lamp" && cubes.length && rand() < 0.6) props.target = pick(cubes)
		its.push({ id, type, x: between(-0.3, 2.9), y: between(0, 0.6), angle: rand() < 0.2 ? between(-30, 30, 1) : 0, props, ...(rand() < 0.15 ? { fixed: true } : {}) })
		if (type === "ice-cube") cubes.push(id)
	}
	const settings = rand() < 0.6 ? { ...(rand() < 0.7 ? { time_lapse: pick([60, 300, 600, 1800, 3600]) } : {}), ...(rand() < 0.5 ? { room_temp: between(-20, 40, 1) } : {}) } : undefined
	const goals = []
	const ids = its.filter((i) => i.type !== "table").map((i) => i.id)
	for (let g = 0; g < 3 && ids.length; g++) {
		const kind = pick(["melts", "melts_first", "melt_fraction", "reaches", "warmer", "boils", "freezes", "dries", "dew", "burns_out", "scorches", "passes_through", "bends"])
		const a = pick(ids)
		const b = pick(ids)
		goals.push(kind === "melts_first" || kind === "warmer" ? { kind, a, b, ...(kind === "warmer" && rand() < 0.5 ? { at_s: 600 } : {}) } : kind === "reaches" ? { kind, item: a, ...(rand() < 0.5 ? { at_least_c: 30 } : { at_most_c: 5 }), ...(rand() < 0.3 ? { before_s: 900 } : {}) } : kind === "melt_fraction" ? { kind, item: a, at_least: 0.3, ...(rand() < 0.5 ? { at_s: 1200 } : {}) } : kind === "passes_through" ? { kind, item: a, ...(rand() < 0.5 ? { passes: false } : {}) } : kind === "bends" ? { kind, item: a, at_least_mm: pick([0.5, 2]) } : { kind, item: a, ...(rand() < 0.3 ? { before_s: 3600 } : {}) })
	}
	return { version: 2, id: `heat${k}`, name: `Heat ${k}`, seconds: pick([2, 3, 4]), release: 0.2, stage, items: its, goals, ...(settings ? { settings } : {}) }
}

// a few hand-made scenes: the lesson demos' shapes
const demos = JSON.parse(readFileSync(join(HERE, "fixtures", "heat-demos.json"), "utf8"))
const scenes = [...demos, ...Array.from({ length: N }, (_, k) => randomScene(k))]
const clean = scenes.map((s) => {
	try {
		return sim.clean(s)
	} catch (e) {
		return { error: e.message }
	}
})
const usable = clean.map((s, i) => (s.error ? null : i)).filter((i) => i !== null)

// ---- catalog entries
const P0 = py({ cases: [], types: [...HEAT_TYPES, "ice-cube", "steel-rod", "wooden-rod", "candle", "pitcher", "tap"] })
const jsTypes = [...HEAT_TYPES, "ice-cube", "steel-rod", "wooden-rod", "candle", "pitcher", "tap"].map((k) => sim.catalog().types.find((t) => t.key === k)).filter(Boolean).map(({ preview, ...t }) => t)
ok(isDeepStrictEqual(P0.types, jsTypes), "catalog entries equal (heat types, and the ice cube's, rods', candle's, pitcher's and tap's additions)", `${jsTypes.length} types`)
if (!isDeepStrictEqual(P0.types, jsTypes)) {
	for (let i = 0; i < jsTypes.length; i++) if (!isDeepStrictEqual(P0.types[i], jsTypes[i])) console.log("  differs:", jsTypes[i]?.key, JSON.stringify(P0.types[i]).slice(0, 400), "\n  js:", JSON.stringify(jsTypes[i]).slice(0, 400))
}

// ---- documents
const P = py({ cases: usable.map((i) => ({ scene: clean[i] })) })
let docs = 0
let bad = 0
const built = []
usable.forEach((i, k) => {
	const s = clean[i]
	let js
	try {
		js = sim.layout(s)
	} catch (e) {
		js = { error: e.message }
	}
	const p = P.results[k]
	const same = p.error !== undefined ? js.error === `can't build this scene: ${p.error}` || js.error?.includes(p.error) : isDeepStrictEqual(p.doc, js.doc) && isDeepStrictEqual(p.resolved, js.resolved) && isDeepStrictEqual(p.warnings, js.warnings)
	docs++
	if (!same) {
		bad++
		if (bad <= 3) {
			console.log(`  scene ${s.id} differs`, p.error ?? "", js.error ?? "")
			if (p.doc && js.doc) {
				for (const key of Object.keys(p.doc)) if (!isDeepStrictEqual(p.doc[key], js.doc[key])) console.log(`   doc.${key}:`, JSON.stringify(p.doc[key]).slice(0, 600), "\n   js:", JSON.stringify(js.doc[key]).slice(0, 600))
				if (!isDeepStrictEqual(p.resolved, js.resolved)) console.log("   resolved:", JSON.stringify(p.resolved).slice(0, 400), "\n   js:", JSON.stringify(js.resolved).slice(0, 400))
				if (!isDeepStrictEqual(p.warnings, js.warnings)) console.log("   warnings:", JSON.stringify(p.warnings), "\n   js:", JSON.stringify(js.warnings))
			}
		}
	} else if (js.doc) built.push({ scene: s, doc: js.doc, resolved: js.resolved })
})
ok(bad === 0, "documents: items.py == web/sim (docs, resolved, warnings)", `${docs} scenes, ${bad} differ, ${built.filter((b) => b.doc.processes?.some((p) => p.kind === "heat")).length} with heat`)

// ---- engine: node (the server's) vs the browser bundle, and the summaries
await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
const plugins = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
await import(pathToFileURL(join(PG, "tooling/src/sim/modules/index.ts")).href)
const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) + 0 : null)
const serverRun = (doc) => {
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
const OUT = process.env.HEAT_OUT || join(process.env.TMPDIR || "/tmp", "heat-parity")
mkdirSync(OUT, { recursive: true })
const { DEFINE, INJECT, LOWER_POW, afterLower, lowerOptions } = await import(pathToFileURL(join(PG, "tools/engine-math-transform.ts")).href)
const { createRequire } = await import("node:module")
const esbuild = createRequire(join(PG, "node_modules", "x.js"))("esbuild")
const bundle = join(OUT, "heat-engine.js")
await esbuild.build({
	entryPoints: [join(PG, "tools", "engine-worker-entry.ts")], outfile: bundle, bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
	legalComments: "none", logLevel: "warning", define: DEFINE, inject: [INJECT],
	plugins: [{
		name: "lower-exponent-operator",
		setup(b) {
			b.onLoad({ filter: LOWER_POW }, async (a) => {
				const t = await esbuild.transform(readFileSync(a.path, "utf8"), lowerOptions(a.path))
				return { contents: afterLower(t.code), loader: "js", resolveDir: dirname(a.path) }
			})
		}
	}]
})
const B = await import(pathToFileURL(bundle).href)
const heatDocs = built.filter((b) => b.doc.processes?.some((p) => p.kind === "heat"))
const sample = [...heatDocs.slice(0, demos.length), ...heatDocs.slice(demos.length).filter((_, i) => i % Math.max(1, Math.floor((heatDocs.length - demos.length) / Math.max(1, NENGINE))) === 0)].slice(0, demos.length + NENGINE)
let same = 0
let sumSame = 0
const cases = []
for (const b of sample) {
	let server
	try {
		server = serverRun(b.doc)
	} catch (e) {
		server = `error: ${e.message}`
	}
	const msg = B.handle({ id: 1, doc: b.doc, rate: 120 })
	const browser = msg.error !== undefined ? `error: ${msg.error}` : JSON.stringify(msg.track)
	if (server === browser) same++
	else console.log(`  engine differs on ${b.scene.id}: ${server.slice(0, 120)} | ${browser.slice(0, 120)}`)
	if (msg.track) cases.push({ b, track: msg.track })
}
ok(same === sample.length, "engine: the server's (node) == the browser bundle, byte for byte", `${same} of ${sample.length} heat documents`)
const PS = py({ cases: cases.map(({ b, track }) => ({ scene: b.scene, track })) })
cases.forEach(({ b, track }, k) => {
	const js = sim.finish(b.scene, b.doc, b.resolved, track)
	if (isDeepStrictEqual(PS.results[k].summary, js.summary)) sumSame++
	else console.log(`  summary differs on ${b.scene.id}:\n   py ${JSON.stringify(PS.results[k].summary?.goals)}\n   js ${JSON.stringify(js.summary?.goals)}`)
})
ok(sumSame === cases.length, "summary: items.py == web/sim (heat goal kinds, readings, happenings)", `${sumSame} of ${cases.length}`)
console.log(failed ? `${failed} FAILED` : "ALL PASS")
process.exit(failed ? 1 : 0)
