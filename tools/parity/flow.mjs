// The flow module's parity and engine checks (machines/mod_flow.py == web/sim/modules/flow.js; the server's engine == the browser bundle):
//   catalog   every flow type's catalog entry (props, links, readouts, module) and the "Pouring & flowing" category, Python == JS
//   build     documents, resolved props and warnings, Python == JS: every type at its defaults, at its props' limits and at --n random props
//             each (positions, angles, fixed), alone and with the catalog's containers (the build hook's flow-basin records: cups, mugs, jars,
//             buckets, bowls, boxes) and the fluids module's (beakers, jugs, tanks), hoses linked every way (from/to, to nothing, to a missing
//             item), and scenes without a pouring item (no flow-basin record may appear)
//   engine    (--engine) the server's engine (node, the bundle's math) == the browser bundle web/sim/engine-worker.js, byte for byte, on --per
//             scenes of each kind; the readings and keyframes finite; and the summaries (every goal kind sampled, readings) Python == JS
//   node --no-warnings tools/parity/flow.mjs [--n 20] [--engine] [--per 2] [--seed 11]
import { execFileSync } from "../child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i >= 0 ? process.argv[i + 1] : d
}
const N = Number(arg("--n", 20))
let seed = Number(arg("--seed", 11)) >>> 0
const rnd = () => {
	seed = (seed + 0x6d2b79f5) >>> 0
	let t = seed
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (a) => a[Math.floor(rnd() * a.length)]
let failed = 0
let cases = 0
const ok = (cond, what, detail = "") => {
	cases++
	if (!cond) {
		failed++
		console.log(`FAIL  ${what}${detail ? `  (${detail})` : ""}`)
	}
}
function firstDiff(a, b, path = "") {
	if (isDeepStrictEqual(a, b)) return ""
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return `${path}: ${JSON.stringify(a)?.slice(0, 120)} vs ${JSON.stringify(b)?.slice(0, 120)}`
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const d = firstDiff(a[k], b[k], `${path}.${k}`)
		if (d) return d
	}
	return path
}

const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
await (sim.ready ?? Promise.resolve())
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_flow.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30 }).toString())

const cat = sim.catalog()
const TYPES = cat.types.filter((t) => t.module === "flow")
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, extra = {}) => ({ version: 2, id: "f", name: "Flow", seconds: 2.0, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, ...items], goals: [], ...extra })
const randomProp = (p) => {
	if (p.kind === "bool") return rnd() < 0.5
	if (p.kind === "choice") return pick(p.choices)
	if (p.kind === "int") return p.min + Math.floor(rnd() * (p.max - p.min + 1))
	const steps = Math.round((p.max - p.min) / p.step)
	return Number((p.min + Math.floor(rnd() * (steps + 1)) * p.step).toFixed(6))
}
/** Where an item of this type goes: pourers and wheels in the air, the bottle on the table. */
const placeY = (key) => (["pitcher", "tap", "waterwheel"].includes(key) ? 0.3 + rnd() * 0.4 : key === "hose" ? 0.05 + rnd() * 0.3 : 0)
const CATCH = ["cup", "plastic-cup", "glass-jar", "coffee-mug", "bucket", "box", "bowl", "beaker", "measuring-jug", "graduated-cylinder", "water-tank"]
const catchY = (key) => (key === "coffee-mug" ? 0.0475 : key === "bowl" ? 0.0025 : 0)

// ---- catalog
const P0 = py({ scenes: [] })
ok(Object.keys(P0.errors).length === 0, "every Python module loads", JSON.stringify(P0.errors))
const jsTypes = TYPES.map(({ preview, ...t }) => t)
ok(TYPES.length === 5, "the flow module's five types", TYPES.map((t) => t.key).join(", "))
ok(isDeepStrictEqual(P0.types, jsTypes), "catalog entries equal (props, links, readouts, module)", `${P0.types.length} vs ${jsTypes.length}: ${firstDiff(P0.types, jsTypes)}`)
ok(P0.categories.includes("Pouring & flowing") && cat.categories.includes("Pouring & flowing"), "the Pouring & flowing category")

// ---- build
const scenes = []
for (const t of TYPES) {
	scenes.push(scene([{ id: "it", type: t.key, x: 1.2, y: placeY(t.key) }]))
	for (const end of ["min", "max"]) {
		const props = {}
		for (const p of t.props) if (!p.common && (p.kind === "number" || p.kind === "int")) props[p.key] = p[end]
		scenes.push(scene([{ id: "it", type: t.key, x: 1.2, y: placeY(t.key), props }]))
	}
	for (let k = 0; k < N; k++) {
		const props = {}
		for (const p of t.props) if (!p.common && p.key !== "material" && rnd() < 0.6) props[p.key] = randomProp(p)
		const items = [{ id: "it", type: t.key, x: 0.4 + 2 * rnd(), y: placeY(t.key), angle: rnd() < 0.15 ? pick([10, -25, 45]) : 0, props, fixed: rnd() < 0.1 }]
		// containers to catch and to link
		for (let c = 0; c < Math.floor(rnd() * 3); c++) {
			const key = pick(CATCH)
			items.push({ id: `c${c}`, type: key, x: 0.3 + 2.5 * rnd(), y: catchY(key), props: key === "beaker" ? { fill_ml: pick([0, 150, 400]) } : {} })
		}
		if (t.key === "hose") {
			const cs = items.filter((i) => i.id.startsWith("c")).map((i) => i.id)
			props.from = pick([...cs, "nothing", "it"])
			if (rnd() < 0.6) props.to = pick([...cs, "nowhere"])
		}
		scenes.push(scene(items))
	}
}
// combinations: two pitchers into a jar, a tap over a wheel, a bottle and a hose between beakers, and no pouring item at all (no basins)
scenes.push(scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "a", type: "pitcher", x: 1.12, y: 0.32, props: { vessel: "cup", dye: "blue" } }, { id: "b", type: "pitcher", x: 1.28, y: 0.32, props: { vessel: "cup", dye: "yellow", pour_to: "left", pour_at: 2 } }]))
scenes.push(scene([{ id: "w", type: "waterwheel", x: 1.2, y: 0.5 }, { id: "t", type: "tap", x: 1.29, y: 0.8 }, { id: "bu", type: "bucket", x: 1.3, y: 0 }]))
scenes.push(scene([{ id: "b", type: "leaky-bottle", x: 0.4, y: 0, props: { kept_full: true } }, { id: "up", type: "beaker", x: 1.6, y: 0, props: { size: "1000 mL", fill_ml: 800 } }, { id: "dn", type: "beaker", x: 2.0, y: 0 }, { id: "h", type: "hose", x: 1.8, y: 0.3, props: { from: "up", to: "dn" } }]))
const plain = scene([{ id: "cup", type: "cup", x: 1.0, y: 0 }, { id: "mug", type: "coffee-mug", x: 1.4, y: 0.0475 }, { id: "ball", type: "tennis-ball", x: 1.0, y: 0.4 }])
scenes.push(plain)

const cleaned = []
const jsOut = []
for (const s of scenes) {
	try {
		const c = sim.clean(s)
		cleaned.push(c)
		const r = sim.layout(c)
		jsOut.push({ doc: r.doc, resolved: r.resolved, warnings: r.warnings })
	} catch (e) {
		cleaned.push(s)
		jsOut.push({ error: String(e.message).replace(/^can't build this scene: /, "") })
	}
}
const pyOut = py({ scenes: cleaned }).results
let docs = 0
for (let k = 0; k < scenes.length; k++) {
	const a = pyOut[k]
	const b = jsOut[k]
	const what = `${scenes[k].items.slice(1).map((i) => i.type).join(" + ")} #${k}`
	if (a.error !== undefined || b.error !== undefined) {
		ok(a.error === b.error, `${what}: the same error`, `${a.error} | ${b.error}`)
		continue
	}
	docs++
	ok(isDeepStrictEqual(a.doc, b.doc), `${what}: document`, firstDiff(a.doc, b.doc))
	ok(isDeepStrictEqual(a.resolved, b.resolved), `${what}: resolved`, firstDiff(a.resolved, b.resolved))
	ok(isDeepStrictEqual(a.warnings, b.warnings), `${what}: warnings`, firstDiff(a.warnings, b.warnings))
}
const plainDoc = jsOut[scenes.indexOf(plain)].doc
ok(!(plainDoc.processes ?? []).some((p) => String(p.kind).startsWith("flow-")), "a scene without a pouring item gets no flow record")

// ---- engine
if (process.argv.includes("--engine")) {
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
	const B = await import(pathToFileURL(join(PG, "web/sim/engine-worker.js")).href).catch(() => null)
	const runs = []
	const picks = []
	for (let k = 0; k < scenes.length; k++) {
		if (jsOut[k].error !== undefined) continue
		const t = scenes[k].items.slice(1, 2).map((i) => i.type).join("+")
		if (picks.filter((p) => p.t === t).length >= Number(arg("--per", 2))) continue
		picks.push({ k, t })
	}
	for (let k = scenes.length - 4; k < scenes.length; k++) if (!picks.some((p) => p.k === k)) picks.push({ k, t: "combo" })
	for (const { k } of picks) {
		const doc = jsOut[k].doc
		let server
		try {
			server = serverRun(doc)
		} catch (e) {
			ok(false, `engine runs ${scenes[k].items.slice(1).map((i) => i.type).join(" + ")} #${k}`, e.message)
			continue
		}
		if (B?.handle) {
			const msg = B.handle({ id: k, doc, rate: 120 })
			ok(msg.error === undefined && JSON.stringify(msg.track) === server, `bundle == server engine: ${scenes[k].items.slice(1).map((i) => i.type).join(" + ")} #${k}`, msg.error ?? `${server.length} bytes vs ${JSON.stringify(msg.track).length}`)
		}
		const track = JSON.parse(server)
		ok(!/null|NaN/.test(JSON.stringify(track.state ?? {})) && !/null|NaN/.test(JSON.stringify(track.keyframes ?? {})) && !/null|NaN/.test(JSON.stringify(track.frames)), `finite readings, keyframes and placements #${k}`)
		runs.push({ k, track })
	}
	const kinds = sim.plugins.modules().find((m) => m.name === "mod_flow")?.goals ?? []
	const sc = []
	const tr = []
	for (const { k, track } of runs) {
		const goals = kinds.map((g) => g.sample?.(cleaned[k], pick)).filter(Boolean)
		sc.push({ ...cleaned[k], goals })
		tr.push(track)
	}
	const P = py({ scenes: sc, tracks: tr }).results
	let goals = 0
	for (let i = 0; i < sc.length; i++) {
		const js = sim.finish(sc[i], jsOut[runs[i].k].doc, jsOut[runs[i].k].resolved, tr[i]).summary
		goals += sc[i].goals.length
		ok(isDeepStrictEqual(P[i].summary, js), `summary Python == JS #${runs[i].k} (${sc[i].goals.length} goals)`, firstDiff(P[i].summary, js))
	}
	console.log(`engine: ${runs.length} runs${B?.handle ? " (bundle compared)" : " (no bundle export: server engine only)"}, ${goals} sampled goals`)
}

console.log(`flow parity: ${cases} checks, ${docs} documents, ${failed} mismatches`)
process.exit(failed ? 1 : 0)
