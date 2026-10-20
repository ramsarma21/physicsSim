// The fluids module's parity and engine checks (machines/mod_fluids.py == web/sim/modules/fluids.js; the server's engine == the browser bundle):
//   catalog   every fluids type's catalog entry (props, links, readouts, module) and the "Liquids" category, Python == JS
//   build     documents, resolved props and warnings, Python == JS: every type at its defaults, at its props' limits and at --n random props
//             each: containers (tank in its three styles, cylinder, beaker, jug, density column) with random liquids, salt, fills and things in
//             them (the module's floaters and sinkers and the catalog's: egg, cans, bottles, ice, wood, fruit, balls, clay; dropped from above the
//             rim or started at their floating height by the placement rule), boats with fans or a breeze behind them in troughs, pennies on
//             boats; and scenes without a liquid container (no liquid, displace or fan-stand record may appear)
//   demos     the lesson demos (tools/parity/fixtures/fluids-demos.json: F1 floating depth, F4 sink or float, F5 displacement, F6 clay, F7 egg,
//             F8 penny boat, F9 fan distance, F10 sail size, F12 density column): Python == JS documents, and with --engine every goal met in both
//   engine    (--engine) the server's engine (node, the bundle's math) == the browser bundle web/sim/engine-worker.js, byte for byte, on --per
//             scenes of each type and every demo; the readings and placements finite; and the summaries (every goal kind sampled, readings)
//             Python == JS
//   node --no-warnings tools/parity/fluids.mjs [--n 12] [--engine] [--per 2] [--seed 23]
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i >= 0 ? process.argv[i + 1] : d
}
const N = Number(arg("--n", 12))
let seed = Number(arg("--seed", 23)) >>> 0
const rnd = () => {
	seed = (seed + 0x6d2b79f5) >>> 0
	let t = seed
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = (a) => a[Math.floor(rnd() * a.length)]
const r4 = (v) => Number(v.toFixed(4)) + 0
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
const py = (req) => JSON.parse(execFileSync("python3", [join(HERE, "py_fluids.py")], { input: JSON.stringify(req), maxBuffer: 1 << 30 }).toString())

const cat = sim.catalog()
const KEYS = new Set(cat.types.map((t) => t.key))
const TYPES = cat.types.filter((t) => t.module === "fluids")
const typeOf = (key) => cat.types.find((t) => t.key === key)
const STAGE = { x0: -0.56, x1: 3.19, y0: -0.16, y1: 2.34 }
const scene = (items, extra = {}) => ({ version: 2, id: "f", name: "Fluids", seconds: 2.0, release: 0.2, stage: STAGE, items: [{ id: "table", type: "table", x: 1.3, y: 0 }, ...items], goals: [], ...extra })
const randomProp = (p) => {
	if (p.kind === "bool") return rnd() < 0.5
	if (p.kind === "choice") return pick(p.choices)
	if (p.kind === "int") return p.min + Math.floor(rnd() * (p.max - p.min + 1))
	const steps = Math.round((p.max - p.min) / p.step)
	return Number((p.min + Math.floor(rnd() * (steps + 1)) * p.step).toFixed(6))
}
const randomProps = (t, share = 0.6) => {
	const props = {}
	for (const p of t.props) if (!p.common && p.key !== "material" && rnd() < share) props[p.key] = randomProp(p)
	return props
}
const CONTAINERS = ["water-tank", "graduated-cylinder", "beaker", "measuring-jug", "density-column"]
const BOATS = ["sailboat", "clay-boat", "foil-boat"]
const SMALL = ["penny", "grape", "cork", "plastic-bead", "pebble"]
// the catalog's own things a lesson drops in water (the module corrects the open or filled ones' volumes: egg, cans, bottles, mug, cone, brick)
const CATALOG_THINGS = ["egg", "soda-can", "water-bottle", "lego-brick", "coffee-mug", "bowl", "paper-clip", "ice-cube", "wooden-block", "apple", "rubber-duck", "golf-ball", "steel-ball", "glass-marble", "clay-ball", "tennis-ball", "ping-pong-ball", "orange", "candle", "plastic-ball", "foam-block", "coin-flat"].filter((k) => KEYS.has(k))
const THINGS = [...SMALL, ...BOATS, ...CATALOG_THINGS]
const NARROW = { "graduated-cylinder": SMALL.concat(["glass-marble", "steel-ball"].filter((k) => KEYS.has(k))), "density-column": ["grape", "cork", "plastic-bead", "penny", "glass-marble"].filter((k) => KEYS.has(k)) }

/** A container on the table at x with its props, and a thing put into it: dropped from above its rim or started at its floating height. */
function into(container, type, id, props = {}) {
	const inner = sim.plugins.containerInterior(container.type, container.props ?? {})
	if (!inner) return { id, type, x: container.x, y: 0.4, props }
	const u = 0.2 + 0.6 * rnd()
	const x = r4(container.x + inner.x0 + (inner.x1 - inner.x0) * u)
	const thing = { id, type, x, y: 0, props }
	if (rnd() < 0.45) {
		let y = null
		try {
			y = sim.plugins.floatHeight(thing, container)
		} catch {}
		if (Number.isFinite(y)) return { ...thing, y: r4(y) }
	}
	return { ...thing, y: r4(container.y + inner.rim + 0.01 + 0.08 * rnd()) }
}
const randomContainer = (id, x, type = pick(CONTAINERS)) => {
	const props = rnd() < 0.7 ? randomProps(typeOf(type), 0.5) : {}
	if (type === "water-tank" && props.fill !== undefined && props.height !== undefined && props.fill > props.height) props.fill = props.height
	return { id, type, x, y: 0, props }
}
const thingFor = (container) => pick(NARROW[container.type] ?? THINGS)
/** Two boat lanes: troughs one above the other, a boat in each and a fan (or a breeze) behind it at the sail's height. */
function lanes(boatProps = [{}, {}], fanProps = [{}, {}], gaps = [0.15, 0.9], wind = null) {
	const items = []
	for (let k = 0; k < 2; k++) {
		const lane = { id: `lane${k}`, type: "water-tank", x: 1.55, y: k === 0 ? 0 : 0.35, props: { style: "trough" } }
		const boat = into(lane, "sailboat", `boat${k}`, boatProps[k])
		items.push(lane, { ...boat, x: r4(0.15 + gaps[k] + 0.12) })
		if (!wind) items.push({ id: `fan${k}`, type: "fan", x: 0.15, y: r4(lane.y + 0.18), props: { diameter: 0.12, ...fanProps[k] } })
	}
	if (wind) items.push({ id: "wind", type: "breeze", x: 0.0, y: 1.6, props: wind })
	return items
}

// ---- catalog
const P0 = py({ scenes: [] })
ok(Object.keys(P0.errors).length === 0, "every Python module loads", JSON.stringify(P0.errors))
const jsTypes = TYPES.map(({ preview, ...t }) => t)
ok(TYPES.length === 17, "the fluids module's seventeen types", TYPES.map((t) => t.key).join(", "))
ok(isDeepStrictEqual(P0.types, jsTypes), "catalog entries equal (props, links, readouts, module)", `${P0.types.length} vs ${jsTypes.length}: ${firstDiff(P0.types, jsTypes)}`)
ok(P0.categories.includes("Liquids") && cat.categories.includes("Liquids"), "the Liquids category")

// ---- build
const scenes = []
const typeAt = []
const push = (s, t) => {
	scenes.push(s)
	typeAt.push(t)
}
const withProps = (t, props) => {
	if (CONTAINERS.includes(t.key)) {
		const c = { id: "c", type: t.key, x: 1.2, y: 0, props }
		const items = [c]
		for (let k = 0; k < Math.floor(rnd() * 4); k++) items.push(into(c, thingFor(c), `t${k}`, rnd() < 0.3 ? randomProps(typeOf(thingFor(c)), 0.4) : {}))
		return scene(items)
	}
	if (t.key === "breeze") return scene(lanes([{}, { sail: pick(["tiny", "small", "big"]) }], [{}, {}], [0.2, 0.6], props))
	if (t.key === "sailboat") return scene(lanes([props, randomProps(t, 0.3)], [{ speed: pick([3, 5, 8]) }, {}], [0.15, pick([0.3, 0.9, 1.4])]))
	const c = randomContainer("c", 1.2, t.key === "clay-boat" || t.key === "foil-boat" ? "water-tank" : pick(CONTAINERS))
	const items = [c, into(c, t.key, "it", props)]
	if (t.key === "foil-boat" && rnd() < 0.6) {
		const boat = items[1]
		items.push({ id: "pennies", type: "penny", x: boat.x, y: r4(boat.y + 0.03), props: { count: 1 + Math.floor(rnd() * 40) } })
	}
	return scene(items)
}
for (const t of TYPES) {
	push(withProps(t, {}), t.key)
	for (const end of ["min", "max"]) {
		const props = {}
		for (const p of t.props) if (!p.common && (p.kind === "number" || p.kind === "int")) props[p.key] = p[end]
		push(withProps(t, props), t.key)
	}
	for (let k = 0; k < N; k++) push(withProps(t, randomProps(t)), t.key)
}
// the catalog's things in random liquids (sealed, open, filled; the module's corrected volumes)
for (const key of CATALOG_THINGS) {
	const c = { id: "c", type: "water-tank", x: 1.2, y: 0, props: { style: pick(["aquarium", "tub"]), liquid: pick(["water", "salt water", "sea water", "corn syrup", "vegetable oil"]), salt_pct: pick([0, 6, 12, 26]) } }
	const props = key === "soda-can" || key === "water-bottle" ? { full: rnd() < 0.7 } : {}
	push(scene([c, into(c, key, "it", props)]), key)
}
// combinations: a tank of many things, two cylinders, a boat with its pennies, and no liquid container at all (no records, no fan stand)
{
	const c = { id: "c", type: "water-tank", x: 1.2, y: 0, props: { style: "aquarium", length: 0.8 } }
	push(scene([c, ...["cork", "grape", "pebble", "clay-boat", "rubber-duck", "egg", "ice-cube"].filter((k) => KEYS.has(k)).map((k, i) => into(c, k, `m${i}`))]), "combo")
	const a = { id: "a", type: "graduated-cylinder", x: 0.8, y: 0, props: { size: "250 mL", fill_ml: 150 } }
	const b = { id: "b", type: "beaker", x: 1.6, y: 0, props: { size: "600 mL", fill_ml: 400, liquid: "salt water", salt_pct: 12 } }
	push(scene([a, b, into(a, "pebble", "p1"), into(b, "egg", "e1")]), "combo")
}
// surface tension: paper clips laid on random liquids (or dropped), soap drops, capillary tubes and paper strips dipped in them; open vessels
// (a mug, a bowl) floating, filled by a hose from a raised beaker
for (let k = 0; k < N; k++) {
	const c = { id: "c", type: "water-tank", x: 1.2, y: 0, props: { style: pick(["aquarium", "tub"]), liquid: pick(["water", "salt water", "sea water", "vegetable oil", "corn syrup", "dish soap", "rubbing alcohol", "honey"]), salt_pct: pick([0, 6, 12, 26]) } }
	const inner = sim.plugins.containerInterior(c.type, c.props)
	const top = inner ? inner.floor + (c.props.style === "tub" ? 0.12 : 0.2) : 0.2
	const items = [c, into(c, "paper-clip", "clip", rnd() < 0.3 ? { count: 1 + Math.floor(rnd() * 3) } : {})]
	if (rnd() < 0.6) items.push({ id: "soap", type: "soap-drop", x: r4(1.0 + 0.4 * rnd()), y: r4(top + 0.03 + 0.1 * rnd()), props: { at_s: pick([0.3, 0.8, 1.5]) } })
	if (rnd() < 0.6) items.push({ id: "tube", type: "capillary-tube", x: r4(1.0 + 0.4 * rnd()), y: r4(top - 0.04 * rnd()), props: randomProps(typeOf("capillary-tube"), 0.6) })
	if (rnd() < 0.6) items.push({ id: "strip", type: "paper-strip", x: r4(1.0 + 0.4 * rnd()), y: r4(top - 0.04 * rnd()), props: randomProps(typeOf("paper-strip"), 0.6) })
	if (rnd() < 0.5) items.push(into(c, pick(["foil-boat", "coffee-mug", "bowl"]), "vessel", rnd() < 0.5 ? randomProps(typeOf(pick(["foil-boat"])), 0.3) : {}))
	push(scene(items), "surface")
}
for (const v of ["coffee-mug", "bowl"]) {
	const tank = { id: "tank", type: "water-tank", x: 1.45, y: 0, props: { style: "aquarium" } }
	const it = into(tank, v, "vessel", v === "bowl" ? { material: pick(["melamine", "foam", "aluminium", "ceramic"]) } : { mass: pick([0.06, 0.12, 0.33]) })
	push(scene([tank, it, { id: "box", type: "box", x: 0.8, y: 0, props: { height: 0.3 } }, { id: "src", type: "beaker", x: 0.8, y: 0.306, props: { size: "1000 mL", fill_ml: 900 } }, { id: "hose", type: "hose", x: 1.45, y: 0.32, props: { from: "src", to: "vessel", diameter_mm: 10 } }]), "vessel")
}
const plain = scene([{ id: "cup", type: "cup", x: 1.0, y: 0 }, { id: "fan", type: "fan", x: 0.4, y: 0.2 }, { id: "ball", type: "tennis-ball", x: 1.0, y: 0.4 }, { id: "duck", type: "rubber-duck", x: 1.6, y: 0.1 }, { id: "mug", type: "coffee-mug", x: 2.0, y: 0.05 }, { id: "clip", type: "paper-clip", x: 2.3, y: 0.01 }])
push(plain, "plain")
const DEMOS = JSON.parse(readFileSync(join(HERE, "fixtures", "fluids-demos.json"), "utf8"))
for (const d of DEMOS) push(d, `demo:${d.id}`)

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
let errors = 0
for (let k = 0; k < scenes.length; k++) {
	const a = pyOut[k]
	const b = jsOut[k]
	const what = `${typeAt[k]} #${k}`
	if (a.error !== undefined || b.error !== undefined) {
		errors++
		ok(a.error === b.error, `${what}: the same error`, `${a.error} | ${b.error}`)
		continue
	}
	docs++
	ok(isDeepStrictEqual(a.doc, b.doc), `${what}: document`, firstDiff(a.doc, b.doc))
	ok(isDeepStrictEqual(a.resolved, b.resolved), `${what}: resolved`, firstDiff(a.resolved, b.resolved))
	ok(isDeepStrictEqual(a.warnings, b.warnings), `${what}: warnings`, firstDiff(a.warnings, b.warnings))
}
const plainDoc = jsOut[scenes.indexOf(plain)].doc
ok(!(plainDoc.processes ?? []).some((p) => ["liquid", "displace", "hull", "surface"].includes(p.kind)), "a scene without a liquid container gets no liquid, displace, hull or surface record")
ok(!plainDoc.solids.some((s) => s.stand !== undefined), "a fan in a scene without a liquid container gets no stand")
for (let k = scenes.length - DEMOS.length; k < scenes.length; k++) ok(jsOut[k].error === undefined, `${typeAt[k]} builds`, jsOut[k].error)

// ---- engine
if (process.argv.includes("--engine")) {
	await import(pathToFileURL(join(PG, "tools/engine-math-node.mjs")).href)
	const { admitDocument } = await import(pathToFileURL(join(PG, "tooling/src/sim/document.ts")).href)
	const { simulate } = await import(pathToFileURL(join(PG, "tooling/src/sim/physics.ts")).href)
	const plugins = await import(pathToFileURL(join(PG, "tooling/src/sim/plugins.ts")).href)
	await import(pathToFileURL(join(PG, "tooling/src/sim/modules/index.ts")).href)
	const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) + 0 : null)
	// the server's answer as web/server.py slims it (static solids that never move only in the first frame, 5 decimals)
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
	const picks = []
	for (let k = 0; k < scenes.length; k++) {
		if (jsOut[k].error !== undefined) continue
		const demo = typeAt[k].startsWith("demo:")
		if (!demo && picks.filter((p) => p.t === typeAt[k]).length >= Number(arg("--per", 2))) continue
		picks.push({ k, t: typeAt[k] })
	}
	const runs = []
	for (const { k, t } of picks) {
		const doc = jsOut[k].doc
		let server
		try {
			server = serverRun(doc)
		} catch (e) {
			ok(false, `engine runs ${t} #${k}`, e.message)
			continue
		}
		if (B?.handle) {
			const msg = B.handle({ id: k, doc, rate: 120 })
			ok(msg.error === undefined && JSON.stringify(msg.track) === server, `bundle == server engine: ${t} #${k}`, msg.error ?? `${server.length} bytes vs ${JSON.stringify(msg.track).length}`)
		}
		const track = JSON.parse(server)
		ok(!/null|NaN/.test(JSON.stringify(track.state ?? {})) && !/null|NaN/.test(JSON.stringify(track.frames)), `finite readings and placements: ${t} #${k}`)
		runs.push({ k, t, track })
	}
	const kinds = sim.plugins.modules().find((m) => m.name === "mod_fluids")?.goals ?? []
	const sc = []
	const tr = []
	for (const { k, t, track } of runs) {
		// a demo keeps its own goals (all must be met); other scenes get one sample of each goal kind
		const goals = t.startsWith("demo:") ? cleaned[k].goals : kinds.map((g) => g.sample?.(cleaned[k], pick)).filter(Boolean)
		sc.push({ ...cleaned[k], goals })
		tr.push(track)
	}
	const P = py({ scenes: sc, tracks: tr }).results
	let goals = 0
	for (let i = 0; i < sc.length; i++) {
		const { k, t } = runs[i]
		const js = sim.finish(sc[i], jsOut[k].doc, jsOut[k].resolved, tr[i]).summary
		goals += sc[i].goals.length
		ok(isDeepStrictEqual(P[i].summary, js), `summary Python == JS: ${t} #${k} (${sc[i].goals.length} goals)`, firstDiff(P[i].summary, js))
		if (t.startsWith("demo:")) {
			const res = (js.goals ?? []).map((g) => `${g.ok ? "✓" : "✗"} ${g.label}`)
			ok(res.length === sc[i].goals.length && (js.goals ?? []).every((g) => g.ok === true), `${t}: every expected outcome true`, res.join("; "))
			console.log(`  ${t}: ${res.join("; ")}`)
		}
	}
	console.log(`engine: ${runs.length} runs${B?.handle ? " (bundle compared)" : " (no bundle export: server engine only)"}, ${goals} goals judged`)
}

console.log(`fluids parity: ${cases} checks, ${docs} documents (${errors} refused alike), ${failed} mismatches`)
process.exit(failed ? 1 : 0)
