// The softbody module's parity and engine checks (machines/mod_softbody.py == web/sim/modules/softbody.js; the server's engine == the browser bundle):
//   catalog   every softbody type's catalog entry and the vehicles' (they carry its band_turns / band_size), Python == JS (props, readouts, module)
//   build     documents, resolved props and warnings, Python == JS, for every type at its defaults, at its props' limits and at --n random props
//             each (angles, facing, fixed), and scenes that combine them (a load on a ruler's end, a bridge over two blocks, a car on a launcher's
//             board, clay on a spring, two soft balls touching, rubber-band cars)
//   engine    (--engine) the server's engine (node, the bundle's math) == the browser bundle web/sim/engine-worker.js, byte for byte, on --per
//             scenes of each type and on EVERY type at its props' limits (all at their most, all at their least) and the hardest combinations
//             (a launcher at its most with nothing, a ping-pong ball or a toy car in its pouch; balls dropped at their least and most pressure;
//             band cars at 30 turns of each band; clay under 5 kg); the readings finite and bounded (no stored energy above 1 kJ, nothing past
//             250 m/s); and the summaries (goal kinds, readings) Python == JS on those runs, every goal kind sampled
//   node tools/parity/softbody.mjs [--n 20] [--engine] [--per 2] [--seed 7]
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
if (!sim.catalog().types.some((t) => t.key === "soft-clay")) {
	// (when web/sim/modules/index.js does not list it yet: register the port by hand, as it will)
	const m = await import(pathToFileURL(join(PG, "web/sim/modules/softbody.js")).href)
	itemsJs.use_catalog_module("mod_softbody", m.register_all)
	const mod = sim.plugins.registerModule({ ...m.plugin, name: "mod_softbody" })
	for (const k of mod.goals) itemsJs.register_goal_kind(k.kind, (ctx, g) => k.summarize(ctx, g))
}
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_softbody.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30 }).toString())

const cat = sim.catalog()
const TYPES = cat.types.filter((t) => t.module === "softbody")
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, extra = {}) => ({ version: 2, id: "s", name: "Soft", seconds: 2.5, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, ...items], goals: [], ...extra })

/** A random value of a prop within its range, on its step. */
const randomProp = (p) => {
	if (p.kind === "bool") return rnd() < 0.5
	if (p.kind === "choice") return pick(p.choices)
	if (p.kind === "int") return p.min + Math.floor(rnd() * (p.max - p.min + 1))
	const steps = Math.round((p.max - p.min) / p.step)
	return Number((p.min + Math.floor(rnd() * (steps + 1)) * p.step).toFixed(6))
}
/** Where an item of this type sits on the table (its anchor's height). */
const restY = (t, props) => (t.anchor === "its middle" ? (props.diameter ?? t.props.find((p) => p.key === "diameter")?.default ?? 0.06) / 2 + 0.001 : t.key === "flex-plank" ? 0.001 : 0)

// ---- catalog
const P0 = py({ scenes: [] })
const jsTypes = cat.types.filter((t) => t.module === "softbody" || ["toy-car", "cart", "truck"].includes(t.key)).map(({ preview, ...t }) => t)
ok(isDeepStrictEqual(P0.types, jsTypes), "catalog entries equal (props, readouts, module; the vehicles' common props)", `${P0.types.length} vs ${jsTypes.length}: ${firstDiff(P0.types, jsTypes)}`)
ok(P0.categories.includes("Soft & bendy") && cat.categories.includes("Soft & bendy"), "the Soft & bendy category")

// ---- build: defaults, limits, random props, combinations
const scenes = []
/** Scenes the engine part always runs (a type at its props' limits, the hardest combinations). */
const always = new Set()
for (const t of TYPES) {
	scenes.push(scene([{ id: "it", type: t.key, x: 1.2, y: restY(t, {}) }]))
	// (fixed: its moving parts stay free, its base was static anyway)
	scenes.push(scene([{ id: "it", type: t.key, x: 1.2, y: restY(t, {}), fixed: true }]))
	for (const end of ["min", "max"]) {
		const props = {}
		for (const p of t.props) if (!p.common && (p.kind === "number" || p.kind === "int")) props[p.key] = p[end]
		always.add(scenes.length)
		scenes.push(scene([{ id: "it", type: t.key, x: 1.2, y: restY(t, props), props }]))
	}
	for (let k = 0; k < N; k++) {
		const props = {}
		for (const p of t.props) if (!p.common && p.key !== "material" && !p.auto && rnd() < 0.6) props[p.key] = randomProp(p)
		if (t.props.some((p) => p.key === "material") && rnd() < 0.5) props.material = pick(t.props.find((p) => p.key === "material").choices)
		if (rnd() < 0.3) props.color = pick(["red", "blue", "green"])
		scenes.push(scene([{ id: "it", type: t.key, x: 0.4 + 2 * rnd(), y: restY(t, props) + (rnd() < 0.3 ? rnd() * 0.5 : 0), angle: rnd() < 0.2 ? pick([10, -15, 30, 180]) : 0, props, fixed: rnd() < 0.1 }]))
	}
}
for (const car of ["toy-car", "cart", "truck"]) {
	scenes.push(scene([{ id: "car", type: car, x: 0.5, y: 0, props: { band_turns: 8 } }]))
	scenes.push(scene([{ id: "car", type: car, x: 0.5, y: 0, props: { band_turns: Number((rnd() * 30).toFixed(1)), band_size: pick(["thin", "medium", "thick"]) } }]))
}
scenes.push(scene([{ id: "r", type: "flex-ruler", x: 0.6, y: 0, props: { material: "acrylic" } }, { id: "w", type: "gram-mass", x: 0.785, y: 0.0532, props: { grams: "100 g" } }]))
scenes.push(scene([{ id: "b1", type: "wooden-block", x: 0.9, y: 0.05, fixed: true }, { id: "b2", type: "wooden-block", x: 1.5, y: 0.05, fixed: true }, { id: "pl", type: "flex-plank", x: 1.2, y: 0.1005, props: { length: 0.7 } }, { id: "w", type: "gram-mass", x: 1.2, y: 0.107, props: { grams: "500 g" } }]))
scenes.push(scene([{ id: "L", type: "band-launcher", x: 0.6, y: 0, props: { draw: 0.12 } }, { id: "car", type: "toy-car", x: 0.583, y: 0.012 }]))
scenes.push(scene([{ id: "L", type: "band-launcher", x: 0.6, y: 0.4, props: { draw: 0.15 }, fixed: true }, { id: "car", type: "toy-car", x: 0.553, y: 0.412 }]))
scenes.push(scene([{ id: "s", type: "coil-spring", x: 1.0, y: 0 }, { id: "c", type: "soft-clay", x: 1.0, y: 0.2 }]))
scenes.push(scene([{ id: "a", type: "playground-ball", x: 1.0, y: 0.109 }, { id: "b", type: "soft-clay", x: 1.0, y: 0.6 }, { id: "c", type: "foam-ball", x: 1.3, y: 0.036 }]))
scenes.push(scene([{ id: "sb", type: "springboard", x: 0.3, y: 0, props: { facing: "left" } }, { id: "e", type: "exercise-ball", x: 1.8, y: 0.326 }]))
// the hardest: a launcher at its most (draw 0.2, 4 thick bands at the narrowest spread) with nothing, a ping-pong ball or a toy car in its pouch
const MOST = { draw: 0.2, bands: 4, band: "thick", spread: 0.09 }
for (const load of [[], [{ id: "p", type: "ping-pong-ball", x: 0.6 - 0.2 + 0.023, y: 0.0323 }], [{ id: "c", type: "toy-car", x: 0.6 - 0.2 + 0.103, y: 0.012 }]]) {
	always.add(scenes.length)
	scenes.push(scene([{ id: "L", type: "band-launcher", x: 0.6, y: 0, props: { ...MOST, height: load[0]?.type === "ping-pong-ball" ? 0.02 : 0.03 } }, ...load]))
}
for (const [type, kPa, R] of [["playground-ball", 0.5, 0.108], ["playground-ball", 35, 0.108], ["exercise-ball", 0.5, 0.325], ["exercise-ball", 10, 0.325]]) {
	always.add(scenes.length)
	scenes.push(scene([{ id: "b", type, x: 1.2, y: 1.0 + R, held: true, props: { pressure: kPa } }]))
}
for (const size of ["thin", "medium", "thick"]) {
	always.add(scenes.length)
	scenes.push(scene([{ id: "car", type: "toy-car", x: 0.0, y: 0, props: { band_turns: 30, band_size: size } }]))
}
always.add(scenes.length)
scenes.push(scene([{ id: "c", type: "soft-clay", x: 1.0, y: 0.03 }, { id: "w", type: "steel-weight-5kg", x: 1.0, y: 0.2 }]))
always.add(scenes.length)
scenes.push(scene([{ id: "s", type: "coil-spring", x: 1.0, y: 0, props: { stiffness: 10 } }, { id: "w", type: "gram-mass", x: 1.0, y: 0.2, props: { grams: "1 kg" } }]))

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
	if (!plugins.processKind("softbody")) plugins.registerProcess((await import(pathToFileURL(join(PG, "tooling/src/sim/modules/softbody.ts")).href)).default)
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
		const t = scenes[k].items.slice(1).map((i) => i.type).join("+")
		if (!always.has(k) && picks.filter((p) => p.t === t && !always.has(p.k)).length >= Number(arg("--per", 2))) continue
		picks.push({ k, t })
	}
	const warned = []
	const warn0 = console.warn
	console.warn = (...a) => warned.push(a.map(String).join(" "))
	for (const { k } of picks) {
		const doc = jsOut[k].doc
		let server
		warned.length = 0
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
		ok(!/null|NaN/.test(JSON.stringify(track.state ?? {})) && !/null|NaN/.test(JSON.stringify(track.frames)), `finite readings and placements #${k}`)
		// bounded: no stored energy past 1 kJ (four thick bands at their most hold 31 J), nothing past the engine's 250 m/s
		const most = Math.max(0, ...Object.values(track.state ?? {}).flatMap((o) => Object.entries(o).filter(([key]) => /energy_j$/.test(key)).flatMap(([, v]) => v)))
		ok(most < 1000 && !warned.some((w) => /faster than/.test(w)), `bounded #${k} (${scenes[k].items.slice(1).map((i) => i.type).join(" + ")})`, `most energy ${most.toFixed(1)} J; ${warned.filter((w) => /faster than/.test(w)).length} over-speed warnings`)
		runs.push({ k, track })
	}
	// summaries with sampled goals of every kind
	const kinds = sim.plugins.modules().find((m) => m.name === "mod_softbody")?.goals ?? []
	const sc = []
	const tr = []
	for (const { k, track } of runs) {
		const s = { ...cleaned[k], goals: kinds.map((g) => g.sample?.(cleaned[k], pick)).filter(Boolean) }
		sc.push(s)
		tr.push(track)
	}
	const P = py({ scenes: sc, tracks: tr }).results
	let goals = 0
	for (let i = 0; i < sc.length; i++) {
		const js = sim.finish(sc[i], jsOut[runs[i].k].doc, jsOut[runs[i].k].resolved, tr[i]).summary
		goals += sc[i].goals.length
		ok(isDeepStrictEqual(P[i].summary, js), `summary Python == JS #${runs[i].k} (${sc[i].goals.length} goals)`, firstDiff(P[i].summary, js))
	}
	console.warn = warn0
	console.log(`engine: ${runs.length} runs (${picks.filter((p) => always.has(p.k)).length} at the limits)${B?.handle ? " (bundle compared)" : " (no bundle export: server engine only)"}, ${goals} sampled goals`)
}

console.log(`softbody parity: ${cases} checks, ${docs} documents, ${failed} mismatches`)
process.exit(failed ? 1 : 0)
