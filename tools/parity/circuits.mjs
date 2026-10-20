// The circuits module's parity checks (machines/mod_circuits.py == web/sim/modules/circuits.js, and the engine in node == the browser bundle):
//   catalog   the circuits types' catalog entries (props, links, readouts, module) and previews are the same in both languages
//   docs      the lesson demos (tools/parity/fixtures/circuits-demos.json) and random circuit scenes (every circuits type with random props,
//             wires between random terminals, ends set and unset (joined as current flows), free ends, testers with things across them, and
//             the other modules' things the circuit meets: compasses and magnets (a straight wire's field, a coil's flux), desk lamps,
//             flashlights and sunlight (a solar panel's light), paper clips) build the same document, resolved props and warnings, the
//             document's JSON byte for byte
//   engine    a sample of those documents run by the server's engine (node, tooling/src/sim with the engine's math) and by the browser bundle
//             (web/sim/engine-worker.js): the same track, byte for byte (placements, readings, events); no NaN
//   summary   items.py summarize == web/sim summarize on those tracks (every circuits goal kind: lights, stays_dark, glows_brighter, buzzes,
//             spins, current, conducts, deflects, induces)
//   demos     every demo's goals come out as it expects (its `expect` list)
//   node --no-warnings tools/parity/circuits.mjs [--n 150] [--engine 16] [--seed 7]
// Exits 1 on any mismatch. Needs nothing running (it builds with machines/ and web/sim directly).
import { execFileSync } from "node:child_process"
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
const NENGINE = arg("--engine", 16)
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
const plugins = await import(pathToFileURL(join(PG, "web/sim/plugins.js")).href)
ok(sim.MODULES.includes("mod_circuits"), "web/sim loads the circuits module", sim.MODULES.join(","))
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_circuits.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30, env: { ...process.env } }).toString())

// ---- scenes
const CIRC = Object.keys(items.TYPES).filter((k) => items.TYPES[k].module === "circuits").sort()
const PARTS = CIRC.filter((k) => k !== "wire" && k !== "circuit-board")
const OTHERS = ["compass", "bar-magnet", "paper-clip", "lamp", "flashlight", "sunlight", "coin-flat", "eraser", "steel-ball", "box"].filter((k) => items.TYPES[k])
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
const goalKinds = plugins.store().goals
const CIRC_GOALS = ["lights", "stays_dark", "glows_brighter", "buzzes", "spins", "current", "conducts", "deflects", "induces"]
function randomScene(k) {
	const its = [{ id: "table", type: "table", x: 1.3, y: 0, props: {} }]
	const n = 2 + Math.floor(rand() * 6)
	const parts = []
	for (let i = 0; i < n; i++) {
		const type = rand() < 0.75 ? pick(PARTS) : pick(OTHERS)
		const id = `${type.replace(/[^a-z]/g, "")}${i}`
		const air = ["coil", "electromagnet", "straight-wire", "compass", "bar-magnet"].includes(type) && rand() < 0.7
		its.push({
			id, type, name: rand() < 0.5 ? `${type} ${i}` : undefined, x: between(-0.3, 2.9), y: air ? between(0.05, 0.5) : between(0, 0.05),
			...(rand() < 0.2 ? { angle: pick([-90, 90, 180, between(-45, 45, 1)]) } : {}), props: randomProps(type), ...(rand() < 0.2 ? { fixed: true } : {}),
			...(type === "bar-magnet" && rand() < 0.5 ? { held: true } : {})
		})
		if (PARTS.includes(type)) parts.push(id)
	}
	// wires: between random parts' terminals, ends set or not (joined as current flows), now and then a free end
	const nw = parts.length ? Math.floor(rand() * (2 * parts.length + 1)) : 0
	for (let w = 0; w < nw; w++) {
		const props = {}
		if (rand() < 0.92) props.a = pick(parts)
		if (rand() < 0.92) props.b = pick(parts)
		if (rand() < 0.5) props.a_end = pick(["+", "-"])
		if (rand() < 0.5) props.b_end = pick(["+", "-"])
		if (rand() < 0.2) props.length = between(0.05, 1.5, 2)
		its.push({ id: `w${w}`, type: "wire", x: 0, y: 0, props })
	}
	// a lamp or a flashlight sometimes aimed at a solar panel
	const panel = its.find((i) => i.type === "solar-panel")
	const lamp = its.find((i) => i.type === "lamp")
	if (panel && lamp && rand() < 0.7) lamp.props.target = panel.id
	const scene = { version: 2, id: `circ${k}`, name: `Circuits ${k}`, seconds: pick([1, 1.5, 2]), release: 0.3, stage, items: its, goals: [] }
	for (let g = 0; g < 3; g++) {
		const kind = pick(CIRC_GOALS)
		const s = goalKinds.get(kind)?.sample?.(scene, pick)
		if (s) scene.goals.push(s)
	}
	return scene
}
const demosRaw = JSON.parse(readFileSync(join(HERE, "fixtures", "circuits-demos.json"), "utf8"))
const demos = demosRaw.map(({ expect, ...s }) => s)
const scenes = [...demos, ...Array.from({ length: N }, (_, k) => randomScene(k))]
const clean = scenes.map((s) => {
	try {
		return sim.clean(s)
	} catch (e) {
		return { error: e.message }
	}
})
const usable = clean.map((s, i) => (s.error ? null : i)).filter((i) => i !== null)

// ---- catalog entries and previews
const P0 = py({ cases: [], types: CIRC })
const jsCat = sim.catalog().types
const jsTypes = CIRC.map((k) => jsCat.find((t) => t.key === k)).map((t) => {
	const { preview, ...rest } = t ?? {}
	return rest
})
ok(isDeepStrictEqual(P0.types, jsTypes), "catalog entries equal (the circuits types)", `${jsTypes.length} types${isDeepStrictEqual(P0.types, jsTypes) ? "" : "; " + diff(P0.types, jsTypes)}`)
const prevBad = CIRC.filter((k) => !isDeepStrictEqual(P0.previews[k], jsCat.find((t) => t.key === k)?.preview))
ok(prevBad.length === 0, "catalog previews equal", prevBad.length ? `${prevBad.join(",")}: ${diff(P0.previews[prevBad[0]], jsCat.find((t) => t.key === prevBad[0])?.preview)}` : `${CIRC.length} previews`)
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
	} else if (js.doc) built.push({ scene: s, doc: js.doc, resolved: js.resolved, demo: i < demos.length ? i : -1 })
})
const withCirc = built.filter((b) => b.doc.processes?.some((p) => p.kind === "circuit"))
ok(bad === 0, "documents: items.py == web/sim (docs byte for byte, resolved, warnings)", `${usable.length} scenes (${scenes.length - usable.length} refused by clean in both), ${bad} differ, ${withCirc.length} with a circuit`)

// ---- engine: node (the server's) vs the browser bundle, and the summaries
await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
const eplugins = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
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
	return JSON.stringify({ fps: track.fps, frames: slim, impacts: track.impacts, ...eplugins.slimExtras(track, round) })
}
const B = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href)
const demoDocs = withCirc.filter((b) => b.demo >= 0)
const rest = withCirc.filter((b) => b.demo < 0)
const sample = [...demoDocs, ...rest.filter((_, i) => i % Math.max(1, Math.floor(rest.length / Math.max(1, NENGINE))) === 0).slice(0, NENGINE)]
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
ok(same === sample.length, "engine: the server's (node) == the browser bundle, byte for byte", `${same} of ${sample.length} circuit documents (${demoDocs.length} demos)`)
const nan = cases.filter(({ track }) => /NaN|null,"y":null|"x":null/.test(JSON.stringify(track.frames.at(-1))) || /NaN/.test(JSON.stringify(track.state ?? {})))
ok(nan.length === 0, "no run ends with a lost (NaN) placement or reading", nan.map(({ b }) => b.scene.id).join(","))
const PS = py({ cases: cases.map(({ b, track }) => ({ scene: b.scene, track })) })
let sumSame = 0
let goalsSeen = 0
const kindsSeen = new Set()
cases.forEach(({ b, track }, k) => {
	const js = sim.finish(b.scene, b.doc, b.resolved, track)
	goalsSeen += js.summary.goals.length
	for (const g of js.summary.goals) kindsSeen.add(g.kind)
	if (isDeepStrictEqual(PS.results[k].summary, JSON.parse(JSON.stringify(js.summary)))) sumSame++
	else console.log(`  summary differs on ${b.scene.id}: ${diff(PS.results[k].summary, JSON.parse(JSON.stringify(js.summary)))}`)
})
ok(sumSame === cases.length, "summary: items.py == web/sim (the circuits goal kinds, readings, happenings)", `${sumSame} of ${cases.length}, ${goalsSeen} goals of ${kindsSeen.size} kinds: ${[...kindsSeen].sort().join(", ")}`)
// ---- the demos' outcomes
let demoBad = 0
for (const { b, track } of cases) {
	if (b.demo < 0) continue
	const want = demosRaw[b.demo].expect ?? []
	const got = sim.finish(b.scene, b.doc, b.resolved, track).summary.goals.map((g) => g.ok)
	if (!isDeepStrictEqual(got, want)) {
		demoBad++
		console.log(`  demo ${b.scene.id}: goals ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
	}
}
ok(demoBad === 0, "demos: every lesson demo's goals come out as expected", `${demoDocs.length} demos`)
console.log(failed ? `${failed} FAILED` : "ALL PASS")
process.exit(failed ? 1 : 0)
