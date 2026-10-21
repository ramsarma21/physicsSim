// The granular module's parity and engine checks (machines/mod_granular.py == web/sim/modules/granular.js; the server's engine == the browser bundle):
//   catalog   every matter type's catalog entry, Python == JS (props, links, readouts, module, categories)
//   build     documents, resolved props and warnings, Python == JS, for every type at its defaults and at --n random props each (and scenes
//             that combine them: a pile in a tray, a funnel over a tray, castles, hourglasses, stream tables; and grains held by containers:
//             400 g into a 6.5 cm glass, rice in a plastic cup, salt in a bowl and a box, sugar in a mug, rice in a beaker, a cup of sugar
//             tipped over a jar)
//   engine    (--engine) the server's engine (node, the bundle's math) == the browser bundle web/sim/engine-worker.js, byte for byte, on
//             --per scenes of each first item's type (the containers' scenes among them); and the summaries (goal kinds, readings) Python ==
//             JS on those runs, with every goal kind sampled
//   node tools/parity/granular.mjs [--n 40] [--engine] [--seed 7]
import { execFileSync } from "node:child_process"
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
let seed = Number(arg("--seed", 7)) >>> 0
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

const sim = await import(pathToFileURL(join(PG, "web/sim/index.js")).href)
const itemsJs = await import(pathToFileURL(join(PG, "web/sim/items.js")).href)
await (sim.ready ?? Promise.resolve())
if (!sim.catalog().types.some((t) => t.key === "sand-pile")) {
	// (before machines/mod_granular.py is live: register the port by hand, as web/sim/modules/index.js will)
	const m = await import(pathToFileURL(join(PG, "web/sim/modules/granular.js")).href)
	itemsJs.use_catalog_module("mod_granular", m.register_all)
	const mod = sim.plugins.registerModule({ ...m.plugin, name: "mod_granular" })
	for (const k of mod.goals) itemsJs.register_goal_kind(k.kind, (ctx, g) => k.summarize(ctx, g))
}
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_granular.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30 }).toString())

const cat = sim.catalog()
const TYPES = cat.types.filter((t) => t.module === "granular")
const typeOf = (k) => cat.types.find((t) => t.key === k)
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, extra = {}) => ({ version: 2, id: "m", name: "Matter", seconds: 3, release: 0.3, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, ...items], goals: [], ...extra })

/** A random value of a prop within its range, on its step. */
const randomProp = (p) => {
	if (p.kind === "bool") return rnd() < 0.5
	if (p.kind === "choice") return pick(p.choices)
	if (p.kind === "int") return p.min + Math.floor(rnd() * (p.max - p.min + 1))
	const steps = Math.round((p.max - p.min) / p.step)
	return Number((p.min + Math.floor(rnd() * (steps + 1)) * p.step).toFixed(6))
}
const centreY = (t) => (t.key === "stream-table" ? 0.3 : 0)

// ---- catalog
const P0 = py({ scenes: [] })
const jsTypes = TYPES.map(({ preview, ...t }) => t)
ok(isDeepStrictEqual(P0.types, jsTypes), "catalog entries equal (props, links, readouts, module)", `${P0.types.length} vs ${jsTypes.length}`)
ok(P0.categories.includes("Sand & soil") && cat.categories.includes("Sand & soil"), "the Sand & soil category")

// ---- build: defaults, random props, combinations
const scenes = []
for (const t of TYPES) {
	scenes.push(scene([{ id: "it", type: t.key, x: 1.2, y: centreY(t, {}) }]))
	for (let k = 0; k < N; k++) {
		const props = {}
		for (const p of t.props) if (p.key !== "material" && !p.auto && rnd() < 0.6) props[p.key] = randomProp(p)
		if (t.props.some((p) => p.key === "material") && rnd() < 0.5) props.material = pick(t.props.find((p) => p.key === "material").choices)
		scenes.push(scene([{ id: "it", type: t.key, x: 0.4 + 2 * rnd(), y: centreY(t, props), angle: rnd() < 0.2 ? 10 : 0, props, fixed: rnd() < 0.1 }]))
	}
}
// combinations: a pile in a tray, a funnel over a tray, two trays with balls, castles, an hourglass, a stream table with plants and time-lapse
scenes.push(scene([{ id: "tray", type: "sand-tray", x: 1.2, y: 0 }, { id: "ball", type: "steel-ball", x: 1.2, y: 0.4, held: true }]))
scenes.push(scene([{ id: "tray", type: "sand-tray", x: 1.2, y: 0, props: { grain: "flour" } }, { id: "pile", type: "sand-pile", x: 1.25, y: 0.062, props: { mass: 0.3, grain: "gravel" } }]))
scenes.push(scene([{ id: "tray", type: "sand-tray", x: 1.2, y: 0, props: { length: 0.6 } }, { id: "fun", type: "sand-funnel", x: 1.2, y: 0.062, props: { height: 0.3, grain: "coarse sand" } }]))
scenes.push(scene([{ id: "damp", type: "sand-pile", x: 0.8, y: 0, props: { shape: "castle", wetness: "damp" } }, { id: "dry", type: "sand-pile", x: 1.4, y: 0, props: { shape: "castle" } }]))
scenes.push(scene([{ id: "hg1", type: "hourglass", x: 0.9, y: 0 }, { id: "hg2", type: "hourglass", x: 1.3, y: 0, props: { neck_mm: 4 } }], { settings: { time_lapse: 6 } }))
scenes.push(scene([{ id: "st", type: "stream-table", x: 1.2, y: 0.3, props: { plants: "lower half", tilt_deg: 10 } }], { settings: { time_lapse: 20 } }))
scenes.push(scene([{ id: "st", type: "stream-table", x: 1.2, y: 0.3, props: { grain: "gravel", tilt_deg: 0 } }]))
// (2026-10-20) containers that hold grains (round, tapered, square, moving), the kitchen grains, a pitcher of grains (the flow module's)
scenes.push(scene([{ id: "glass", type: "glass-jar", x: 1.2, y: 0, props: { width: 0.065, depth: 0.065, wall: 0.16 } }, { id: "fun", type: "sand-funnel", x: 1.2, y: 0, props: { sand_kg: 0.4, height: 0.3, outlet_mm: 15 } }]))
scenes.push(scene([{ id: "cup", type: "plastic-cup", x: 1.0, y: 0 }, { id: "pile", type: "sand-pile", x: 1.0, y: 0, props: { grain: "rice", sand_kg: 0.2 } }, { id: "bowl", type: "bowl", x: 1.6, y: 0 }, { id: "p2", type: "sand-pile", x: 1.6, y: 0.0035, props: { grain: "salt", sand_kg: 0.1 } }]))
scenes.push(scene([{ id: "box", type: "box", x: 1.4, y: 0, props: { hung: false } }, { id: "fun", type: "sand-funnel", x: 1.4, y: 0, props: { grain: "salt", sand_kg: 0.3, height: 0.3 } }, { id: "mug", type: "coffee-mug", x: 0.8, y: 0.0475 }, { id: "f2", type: "sand-funnel", x: 0.8, y: 0, props: { grain: "sugar", sand_kg: 0.08, height: 0.3, outlet_mm: 14 } }]))
scenes.push(scene([{ id: "jar", type: "glass-jar", x: 1.2, y: 0 }, { id: "cup", type: "pitcher", x: 1.185, y: 0.15, props: { vessel: "cup", contents: "grains", grain: "sugar", tilt: 135, tip_s: 1, pour_at: 0.3 } }, { id: "b", type: "beaker", x: 1.7, y: 0, props: { fill_ml: 0 } }, { id: "f3", type: "sand-funnel", x: 1.7, y: 0, props: { grain: "rice", sand_kg: 0.1, height: 0.3, outlet_mm: 25 } }]))

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

function firstDiff(a, b, path = "") {
	if (isDeepStrictEqual(a, b)) return ""
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return `${path}: ${JSON.stringify(a)?.slice(0, 120)} vs ${JSON.stringify(b)?.slice(0, 120)}`
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
		const d = firstDiff(a[k], b[k], `${path}.${k}`)
		if (d) return d
	}
	return path
}

// ---- engine: the server's (node) and the browser bundle, byte for byte; the summaries Python == JS
if (process.argv.includes("--engine")) {
	await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
	const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
	const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
	const plugins = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
	if (!plugins.processKind("sand-region")) plugins.registerProcess((await import(pathToFileURL(join(PG, "tooling/src/sim/modules/granular.ts")).href)).default)
	const round = (v, d) => Number(v.toFixed(d))
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
		const t = scenes[k].items[1]?.type
		if (picks.filter((p) => p.t === t).length >= Number(arg("--per", 2))) continue
		picks.push({ k, t })
	}
	for (const { k } of picks) {
		const doc = jsOut[k].doc
		let server
		try {
			server = serverRun(doc)
		} catch (e) {
			ok(false, `engine runs ${scenes[k].items.slice(1).map((i) => i.type).join(" + ")}`, e.message)
			continue
		}
		if (B?.handle) {
			const msg = B.handle({ id: k, doc, rate: 120 })
			ok(msg.error === undefined && JSON.stringify(msg.track) === server, `bundle == server engine: ${scenes[k].items.slice(1).map((i) => i.type).join(" + ")} #${k}`, msg.error ?? `${server.length} bytes`)
		}
		const track = JSON.parse(server)
		ok(!/null|NaN/.test(JSON.stringify(track.state ?? {})), `finite readings #${k}`)
		runs.push({ k, track })
	}
	// summaries with sampled goals of every kind
	const kinds = sim.plugins.modules().find((m) => m.name === "mod_granular")?.goals ?? []
	const sc = []
	const tr = []
	for (const { k, track } of runs) {
		const s = { ...cleaned[k], goals: kinds.map((g) => g.sample?.(cleaned[k], pick)).filter(Boolean) }
		sc.push(s)
		tr.push(track)
	}
	const P = py({ scenes: sc, tracks: tr }).results
	for (let i = 0; i < sc.length; i++) {
		const js = sim.finish(sc[i], jsOut[runs[i].k].doc, jsOut[runs[i].k].resolved, tr[i]).summary
		ok(isDeepStrictEqual(P[i].summary, js), `summary Python == JS #${runs[i].k} (${sc[i].goals.length} goals)`, firstDiff(P[i].summary, js))
	}
	console.log(`engine: ${runs.length} runs${B?.handle ? " (bundle compared)" : " (no bundle export: server engine only)"}`)
}

console.log(`granular parity: ${cases} checks, ${docs} documents, ${failed} mismatches`)
process.exit(failed ? 1 : 0)
