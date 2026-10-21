// The fracture module end to end (machines/mod_fracture.py, web/sim/modules/fracture.js, tooling/src/sim/modules/fracture.ts):
//   catalog   its types' entries: items.py == web/sim (props, readouts, module), and nothing else in the catalog changed by it
//   documents random scenes of its items (every type, random props across their ranges, in the air and on the table, with loads, padding,
//             settings): items.py == web/sim (document, resolved props, warnings), and clean() on garbage props
//   engine    the server's engine (node, the bundle's math) == the browser bundle, byte for byte, on random scenes; nothing non-finite, no failure
//   summary   items.py summarize == web/sim finish (goal kinds, readings, happenings) on those runs
//   physics   the thresholds the module claims, in the real engine (an egg cracks from 5 cm, survives 4 cm; a pillow saves it from 60 cm;
//             a glass shatters from 50 cm, not 40; a plate from 40 cm, not 20; 5 strands of spaghetti hold 150 g and snap under 250 g;
//             taped blocks come apart where glued ones hold; a parachute slows the egg-drop box; an egg survives a 50 cm drop onto an
//             exercise ball and 1 m onto a trampoline; a raw egg sinks in fresh water and floats in 12 % salt water, and one dropped into a
//             tank of water survives; a parachute does nothing in a pumped vacuum jar; a glass dropped on a glass breaks both; a baseball
//             shatters a window pane at 9 m/s and bounces off at 2 m/s; a block that only slides does not knock a tower down)
//   cross     scenes with other modules' things (softbody balls and clay, a trampoline, a water tank of fresh and salt water, a vacuum jar):
//             the same parity checks as the random scenes
//   node tools/fracture/test.mjs [--n 60]
import { execFileSync } from "../child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const N = Number(process.argv[process.argv.indexOf("--n") + 1]) || 60
let failed = 0
const ok = (cond, what, detail = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
	if (!cond) failed++
}
const imp = (p) => import(pathToFileURL(join(PG, p)).href)
const sim = await imp("web/sim/index.js")
const B = await imp("web/sim/engine-worker.js")
await imp("tools/engine-math-node.mjs")
const { admitDocument } = await imp("tooling/src/sim/document.ts")
const { simulate } = await imp("tooling/src/sim/physics.ts")
const plugins = await imp("tooling/src/sim/plugins.ts")
await imp("tooling/src/sim/modules/index.ts")
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_fracture.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30 }).toString())
const round = (v, d) => Number(v.toFixed(d))
/** The server's answer to a document (research/poc/worker.ts), slimmed as the server slims it. */
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

const TYPES = ["raw-egg", "drinking-glass", "ceramic-plate", "cushion", "egg-drop-box", "snap-bridge", "block-tower", "window-pane"]
const cat = sim.catalog()
const spec = Object.fromEntries(cat.types.filter((t) => TYPES.includes(t.key)).map((t) => [t.key, t]))
ok(TYPES.every((k) => spec[k]?.module === "fracture"), "the catalog has the module's 8 types")

// ---- catalog entries
{
	const P = py({ types: TYPES })
	ok(Object.keys(P.errors).length === 0 && sim.MODULE_ERRORS?.mod_fracture === undefined, "the module loads on both sides", JSON.stringify(P.errors))
	const js = TYPES.map((k) => {
		const { preview, ...t } = spec[k]
		return t
	})
	ok(isDeepStrictEqual(P.types, js), "catalog entries: items.py == web/sim")
}

// ---- random scenes
const R = (() => {
	let a = 20261019
	return () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648
})()
const pick = (list) => list[Math.floor(R() * list.length)]
const randomProps = (key) => {
	const out = {}
	for (const p of spec[key].props) {
		if (R() < 0.55 || p.common) continue
		if (p.kind === "choice") out[p.key] = pick(p.choices)
		else if (p.kind === "int") out[p.key] = Math.round(p.min + R() * Math.min(p.max - p.min, 12))
		else if (p.kind === "bool") out[p.key] = R() < 0.5
		else if (p.kind === "number" && Number.isFinite(p.min) && Number.isFinite(p.max)) {
			const hi = Math.min(p.max, p.slider_max ?? p.max)
			const v = p.min + R() * (hi - p.min)
			out[p.key] = Number(v.toFixed(4))
		}
	}
	return out
}
function randomScene(k) {
	const items = [{ id: "table", type: "table", x: 2, y: 0, props: { width: 4.6 } }]
	const n = 1 + Math.floor(R() * 5)
	let x = 0.2
	for (let j = 0; j < n; j++) {
		const type = pick(TYPES)
		const props = randomProps(type)
		const id = `${type.split("-")[0]}${j}`
		const w = type === "snap-bridge" ? (props.span ?? 0.2) + 0.12 : type === "cushion" ? props.width ?? 0.3 : 0.3
		const cx = x + w / 2
		x += w + 0.08
		if (x > 4.0) break
		if (type === "cushion" || type === "snap-bridge" || type === "block-tower" || (type === "window-pane" && props.mount !== "loose")) {
			items.push({ id, type, x: Number(cx.toFixed(3)), y: 0, props })
			if (type === "snap-bridge") {
				const H = props.support_height ?? 0.1
				const grams = pick(["20 g", "50 g", "100 g", "200 g", "500 g"])
				items.push({ id: `${id}m`, type: "gram-mass", x: Number((cx + (R() - 0.5) * 0.06).toFixed(3)), y: Number((H + 0.0045 + R() * 0.1).toFixed(4)), props: { grams }, held: R() < 0.5 })
			}
			if (type === "window-pane") items.push({ id: `${id}b`, type: pick(["baseball", "tennis-ball", "playground-ball"]), x: Number((cx - 0.15).toFixed(3)), y: 0.3, props: { start_speed: pick([2, 6, 12]), start_dir: 0 } })
			if (type === "cushion" && R() < 0.8) {
				const t = props.thickness ?? 0.05
				const what = pick(["raw-egg", "drinking-glass", "ceramic-plate"])
				items.push({ id: `${id}e`, type: what, x: Number(cx.toFixed(3)), y: Number((t + 0.03 + R() * 1.2).toFixed(3)), held: true, angle: pick([0, 0, 30, 90]) })
			}
		} else items.push({ id, type, x: Number(cx.toFixed(3)), y: Number((0.03 + R() * 1.4).toFixed(3)), props, held: R() < 0.8, angle: pick([0, 0, 0, 15, 90]) })
	}
	const scene = { version: 2, id: `f${k}`, name: `fracture ${k}`, seconds: 0.8 + Math.round(R() * 10) / 10, release: Math.round(R() * 3) / 10, stage: { x0: -0.2, x1: 4.4, y0: -0.1, y1: 2 }, items, goals: [] }
	if (R() < 0.2) scene.settings = pick([{ gravity: "moon" }, { air: false }, { gravity: "mars", air: false }])
	for (const g of sim.plugins.modules().find((m) => m.name === "mod_fracture").goals) {
		const s = g.sample?.(scene, pick)
		if (s) scene.goals.push(s)
	}
	return scene
}
const scenes = Array.from({ length: N }, (_, k) => randomScene(k))
// (other modules' things with this module's: soft balls and clay, a trampoline, water tanks, a vacuum jar, glass on glass, a tower)
const HB0 = (0.044 / 2) * (2 / Math.sqrt(2 + Math.SQRT2))
const cross = (id, items, extra = {}) => scenes.push({ version: 2, id, seconds: 1.6, release: 0.1, stage: { x0: -0.5, x1: 4, y0: -0.1, y1: 2.2 }, items: [{ id: "table", type: "table", x: 1.5, y: 0, props: { width: 5 } }, ...items], goals: [], ...extra })
cross("soft-balls", [
	{ id: "pb", type: "playground-ball", x: 0.3, y: 0.108 }, { id: "e1", type: "raw-egg", x: 0.3, y: 0.216 + 0.3 + HB0, held: true },
	{ id: "xb", type: "exercise-ball", x: 1.0, y: 0.325 }, { id: "e2", type: "raw-egg", x: 1.0, y: 0.65 + 0.5 + HB0, held: true },
	{ id: "fb", type: "foam-ball", x: 1.8, y: 0.035 + 2 * HB0 + 0.4, held: true }, { id: "e3", type: "raw-egg", x: 1.8, y: HB0, fixed: true },
	{ id: "cl", type: "soft-clay", x: 2.4, y: 0.05, props: { diameter: 0.1, softness: "soft" } }, { id: "e4", type: "drinking-glass", x: 2.4, y: 0.4, held: true }
], { goals: [{ kind: "survives", item: "e2" }, { kind: "breaks", item: "e4" }] })
cross("trampoline", [{ id: "tr", type: "trampoline", x: 0.8, y: 0 }, { id: "egg", type: "raw-egg", x: 0.8, y: 1.4, held: true }, { id: "box", type: "egg-drop-box", x: 2.2, y: 1.0, held: true, props: { padding: "none" } }, { id: "tr2", type: "trampoline", x: 2.2, y: 0 }], { goals: [{ kind: "survives", item: "egg" }] })
for (const [liq, salt] of [["water", 0], ["salt water", 12]])
	cross(`tank-${liq.replace(" ", "-")}`, [{ id: "tank", type: "water-tank", x: 0.6, y: 0, props: { liquid: liq, salt_pct: salt } }, { id: "egg", type: "raw-egg", x: 0.5, y: 0.6, held: true }, { id: "gl", type: "drinking-glass", x: 0.7, y: 0.5, held: true }, { id: "pl", type: "ceramic-plate", x: 1.6, y: 0.3, held: true }], { seconds: 2.5, goals: [{ kind: liq === "water" ? "sinks" : "floats", item: "egg" }, { kind: "survives", item: "egg" }] })
cross("vacuum-jar", [{ id: "jar", type: "vacuum-jar", x: 0.6, y: 0, props: { height: 0.8, width: 0.4, pump_at: 0, pump_s: 0.2, lowest_kpa: 0.1 } }, { id: "box", type: "egg-drop-box", x: 0.6, y: 0.65, held: true, props: { parachute: 0.3, size: 0.1 } }, { id: "box2", type: "egg-drop-box", x: 2.0, y: 0.65, held: true, props: { parachute: 0.3, size: 0.1 } }], { seconds: 2.5, release: 1.5 })
cross("glass-on-glass", [{ id: "g1", type: "drinking-glass", x: 0.5, y: 0 }, { id: "g2", type: "drinking-glass", x: 0.5, y: 0.7, held: true }, { id: "p1", type: "ceramic-plate", x: 1.5, y: 0 }, { id: "g3", type: "drinking-glass", x: 1.5, y: 0.5, held: true }], { goals: [{ kind: "breaks_first", item: "g1", other: "p1" }] })
cross("window", [{ id: "pane", type: "window-pane", x: 1.2, y: 0 }, { id: "ball", type: "baseball", x: 0.5, y: 0.35, props: { start_speed: 9, start_dir: 0 } }, { id: "pane2", type: "window-pane", x: 2.6, y: 0, props: { thickness: 0.006 } }, { id: "ball2", type: "baseball", x: 2.0, y: 0.35, props: { start_speed: 9, start_dir: 0 } }], { goals: [{ kind: "breaks", item: "pane" }, { kind: "survives", item: "pane2" }] })
cross("tower-knock", [{ id: "t", type: "block-tower", x: 0.9, y: 0 }, { id: "ball", type: "bowling-ball", x: 0.3, y: 0.11, props: { start_speed: 3, start_dir: 0 } }, { id: "t2", type: "block-tower", x: 2.4, y: 0, props: { glue: "white glue" } }, { id: "ball2", type: "bowling-ball", x: 1.8, y: 0.11, props: { start_speed: 3, start_dir: 0 } }], { seconds: 2.5, goals: [{ kind: "knocked_down", item: "t" }, { kind: "knocked_down", item: "t2", at_least_blocks: 2 }, { kind: "survives", item: "t2" }] })
// (and garbage: clean() keeps the props in range the same on both sides; extreme corners of every type)
for (const t of TYPES) {
	for (const corner of ["min", "max"]) {
		const props = {}
		for (const p of spec[t].props) if (p.kind === "number" || p.kind === "int") props[p.key] = p[corner]
		scenes.push({ version: 2, id: `${t}-${corner}`, seconds: 1, release: 0.1, stage: { x0: -1, x1: 2, y0: -0.2, y1: 1.5 }, items: [{ id: "table", type: "table", x: 0.5, y: 0 }, { id: "a", type: t, x: 0.4, y: t === "cushion" || t === "snap-bridge" || t === "block-tower" ? 0 : 0.4, props, held: true }], goals: [] })
	}
}
scenes.push({ version: 2, id: "garbage", seconds: 1, release: 0.1, stage: { x0: -1, x1: 2, y0: -0.2, y1: 1.5 }, items: [{ id: "table", type: "table", x: 0.5, y: 0 }, { id: "a", type: "raw-egg", x: 0.4, y: 0.4, props: { strength: 1e9, length: -3, width: 9 } }, { id: "b", type: "egg-drop-box", x: 1, y: 0.5, props: { padding: "jelly", parachute: 99 } }, { id: "c", type: "snap-bridge", x: 1.5, y: 0, props: { made_of: "steel", strands: 1e9 } }] })
const cleaned = scenes.map((s) => {
	try {
		return sim.clean(s)
	} catch (e) {
		console.log("  clean refused:", s.id, e.message)
		return null
	}
}).filter(Boolean)
const jsDocs = cleaned.map((s) => {
	try {
		return sim.layout(s)
	} catch (e) {
		return { error: e.message }
	}
})
const P = py({ cases: cleaned.map((scene) => ({ scene })) })
let dd = 0
cleaned.forEach((s, i) => {
	const a = P.out[i]
	const b = jsDocs[i]
	const same = a.error !== undefined ? b.error === `can't build this scene: ${a.error}` : isDeepStrictEqual(a.doc, b.doc) && isDeepStrictEqual(a.resolved, b.resolved) && isDeepStrictEqual(a.warnings, b.warnings)
	if (!same) {
		dd++
		if (dd <= 3) console.log("  doc differs:", s.id, a.error ?? "", b.error ?? "")
	}
})
ok(dd === 0, `documents, resolved props and warnings: items.py == web/sim on ${cleaned.length} scenes (random, corners, garbage)`, `${dd} differ`)

// ---- the engine: server (node) == browser bundle; summaries
let broke = 0
let differ = 0
let nonFinite = 0
const cases = []
const t0 = Date.now()
cleaned.forEach((s, i) => {
	const b = jsDocs[i]
	if (b.error) return
	let srv
	try {
		srv = serverRun(b.doc)
	} catch (e) {
		broke++
		console.log("  server run failed:", s.id, e.message)
		return
	}
	const msg = B.handle({ id: i, doc: b.doc, rate: 120 })
	if (msg.error !== undefined) {
		broke++
		console.log("  bundle failed:", s.id, msg.error)
		return
	}
	const bt = JSON.stringify(msg.track)
	if (bt !== srv) {
		differ++
		if (differ <= 3) console.log("  tracks differ:", s.id, bt.length, srv.length)
	}
	if (bt.includes("null") || bt.includes("NaN")) nonFinite++
	cases.push({ i, scene: s, track: msg.track })
})
ok(broke === 0 && nonFinite === 0, `${cases.length} runs: no failure, nothing non-finite`, `${broke} failed, ${nonFinite} non-finite, ${((Date.now() - t0) / 1000).toFixed(1)} s`)
ok(differ === 0, "tracks: the server's engine == the browser bundle, byte for byte", `${differ} differ`)
const P2 = py({ cases: cases.map((c) => ({ scene: c.scene, track: c.track })) })
let sd = 0
let goals = 0
let broken = 0
cases.forEach((c, k) => {
	const b = jsDocs[c.i]
	const meta = sim.finish(c.scene, b.doc, b.resolved, c.track)
	goals += meta.summary.goals.length
	broken += (c.track.events ?? []).filter((e) => e.kind === "breaks").length
	if (!isDeepStrictEqual(P2.out[k].summary, meta.summary)) {
		sd++
		if (sd <= 3) console.log("  summary differs:", c.scene.id, JSON.stringify(P2.out[k].summary?.goals), JSON.stringify(meta.summary.goals))
	}
})
ok(sd === 0, `summaries: items.py == web/sim on ${cases.length} runs (${goals} module goals, ${broken} breaks)`, `${sd} differ`)

// ---- the physics the module claims, in the engine
const HB = (0.044 / 2) * (2 / Math.sqrt(2 + Math.SQRT2))
const runScene = (items, extra = {}) => {
	const s = { version: 2, seconds: 1.6, release: 0.1, stage: { x0: -0.5, x1: 4, y0: -0.1, y1: 2 }, items: [{ id: "table", type: "table", x: 1.5, y: 0, props: { width: 5 } }, ...items], goals: [], ...extra }
	const p = sim.prepare(s)
	const m = B.handle({ id: 1, doc: p.doc, rate: 120 })
	if (m.error) throw new Error(m.error)
	return m.track
}
const end = (tr, id, k) => tr.state?.[id]?.[k]?.at(-1)
{
	const tr = runScene([0.04, 0.06, 0.15, 0.3].map((h, i) => ({ id: `e${i}`, type: "raw-egg", x: 0.2 + 0.3 * i, y: h + HB, held: true })))
	ok(end(tr, "e0", "broken") === 0 && end(tr, "e1", "broken") >= 1 && end(tr, "e3", "broken") === 2, "an egg: whole from 4 cm, cracked from 6 cm, smashed from 30 cm onto the table", [0, 1, 2, 3].map((i) => `${end(tr, `e${i}`, "broken")}/${end(tr, `e${i}`, "peak_force")?.toFixed(0)} N`).join(", "))
}
{
	const tr = runScene([
		{ id: "pad", type: "cushion", x: 0.5, y: 0, props: { material: "pillow stuffing", thickness: 0.15 } },
		{ id: "egg", type: "raw-egg", x: 0.5, y: 0.15 + 0.6 + HB, held: true },
		{ id: "foam", type: "cushion", x: 1.2, y: 0, props: { material: "foam", thickness: 0.05 } },
		{ id: "egg2", type: "raw-egg", x: 1.2, y: 0.05 + 0.3 + HB, held: true },
		{ id: "egg3", type: "raw-egg", x: 1.9, y: 0.3 + HB, held: true }
	])
	ok(end(tr, "egg", "broken") === 0 && end(tr, "egg2", "broken") === 0 && end(tr, "egg3", "broken") === 2, "padding: a pillow saves an egg from 60 cm, 5 cm of foam from 30 cm; the table does not", ["egg", "egg2", "egg3"].map((i) => `${end(tr, i, "peak_force")?.toFixed(0)} N`).join(", "))
	ok(Math.max(...tr.state.pad.squash) > 0.02, "the pillow squashes under the egg", `${(Math.max(...tr.state.pad.squash) * 100).toFixed(1)} cm`)
}
{
	const tr = runScene([0.4, 0.5].flatMap((h, i) => [{ id: `g${i}`, type: "drinking-glass", x: 0.3 + 0.6 * i, y: h, held: true }, { id: `p${i}`, type: "ceramic-plate", x: 1.8 + 0.6 * i, y: [0.2, 0.45][i], held: true }]))
	ok(end(tr, "g0", "broken") === 0 && end(tr, "g1", "broken") === 2, "a glass: whole from 40 cm, shards from 50 cm", `${end(tr, "g0", "peak_force")?.toFixed(0)} N, ${end(tr, "g1", "peak_force")?.toFixed(0)} N (breaks at 1840 N)`)
	ok(end(tr, "p0", "broken") === 0 && end(tr, "p1", "broken") === 2, "a plate: whole from 20 cm, sherds from 45 cm", `${end(tr, "p0", "peak_force")?.toFixed(0)} N, ${end(tr, "p1", "peak_force")?.toFixed(0)} N (breaks at 2470 N)`)
}
{
	const H = 0.1 + 0.003 + 0.0015
	const tr = runScene([
		{ id: "a", type: "snap-bridge", x: 0.3, y: 0 }, { id: "ma", type: "gram-mass", x: 0.3, y: H, props: { grams: "100 g" } }, { id: "ma2", type: "gram-mass", x: 0.3, y: H + 0.032, props: { grams: "50 g" } },
		{ id: "b", type: "snap-bridge", x: 0.9, y: 0 }, { id: "mb", type: "gram-mass", x: 0.9, y: H, props: { grams: "200 g" } }, { id: "mb2", type: "gram-mass", x: 0.9, y: H + 0.0403, props: { grams: "50 g" } },
		{ id: "c", type: "snap-bridge", x: 1.5, y: 0, props: { strands: 10 } }, { id: "mc", type: "gram-mass", x: 1.5, y: H, props: { grams: "200 g" } }, { id: "mc2", type: "gram-mass", x: 1.5, y: H + 0.0403, props: { grams: "50 g" } }
	])
	ok(end(tr, "a", "broken") === 0 && end(tr, "b", "broken") === 2 && end(tr, "c", "broken") === 0, "a spaghetti bridge (5 strands, 20 cm): holds 150 g, snaps under 250 g; 10 strands hold 250 g", ["a", "b", "c"].map((i) => `${end(tr, i, "share")?.toFixed(2)}`).join(", "))
}
{
	const items = []
	for (const [i, glue] of ["none", "tape", "white glue"].entries()) {
		items.push({ id: `t${i}`, type: "block-tower", x: 0.6 + i * 1.2, y: 0, props: { glue } })
		items.push({ id: `r${i}`, type: "plank", x: 0.0 + i * 1.2, y: 0.25, angle: -30, props: { length: 0.8 } })
		items.push({ id: `b${i}`, type: "bowling-ball", x: 0.2 + i * 1.2, y: 0.42, held: true })
	}
	const tr = runScene(items, { seconds: 2.5 })
	const blocks = (i) => [1, 2, 3, 4, 5, 6].map((k) => tr.frames.at(-1).placements[`t${i}/block${k}`])
	const spread = (i) => Math.max(...blocks(i).map((p) => p.x)) - Math.min(...blocks(i).map((p) => p.x))
	ok(end(tr, "t1", "broken") === 1 && end(tr, "t2", "broken") === 0, "a bowling ball knocks taped blocks apart; glued ones stay one piece", `taped share ${end(tr, "t1", "share")?.toFixed(2)}, glued ${end(tr, "t2", "share")?.toFixed(3)}; spread loose ${spread(0).toFixed(2)} m, glued ${spread(2).toFixed(2)} m`)
}
{
	const tr = runScene([
		{ id: "slow", type: "egg-drop-box", x: 0.3, y: 1.5, held: true, props: { padding: "foam", padding_thickness: 0.04, parachute: 0.7 } },
		{ id: "fast", type: "egg-drop-box", x: 1.5, y: 1.5, held: true, props: { padding: "foam", padding_thickness: 0.04 } }
	], { seconds: 3 })
	ok(end(tr, "slow", "impact_speed") < 3.6 && end(tr, "fast", "impact_speed") > 4.5 && end(tr, "slow", "broken") === 0 && end(tr, "fast", "broken") >= 1, "egg drop from 1.5 m: a 70 cm parachute and 4 cm of foam save the egg; without the parachute it breaks", `${end(tr, "slow", "impact_speed")?.toFixed(2)} vs ${end(tr, "fast", "impact_speed")?.toFixed(2)} m/s; ${end(tr, "slow", "peak_force")?.toFixed(0)} vs ${end(tr, "fast", "peak_force")?.toFixed(0)} N`)
}
// the same on the Moon: a slower fall (gravity 1.62) leaves an egg whole from 30 cm
{
	const tr = runScene([{ id: "e", type: "raw-egg", x: 0.3, y: 0.3 + HB, held: true }], { settings: { gravity: "moon" } })
	ok(end(tr, "e", "broken") === 0, "on the Moon an egg dropped 30 cm only lands at about 1 m/s and survives", `${end(tr, "e", "impact_speed")?.toFixed(2)} m/s, ${end(tr, "e", "peak_force")?.toFixed(0)} N`)
}

console.log(failed ? `${failed} FAILED` : "ALL PASS")
process.exit(failed ? 1 : 0)
