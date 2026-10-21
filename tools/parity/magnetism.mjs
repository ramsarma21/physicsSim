// The magnetism module's parity checks (machines/mod_magnetism.py == web/sim/modules/magnetism.js, and the engine in node == the browser bundle):
//   catalog   the 23 magnetism types' catalog entries (props, links, readouts, module) and previews are the same in both languages
//   docs      the lesson demos (tools/parity/fixtures/magnetism-demos.json) and random magnetism scenes (every type, random props, angles, held and
//             free, with steel and non-magnetic catalog things the build hook gives records to) build the same document, resolved props and
//             warnings in both, the document's JSON byte for byte
//   engine    a sample of those documents run by the server's engine (node, tooling/src/sim with the engine's math) and by the browser bundle
//             (web/sim/engine-worker.js): the same track, byte for byte (placements, readings, events)
//   summary   items.py summarize == web/sim summarize on those tracks (the goal kinds attracts, repels, sticks, lifts, points, holds, levitates,
//             not_attracted)
//   node --no-warnings tools/parity/magnetism.mjs [--n 150] [--engine 12] [--seed 11]
// Exits 1 on any mismatch. Needs nothing running (it builds with machines/ and web/sim directly).
import { execFileSync } from "../child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i >= 0 ? Number(process.argv[i + 1]) : d
}
const N = arg("--n", 150)
const NENGINE = arg("--engine", 12)
let seed = arg("--seed", 11) >>> 0
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
const diff = (a, b, path = "") => {
	if (isDeepStrictEqual(a, b)) return null
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return `${path}: ${JSON.stringify(a)?.slice(0, 300)} vs ${JSON.stringify(b)?.slice(0, 300)}`
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const d = diff(a[k], b[k], `${path}.${k}`)
		if (d) return d
	}
	return `${path}: ?`
}

// ---- the JS side: web/sim with every module, as the app loads it
const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
if (sim.ready) await sim.ready
const items = await import(pathToFileURL(join(PG, "web/sim/items.js")).href)
ok(sim.MODULES.includes("mod_magnetism"), "web/sim loads the magnetism module", sim.MODULES.join(","))
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_magnetism.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30, env: { ...process.env } }).toString())

// ---- scenes
const MAG = Object.keys(items.TYPES).filter((k) => items.TYPES[k].module === "magnetism").sort()
// (other modules' things the build hook gives records: steel and iron, metals, light dielectrics; and far ones out of a magnet's reach)
const OTHERS = ["steel-ball", "soda-can", "coin-flat", "ball", "box", "density-cube", "ping-pong-ball", "penny", "spoon", "feather", "paper-sheet", "steel-wool"].filter((k) => items.TYPES[k])
const stage = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
function randomProps(type) {
	const T = items.TYPES[type]
	const P = {}
	for (const p of T.props) {
		if (rand() < 0.5) continue
		if (p.kind === "choice") P[p.key] = pick(p.choices)
		else if (p.kind === "bool") P[p.key] = rand() < 0.5
		else if (p.kind === "int" && Number.isFinite(p.lo) && Number.isFinite(p.hi)) P[p.key] = Math.round(between(p.lo, Math.min(p.hi, p.lo + 12), 0))
		else if (Number.isFinite(p.lo) && Number.isFinite(p.hi)) P[p.key] = between(p.lo, p.hi, 4)
	}
	return P
}
const GOALS = ["attracts", "repels", "sticks", "lifts", "points", "holds", "levitates", "not_attracted"]
function randomScene(k) {
	const its = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	const n = 2 + Math.floor(rand() * 6)
	for (let i = 0; i < n; i++) {
		const type = rand() < 0.85 ? pick(MAG) : pick(OTHERS)
		const id = `${type.replace(/[^a-z]/g, "")}${i}`
		its.push({ id, type, x: between(-0.3, 2.9), y: between(0, 0.5), ...(rand() < 0.25 ? { angle: pick([-90, 90, 180, between(-45, 45, 1)]) } : {}), props: randomProps(type), ...(rand() < 0.25 ? { fixed: true } : {}) })
	}
	const ids = its.filter((i) => i.type !== "table").map((i) => i.id)
	const goals = []
	for (let g = 0; g < 3 && ids.length; g++) {
		const kind = pick(GOALS)
		const a = pick(ids)
		const b = pick(ids)
		goals.push(
			kind === "attracts" || kind === "lifts" || kind === "not_attracted" ? { kind, source: a, item: b, ...(kind === "lifts" && rand() < 0.4 ? { min_m: 0.01 } : {}), ...(kind === "not_attracted" && rand() < 0.4 ? { max_m: 0.01 } : {}) }
				: kind === "repels" ? { kind, a, b, ...(rand() < 0.4 ? { min_m: 0.02 } : {}) }
					: kind === "sticks" ? { kind, item: a, to: b }
						: kind === "points" ? { kind, compass: a, ...(rand() < 0.5 ? { toward: b } : { angle_deg: pick([0, 90, 180, 270]) }), ...(rand() < 0.3 ? { tol_deg: 30 } : {}) }
							: kind === "holds" ? { kind, magnet: a, count: pick([1, 2, 3]), ...(rand() < 0.3 ? { items: [b] } : {}) }
								: { kind, item: a, ...(rand() < 0.3 ? { count: 2 } : {}) }
		)
	}
	return { version: 2, id: `mag${k}`, name: `Magnetism ${k}`, seconds: pick([1, 1.5, 2]), release: 0.2, stage, items: its, goals }
}
const demos = JSON.parse(readFileSync(join(HERE, "fixtures", "magnetism-demos.json"), "utf8")).map(({ expect, ...s }) => s)
// (every magnetism type with all its numbers at their least, and at their most, among a box, a ball and a can: a ring magnet's hole at its 5 mm
// least once made a dowel 0 m wide, and Python's overlap check divided by zero where web/sim built the scene: verify, 20 Oct)
function cornerScene(type, end, k) {
	const T = items.TYPES[type]
	const P = {}
	for (const p of T.props) if ((p.kind === "number" || p.kind === "int") && Number.isFinite(p.lo) && Number.isFinite(p.hi)) P[p.key] = end === "lo" ? p.lo : p.kind === "int" ? Math.min(p.hi, p.lo + 12) : p.hi
	const its = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "m", type, x: 1.0, y: 0.0, props: P }]
	for (const [i, o] of OTHERS.entries()) its.push({ id: `o${i}`, type: o, x: 0.97 + 0.02 * i, y: 0.0, props: {} })
	return { version: 2, id: `magc${k}`, name: `Corner ${type} ${end}`, seconds: 1, release: 0.2, stage, items: its, goals: [] }
}
const corners = MAG.flatMap((t, i) => [cornerScene(t, "lo", 2 * i), cornerScene(t, "hi", 2 * i + 1)])
corners.push({ version: 2, id: "magc-ring", name: "Ring hole at its least", seconds: 1, release: 0.2, stage, items: [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }, { id: "r", type: "ring-magnets", x: 1.0, y: 0, props: { count: 1, outer: 0.015, hole: 0.005, thickness: 0.003 } }, { id: "b", type: "box", x: 1.0, y: 0.0, props: {} }], goals: [] })
const scenes = [...demos, ...corners, ...Array.from({ length: N }, (_, k) => randomScene(k))]
const clean = scenes.map((s) => {
	try {
		return sim.clean(s)
	} catch (e) {
		return { error: e.message }
	}
})
const usable = clean.map((s, i) => (s.error ? null : i)).filter((i) => i !== null)

// ---- catalog entries and previews
const P0 = py({ cases: [], types: MAG })
const jsCat = sim.catalog().types
const jsTypes = MAG.map((k) => jsCat.find((t) => t.key === k)).map((t) => {
	const { preview, ...rest } = t ?? {}
	return rest
})
ok(isDeepStrictEqual(P0.types, jsTypes), "catalog entries equal (the magnetism types)", `${jsTypes.length} types${isDeepStrictEqual(P0.types, jsTypes) ? "" : "; " + diff(P0.types, jsTypes)}`)
const prevBad = MAG.filter((k) => !isDeepStrictEqual(P0.previews[k], jsCat.find((t) => t.key === k)?.preview))
ok(prevBad.length === 0, "catalog previews equal", prevBad.length ? `${prevBad.join(",")}: ${diff(P0.previews[prevBad[0]], jsCat.find((t) => t.key === prevBad[0])?.preview)}` : `${MAG.length} previews`)
ok(Object.keys(P0.errors ?? {}).length === 0, "no Python module failed to load", JSON.stringify(P0.errors))

// ---- documents
const P = py({ cases: usable.map((i) => ({ scene: clean[i] })) })
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
	const same = p.error !== undefined ? js.error === `can't build this scene: ${p.error}` || js.error?.includes(p.error) : isDeepStrictEqual(p.doc, js.doc) && isDeepStrictEqual(p.resolved, js.resolved) && isDeepStrictEqual(p.warnings, js.warnings) && JSON.stringify(p.doc) === JSON.stringify(js.doc)
	if (!same) {
		bad++
		if (bad <= 3) console.log(`  scene ${s.id} differs: ${p.error ?? ""} ${js.error ?? ""} ${p.doc && js.doc ? diff({ doc: p.doc, resolved: p.resolved, warnings: p.warnings }, { doc: js.doc, resolved: js.resolved, warnings: js.warnings }) : ""}`)
	} else if (js.doc) built.push({ scene: s, doc: js.doc, resolved: js.resolved })
})
const withMag = built.filter((b) => b.doc.processes?.some((p) => p.kind === "magnetism"))
ok(bad === 0, "documents: items.py == web/sim (docs byte for byte, resolved, warnings)", `${usable.length} scenes (${scenes.length - usable.length} refused by clean in both), ${bad} differ, ${withMag.length} with magnetism records`)

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
const B = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const rest = withMag.slice(demos.length)
const sample = [...withMag.slice(0, demos.length), ...rest.filter((_, i) => i % Math.max(1, Math.floor(rest.length / Math.max(1, NENGINE))) === 0).slice(0, NENGINE)]
let same = 0
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
	else console.log(`  engine differs on ${b.scene.id}: ${server.slice(0, 160)} | ${browser.slice(0, 160)}`)
	if (msg.track) cases.push({ b, track: msg.track })
}
ok(same === sample.length, "engine: the server's (node) == the browser bundle, byte for byte", `${same} of ${sample.length} magnetism documents (${demos.length} demos)`)
const nan = cases.filter(({ track }) => /NaN|null,"y":null|"x":null/.test(JSON.stringify(track.frames.at(-1))))
ok(nan.length === 0, "no run ends with a lost (NaN) placement", nan.map(({ b }) => b.scene.id).join(","))
const PS = py({ cases: cases.map(({ b, track }) => ({ scene: b.scene, track })) })
let sumSame = 0
let goalsSeen = 0
cases.forEach(({ b, track }, k) => {
	const js = sim.finish(b.scene, b.doc, b.resolved, track)
	goalsSeen += js.summary.goals.length
	if (isDeepStrictEqual(PS.results[k].summary, JSON.parse(JSON.stringify(js.summary)))) sumSame++
	else console.log(`  summary differs on ${b.scene.id}: ${diff(PS.results[k].summary, JSON.parse(JSON.stringify(js.summary)))}`)
})
ok(sumSame === cases.length, "summary: items.py == web/sim (the magnetism goal kinds, readings, happenings)", `${sumSame} of ${cases.length}, ${goalsSeen} goals`)
console.log(failed ? `${failed} FAILED` : "ALL PASS")
process.exit(failed ? 1 : 0)
