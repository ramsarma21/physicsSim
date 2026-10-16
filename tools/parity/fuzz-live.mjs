// Adversarial fuzz of the browser-side pipeline against the RUNNING server (read only: GET /api/catalog, GET /api/scenarios[/<id>], POST /api/simulate).
// The browser side is web/sim as the static deploy runs it, with all three catalog ports registered (web/sim/index.js), in two ways:
//   1. prepare() + finish() given the server's own track: doc, resolved, warnings and summary must be the server's, number for number (Object.is:
//      the sign of a zero counts), key order included; a scene the server refuses (HTTP 400/500) must be refused here with the same message.
//   2. (--engine, default on) the app's local API (web/sim/api.js createLocalApi; in node the engine runs on the main thread from web/sim/engine-worker.js):
//      its whole /api/simulate answer: doc, summary, warnings, resolved as above, and the track byte for byte as JSON text.
// Cases:
//   catalog    catalog() against GET /api/catalog (every type, previews, looks, materials, categories)
//   scenarios  every scenario the server lists (web/scenarios), as it serves them
//   fuzz       --n random mixed scenes (default 2000) of all 113 types: random props incl. min, max, slider_max, beyond the range (clamped), many decimals,
//              all-min / all-max corners; random places (a quarter of them dense clusters), angles (round, huge, fractional), held/fixed, goals (containers
//              and not), seconds, release, stage; 3 % carry garbage the server refuses or keeps (a prop of the wrong kind, a twice-used id, an id with "/")
//   hung       a swing, a rope pendulum, a hanging chain, an Atwood machine and a pulley lift with "falls" goals: as above, and the server must count none
//              of their held bodies (a rope, chain, pin or pulley holds them) as able to fall (`of` 0)
//   node tools/parity/fuzz-live.mjs [--n 2000] [--seed N] [--shard i/K] [--no-engine] [--server http://localhost:8790] [--dump fails.jsonl] [--verbose]
// --shard i/K runs only scenes with index % K == i (several processes in parallel; the server runs two engine workers). Nothing is started or stopped.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = path.resolve(HERE, "../..")
const SIM = pathToFileURL(path.resolve(process.env.PARITY_SIM || path.join(PG, "web/sim"))).href
const args = process.argv.slice(2)
const opt = (name, dflt) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt)
const N = Number(opt("n", 2000))
const SEED = Number(opt("seed", 20261015))
const [SHARD, SHARDS] = opt("shard", "0/1").split("/").map(Number)
const ENGINE = !args.includes("--no-engine")
const SERVER = opt("server", process.env.PARITY_SERVER ?? "http://localhost:8790")
const DUMP = opt("dump", null)
const VERBOSE = args.includes("--verbose")
const GROUPS = opt("groups", "catalog,scenarios,fuzz,hung").split(",")

const sim = await import(`${SIM}/index.js`)
const itemsMod = await import(`${SIM}/items.js`)
const rubeMod = await import(`${SIM}/rube.js`)
/** The way the overlap warnings once differed although the documents were identical: a pair of solids whose overlap depth is the 3 mm tolerance
 *  itself (a 3 mm part, as a concrete slab or a box wall at their thinnest, through another solid), at an angle whose sin/cos V8 and the platform
 *  libm round differently in the last bit, so `depth <= tol` fell on different sides. items.py and items.js now compare round(depth, 9) with the
 *  tolerance, so the two agree; this finds such pairs only to label a difference there (it is counted all the same). */
function overlapTies(doc, tol = 0.003) {
	const world = rubeMod._world(doc)
	const out = []
	const sol = doc.solids
	for (let i = 0; i < sol.length; i++)
		for (let j = i + 1; j < sol.length; j++) {
			if (sol[i].item === sol[j].item) continue
			let d
			try {
				d = itemsMod._overlap_depth(sol[i], world.get(sol[i].id), sol[j], world.get(sol[j].id))
			} catch {
				continue
			}
			if (Math.abs(d - tol) < 1e-12) out.push(`${sol[i].id} + ${sol[j].id} at ${d}`)
		}
	return out
}
/** Labels a difference that is only in the warnings and has such a tie (counted: it is a difference the user can see, and the rounding should prevent it). */
function labelTies(d, doc) {
	if (!d.length || !d.every((x) => x.startsWith(".warnings"))) return d
	const ties = overlapTies(doc)
	if (!ties.length) return d
	stats.overlapTies.push(ties[0])
	return [...d, `(a pair on the 3 mm tolerance: ${ties.slice(0, 3).join("; ")}; overlaps() compares round(depth, 9) on both sides, so they must agree: check that items.py and items.js both still round)`]
}
const { prepare, finish, catalog, BadScene } = sim
const { createLocalApi } = ENGINE ? await import(`${SIM}/api.js`) : {}

// ---------------------------------------------------------------- random
function mulberry32(a) {
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}
const rng = mulberry32(SEED)
const U = (a, b) => a + (b - a) * rng()
const ri = (a, b) => a + Math.floor(rng() * (b - a + 1))
const pick = (arr) => arr[Math.floor(rng() * arr.length)]
const chance = (p) => rng() < p

// ---------------------------------------------------------------- comparing
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
function diff(a, b, p = "", out = [], limit = 8) {
	if (out.length >= limit) return out
	if (typeof a === "number" && typeof b === "number") {
		if (!Object.is(a, b)) out.push(`${p}: ${a} vs ${b}${a === b ? " (sign of zero)" : ""}`)
	} else if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) out.push(`${p}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`)
		else {
			if (a.length !== b.length) out.push(`${p}: length ${a.length} vs ${b.length}`)
			for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${p}[${i}]`, out, limit)
		}
	} else if (isObj(a) && isObj(b)) {
		const ka = Object.keys(a)
		const kb = Object.keys(b)
		for (const k of ka) if (!kb.includes(k)) out.push(`${p}.${k}: only in js`)
		for (const k of kb) if (!ka.includes(k)) out.push(`${p}.${k}: only on the server`)
		if (ka.length === kb.length && ka.every((k) => kb.includes(k)) && ka.join("\u0000") !== kb.join("\u0000")) out.push(`${p}: key order ${ka.slice(0, 6).join(",")} vs ${kb.slice(0, 6).join(",")}`)
		for (const k of ka) if (kb.includes(k)) diff(a[k], b[k], `${p}.${k}`, out, limit)
	} else if (a !== b) out.push(`${p}: ${JSON.stringify(a)?.slice(0, 100)} vs ${JSON.stringify(b)?.slice(0, 100)}`)
	return out
}
function firstTrackDiff(mineText, theirsText) {
	const a = JSON.parse(mineText)
	const b = JSON.parse(theirsText)
	if (a.fps !== b.fps) return `fps ${a.fps} vs ${b.fps}`
	if (a.frames.length !== b.frames.length) return `${a.frames.length} frames vs ${b.frames.length}`
	for (let k = 0; k < a.frames.length; k++) {
		if (JSON.stringify(a.frames[k]) === JSON.stringify(b.frames[k])) continue
		const d = diff(a.frames[k], b.frames[k], `frames[${k}]`, [], 2)
		return d.length ? d.join("; ") : `frame ${k}: same values, different text`
	}
	const d = diff(a.impacts, b.impacts, "impacts", [], 2)
	return d.length ? d.join("; ") : "texts differ but frames and impacts match"
}

const report = {}
const dumps = []
function note(group, ok, id, diffs, scene) {
	const r = (report[group] ??= { cases: 0, bad: 0, samples: [] })
	r.cases++
	if (!ok) {
		r.bad++
		if (r.samples.length < 6) r.samples.push({ id, diffs, input: scene === undefined ? undefined : JSON.stringify(scene) })
		if (DUMP) dumps.push(JSON.stringify({ group, id, diffs, scene }))
	}
}

// ---------------------------------------------------------------- the server (read only)
async function get(route) {
	const r = await fetch(SERVER + route)
	return { status: r.status, text: await r.text() }
}
async function simulateOnServer(scene) {
	const r = await fetch(SERVER + "/api/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene }) })
	const text = await r.text()
	if (r.status !== 200) return { status: r.status, error: JSON.parse(text).error }
	const json = JSON.parse(text)
	const trackText = text.slice(text.lastIndexOf(',"track":') + 9, -1)
	return { status: 200, json, trackText }
}

// ---------------------------------------------------------------- one scene, both sides
const api = ENGINE ? createLocalApi({}) : null
let bundle = null
const engineBundle = async () => (bundle ??= await import(`${SIM}/engine-worker.js`))
const stats = { overlapTies: [], engineRefused: [], simulated: 0, refused400: 0, refused500: 0, items: 0, frames: 0, warnings: 0, goals: 0, met: 0, ms: { server: 0, local: 0 } }
async function check(group, id, scene) {
	const wire = JSON.parse(JSON.stringify(scene)) // what goes over HTTP (the server and the local API both get this)
	const t0 = performance.now()
	const sv = await simulateOnServer(wire)
	stats.ms.server += performance.now() - t0
	// 1. prepare + finish given the server's track
	let mine
	try {
		const { scene: cs, doc, resolved } = prepare(structuredClone(wire))
		mine = { cs, doc, resolved }
	} catch (e) {
		mine = { error: e.message, bad: e instanceof BadScene }
	}
	if (sv.status !== 200) {
		if (sv.status === 400) stats.refused400++
		else stats.refused500++
		const d = []
		if (!mine.error && sv.status === 500) {
			// the builder made a document and the server's ENGINE refused it (its 500 carries the engine's message): the bundle must refuse this
			// document with the same message (web/sim/api.js answers that as its 500 too)
			let msg = null
			try {
				;(await engineBundle()).run(structuredClone(mine.doc), 120)
			} catch (e) {
				msg = e.message
			}
			if (msg !== sv.error) d.push(`server 500 "${sv.error}"; js built the scene and the engine bundle ${msg === null ? "ran it" : `said "${msg}"`}`)
			else stats.engineRefused.push(`${id}: ${msg}`)
		} else if (!mine.error) d.push(`server ${sv.status} "${sv.error}" but js built the scene`)
		else if (mine.error !== sv.error) d.push(`message: js "${mine.error}" vs server "${sv.error}"`)
		else if ((sv.status === 400) !== mine.bad) d.push(`server ${sv.status} but js ${mine.bad ? "BadScene (400)" : "another error (500)"}`)
		note(`${group}: prepare/finish`, d.length === 0, id, d, wire)
	} else if (mine.error) {
		note(`${group}: prepare/finish`, false, id, [`js refused: ${mine.error}; the server ran it`], wire)
	} else {
		const track = JSON.parse(sv.trackText)
		const meta = finish(mine.cs, mine.doc, mine.resolved, track)
		const d = labelTies(diff({ doc: meta.doc, resolved: meta.resolved, warnings: meta.warnings, summary: meta.summary }, { doc: sv.json.doc, resolved: sv.json.resolved, warnings: sv.json.warnings, summary: sv.json.summary }), mine.doc)
		note(`${group}: prepare/finish`, d.length === 0, id, d, wire)
		stats.simulated++
		stats.items += mine.cs.items.length
		stats.frames += track.frames.length
		stats.warnings += sv.json.warnings.length
		for (const g of sv.json.summary.goals ?? []) {
			stats.goals++
			if (g.ok) stats.met++
		}
	}
	// 2. the app's local API, engine included
	if (!ENGINE) return sv
	const t1 = performance.now()
	let out
	try {
		out = await api("/api/simulate", { scene: structuredClone(wire) })
	} catch (e) {
		out = { error: e.message, status: e.status }
	}
	stats.ms.local += performance.now() - t1
	const d = []
	if (sv.status !== 200) {
		if (!out.error) d.push(`server ${sv.status} "${sv.error}" but the local API ran it`)
		else if (out.error !== sv.error || out.status !== sv.status) d.push(`local API ${out.status} "${out.error}" vs server ${sv.status} "${sv.error}"`)
	} else if (out.error) d.push(`local API ${out.status} "${out.error}"; the server ran it`)
	else {
		diff({ doc: out.doc, resolved: out.resolved, warnings: out.warnings, summary: out.summary }, { doc: sv.json.doc, resolved: sv.json.resolved, warnings: sv.json.warnings, summary: sv.json.summary }, "", d)
		if (diff(Object.keys(out), Object.keys(sv.json)).length) d.push(`answer keys ${Object.keys(out)} vs ${Object.keys(sv.json)}`)
		const mt = JSON.stringify(out.track)
		if (mt !== sv.trackText) d.push(`track: ${firstTrackDiff(mt, sv.trackText)}`)
		if (d.length && d.every((x) => x.startsWith(".warnings")) && overlapTies(out.doc).length) d.push("(a pair on the 3 mm tolerance: overlaps() rounds the depth to 9 decimals on both sides, so they must agree)")
	}
	note(`${group}: local API + engine`, d.length === 0, id, d, wire)
	return sv
}

// ---------------------------------------------------------------- random scenes
let CAT // the server's catalog
const CONTAINERS = ["box", "cup", "bucket", "basket"]
function propValue(p, mode) {
	if (p.kind === "bool") return chance(0.5)
	if (p.kind === "choice") return pick(p.choices)
	const lo = p.min
	const hi = p.max
	const isInt = p.kind === "int"
	const m = mode ?? pick(["uniform", "uniform", "uniform", "min", "max", "slider", "below", "above", "decimals", "step", "near-min", "near-max", "default"])
	let v
	switch (m) {
		case "min":
			v = lo
			break
		case "max":
			v = hi
			break
		case "slider":
			v = p.slider_max ?? hi
			break
		case "below":
			v = lo - (chance(0.5) ? U(0, 1) * (hi - lo) : pick([1, 1e3, 1e9, 1e-9]))
			break
		case "above":
			v = hi + (chance(0.5) ? U(0, 1) * (hi - lo) : pick([1, 1e3, 1e9, 1e-9]))
			break
		case "decimals":
			v = Number(U(lo, hi).toFixed(ri(3, 7)))
			break
		case "step":
			v = p.step ? lo + Math.round(U(0, (hi - lo) / p.step)) * p.step : U(lo, hi)
			break
		case "near-min":
			v = lo + U(0, 1e-6) * (hi - lo || 1)
			break
		case "near-max":
			v = hi - U(0, 1e-6) * (hi - lo || 1)
			break
		case "default":
			v = p.default
			break
		default:
			v = U(lo, hi)
	}
	if (isInt) v = chance(0.9) ? Math.round(v) : v // (a fractional int prop is the server's to round or refuse)
	return v
}
function randomItem(id, type, corner) {
	const t = CAT.types.find((x) => x.key === type)
	const props = {}
	for (const p of t.props) {
		if (corner) props[p.key] = propValue(p, p.kind === "number" || p.kind === "int" ? corner : undefined)
		else if (chance(0.45)) props[p.key] = propValue(p)
	}
	const it = { id, type, x: Number(U(-0.5, 3.1).toFixed(pick([2, 3, 6]))), y: Number(U(-0.1, 2.2).toFixed(pick([2, 3, 6]))), angle: 0, props }
	const a = rng()
	if (a < 0.45) it.angle = 0
	else if (a < 0.65) it.angle = pick([15, 30, 45, 60, 90, 120, 135, 150, 180, -30, -45, -90, -120, -150, -180, 270, 360])
	else if (a < 0.9) it.angle = Number(U(-180, 180).toFixed(pick([0, 1, 3, 6])))
	else if (a < 0.95) it.angle = pick([720, -1080, 3630, 99999, -1e5, 1e6])
	else it.angle = U(-1e-9, 1e-9)
	if (chance(0.2)) it.held = true
	if (chance(0.1)) it.fixed = true
	if (chance(0.1)) it.name = pick(["Ball", "kugel ü", "盒子", "a b c", "", "x".repeat(90), "Ǆemal", "İstanbul"])
	return it
}
function randomScene(i) {
	const keys = CAT.types.map((t) => t.key)
	const n = chance(0.1) ? ri(12, 30) : ri(1, 10)
	const items = []
	if (chance(0.35)) items.push({ id: "table", type: "table", x: 1.3, y: 0, angle: 0, props: {} })
	const corner = chance(0.15) ? pick(["min", "max", "below", "above"]) : null
	for (let k = 0; k < n; k++) items.push(randomItem(`i${k}`, chance(0.12) ? pick(CONTAINERS) : pick(keys), corner && chance(0.6) ? corner : null))
	const scene = { version: 2, id: `fuzz-${i}`, name: `fuzz ${i}`, seconds: pick([0.5, 1, 1.5, 2, 2, 2.5, 3, 4.5, U(0.5, 3)]), release: pick([0, 0.25, 0.5, 0.5, 1, U(0, 1.5)]), items, goals: [] }
	if (chance(0.25)) {
		// a dense cluster: everything within a few centimetres to half a metre of one point (overlaps, nested containers)
		const cx = U(0, 2.6)
		const cy = U(0.1, 1.5)
		const r = pick([0.03, 0.1, 0.25, 0.5])
		for (const it of items) if (it.id !== "table") Object.assign(it, { x: cx + U(-r, r), y: cy + U(-r, r) })
	}
	if (chance(0.03)) {
		// garbage the server refuses (400) or keeps: a prop of the wrong kind, an id used twice or holding "/"
		const it = pick(items)
		const t = CAT.types.find((x) => x.key === it.type)
		const g = rng()
		if (g < 0.5 && t.props.length) it.props[pick(t.props).key] = pick(["x", "", null, [], {}, "7", true, "nan", "1e400", -0])
		else if (g < 0.75) it.id = items[0].id
		else it.id = "a/b"
	}
	if (chance(0.15)) scene.stage = { x0: U(-3, 0), x1: U(3, 8), y0: U(-1, 0), y1: U(2, 6) }
	if (chance(0.03)) scene.seconds = pick([0.1, 25, 1e9]) // clamped
	if (chance(0.4)) {
		const ids = items.map((x) => x.id)
		const conts = items.filter((x) => CONTAINERS.includes(x.type)).map((x) => x.id)
		for (let g = 0; g < ri(1, 3); g++) {
			const goal = { kind: "in", item: pick(ids), container: conts.length && chance(0.8) ? pick(conts) : pick(ids) }
			if (chance(0.5)) goal.label = pick(["Ball in the box", "ünïcode ✓", "", "x".repeat(250)])
			if (chance(0.05)) goal.item = "missing"
			scene.goals.push(goal)
		}
	}
	otherGoals(scene, i)
	return scene
}
/** The goal kinds besides "in" (machines/items.py summarize: "falls", "hits", "moves"), on 35% of the scenes, from a random stream of their own
 *  (so every scene's items, and so its run, are what they were before these were added): good ones, and odd fields the server keeps as they are. */
function otherGoals(scene, i) {
	const r = mulberry32((SEED ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0)
	const pk = (arr) => arr[Math.floor(r() * arr.length)]
	if (r() >= 0.35) return
	const ids = scene.items.map((x) => x.id)
	const n = 1 + Math.floor(r() * 3)
	for (let k = 0; k < n; k++) {
		const kind = pk(["falls", "falls", "hits", "hits", "moves", "moves", "fall"])
		const g = { kind }
		if (kind === "falls" || kind === "fall") {
			if (r() < 0.5) g.items = Array.from({ length: 1 + Math.floor(r() * 4) }, () => (r() < 0.05 ? pk(["missing", 7, null]) : pk(ids)))
			else g.item = r() < 0.05 ? "missing" : pk(ids)
			if (r() < 0.1) g.items = pk([[], "i0", {}])
		} else if (kind === "hits") {
			g.item = pk(ids)
			g.target = r() < 0.05 ? pk(["missing", 3, null]) : pk(ids)
			if (r() < 0.5) g.before_s = pk([0.5, 1, 1.25, 2, 2.5, 0.333333, -1, 0, true, "1", null, 1e400])
		} else {
			g.item = r() < 0.05 ? "missing" : pk(ids)
			if (r() < 0.6) g.min_m = pk([0.01, 0.05, 0.1, 0.2, 0.5, 1, 1.5, 2.345, 0, -0.1, "0.1", null, true])
		}
		if (r() < 0.3) g.label = pk(["Topple them all", "", "ünïcode ✓", "x".repeat(250)])
		scene.goals.push(g)
	}
}

// ---------------------------------------------------------------- run
const t0 = Date.now()
try {
	CAT = JSON.parse((await get("/api/catalog")).text)
} catch (e) {
	console.log(`fuzz-live: the server at ${SERVER} is not answering (${e.cause?.code ?? e.message}); skipped (this test only compares against it)`)
	process.exit(0)
}
console.log(`fuzz-live: server ${SERVER}; seed ${SEED}; shard ${SHARD}/${SHARDS}; ${ENGINE ? `local API engine mode ${api.engine.mode}` : "no engine"}; ${CAT.types.length} types on the server`)
if (GROUPS.includes("catalog") && SHARD === 0) {
	const js = catalog()
	const d = diff(js, CAT, "", [], 40)
	note("catalog() vs GET /api/catalog", d.length === 0, "catalog", d)
	for (const t of CAT.types) {
		const mt = js.types.find((x) => x.key === t.key)
		const dt = mt ? diff(mt, t, `types[${t.key}]`) : ["missing in js"]
		note("catalog types (each, previews included)", dt.length === 0, t.key, dt)
	}
	if (ENGINE) {
		const viaApi = await api("/api/catalog")
		const da = diff(viaApi, CAT, "", [], 20)
		note("local API GET /api/catalog", da.length === 0, "catalog", da)
	}
	console.log(`  catalog: ${js.types.length} types here, ${CAT.types.length} on the server`)
}
if (GROUPS.includes("scenarios") && SHARD === 0) {
	const list = JSON.parse((await get("/api/scenarios")).text)
	for (const s of list) {
		const scene = JSON.parse((await get(`/api/scenarios/${encodeURIComponent(s.id)}`)).text)
		await check("scenarios", s.id, scene)
		if (ENGINE) {
			const viaApi = await api(`/api/scenarios/${encodeURIComponent(s.id)}`).catch((e) => ({ error: e.message }))
			// (the local API reads web/scenarios/<id>.json over fetch from where it was served: in node there is no page, so only compare when it answered)
			if (!viaApi.error) note("local API GET /api/scenarios/<id>", !diff(viaApi, scene).length, s.id, diff(viaApi, scene))
		}
	}
	console.log(`  scenarios: ${list.length} served by the server (${list.map((s) => s.id).join(", ")})`)
}
if (GROUPS.includes("hung") && SHARD === 0) {
	// bodies a rope, a chain, a pin or a pulley holds swing and drop without falling over (machines/items.py _Fall, web/sim/items.js the same): a swing's
	// seat, a rope pendulum's bob, a hanging chain's links, an Atwood machine's weights, a pulley lift's pail and weight are never counted as fallen
	const cases = [["swing", { start_angle: -40 }], ["rope-pendulum", { start_angle: 60 }], ["hanging-chain", {}], ["atwood-machine", {}], ["pulley-lift", {}]]
	for (const [type, props] of cases) {
		const scene = { version: 2, id: `hung-${type}`, name: type, seconds: 3, release: 0.5, items: [{ id: "table", type: "table", name: "Table", x: 1.3, y: 0, props: {} }, { id: "h", type, x: 1.3, y: 1.5, props }], goals: [{ kind: "falls", item: "h" }, { kind: "falls", items: ["h", "table"] }] }
		const sv = await check("hung", type, scene)
		const g = sv?.json?.summary?.goals?.[0]
		const d = g === undefined ? [`no falls goal in the server's answer (${sv?.status} ${sv?.error ?? ""})`] : g.of === 0 && g.fallen === 0 && g.ok === false ? [] : [`counted ${g.fallen} of ${g.of} as fallen (ok ${g.ok})`]
		note("hung: bodies held by a rope, chain, pin or pulley never count as fallen", d.length === 0, type, d, scene)
	}
	console.log(`  hung: ${cases.length} scenes of held bodies with falls goals`)
}
if (GROUPS.includes("fuzz")) {
	let done = 0
	for (let i = 0; i < N; i++) {
		const scene = randomScene(i) // (every shard draws every scene, so a seed gives the same scenes whatever the sharding)
		if (i % SHARDS !== SHARD) continue
		await check("fuzz", `fuzz-${i}`, scene)
		if (++done % 100 === 0 && VERBOSE) console.log(`  ${done} scenes (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
	}
	console.log(`  fuzz: ${done} random scenes of the ${CAT.types.length} types`)
}
api?.engine.terminate()

console.log(`  ran ${stats.simulated} scenes on both sides (${stats.items} items, ${stats.frames} frames, ${stats.warnings} overlap warnings, ${stats.goals} goals of which ${stats.met} met); refused by the server: ${stats.refused400} with 400, ${stats.refused500} with 500`)
if (stats.overlapTies.length) console.log(`  of the mismatches, ${stats.overlapTies.length} have a solid pair whose overlap depth is the 3 mm tolerance (overlaps() rounds it to 9 decimals on both sides, so these should not differ): ${stats.overlapTies.slice(0, 4).join(" | ")}`)
if (stats.engineRefused.length) console.log(`  refused by the engine (500) on both sides with the same message: ${stats.engineRefused.length}: ${stats.engineRefused.slice(0, 4).join(" | ")}`)
console.log(`  time: server ${(stats.ms.server / 1000).toFixed(0)} s, local API ${(stats.ms.local / 1000).toFixed(0)} s`)
console.log("\ngroup".padEnd(46) + "cases".padStart(8) + "mismatches".padStart(12))
let total = 0
let bad = 0
for (const [g, r] of Object.entries(report)) {
	console.log(`${g.padEnd(45)}${String(r.cases).padStart(8)}${String(r.bad).padStart(12)}`)
	total += r.cases
	bad += r.bad
	for (const s of r.samples) console.log(`    ${s.id}\n      ${[...s.diffs.slice(0, 5), ...s.diffs.slice(5).filter((x) => x.startsWith("(known"))].join("\n      ")}${s.input ? `\n      input: ${s.input.slice(0, 1500)}` : ""}`)
}
console.log(`${"total".padEnd(45)}${String(total).padStart(8)}${String(bad).padStart(12)}   (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
if (DUMP && dumps.length) fs.writeFileSync(DUMP, dumps.join("\n") + "\n")
process.exit(bad ? 1 : 0)
