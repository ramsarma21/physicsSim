// Parity harness for the mechanisms port: web/sim/catalog-mechanisms.js against machines/catalog_mechanisms.py, as machines/items.py and web/server.py run it
// (the companion of core.mjs, which checks items.js, clean.js and layout.js and the core types; nothing here changes how core.mjs, catalog.mjs or run.sh's other
// steps behave).
//
//   node tools/parity/mechanisms.mjs [--seed N] [--quick] [--groups a,b,c] [--workers 2] [--verbose] [--export file.json] [--no-live] [--index] [--full]
//
// The Python side is py_dump.py in --mode server with --snapshot catalog_mechanisms: the whole server (items.py, catalog_items.py, catalog_everyday.py,
// catalog_mechanisms.py), and a copy of the tables just before and just after catalog_mechanisms.py registers. This side loads the "before" tables (the materials,
// measured pairs, looks and categories items.py and the two catalog modules before it leave: those ports are other work) into web/sim, registers
// web/sim/catalog-mechanisms.js on them the way index.js does (use_catalog_module), and the module must make exactly the "after" tables and the same
// types. A scene may then hold core items and mechanisms items; every case is JSON for Python and a call here, and the answers are compared number against
// number (Object.is: the sign of a zero counts), key order included.
//   registration  the types the module registers are the ones catalog_mechanisms.py does, in order; index.js (a child node) registers it after the other catalog modules
//   tables        MATERIALS (which numbers are ints), measured pairs, looks, categories: the same set, values and order as Python's "after" tables
//   catalog       catalog(): every mechanisms type's JSON incl. its preview (the picture of the card), the order, the materials, the looks, the categories
//   types         each type alone: default, min, max, below min, above max, 20 random prop sets, held/fixed, every material, a material's numbers edited
//   sweeps        each type's every prop in turn: its min, max, default, a step off each end, the middle, zero, twice, half; the rest at default
//   corners       each type with every prop at its min or its max, at random (some of which Python refuses as a polygon the engine would: same message)
//   ties          each type's props and its place at exact binary ties for round(x, 5) (odd multiples of 1/64, 1/32, 1/128), alone and several at once, at round angles too
//   angles        each type at round angles (multiples of 15, 30, 45, 90 degrees, whole degrees, tiny angles), round and random props: where sin/cos land on a tie
//   tiebulk       (not in the default list: --groups tiebulk [--bulk R]) the ties group R (default 40) times over with fresh random numbers, for every type but the hanging chain (see chainties)
//   chainties     (not in the default list: --groups chainties [--bulk N]) hanging chains at exact binary ties (odd multiples of 1/64): its middle link's centre is zero but for rounding noise, which Python's libm and V8's make differently
//   bulk          (not in the default list: --groups bulk [--bulk N]) N (default 20000) random single items of the types that call libm (sin, cos, tan, sinh, cosh, asinh, atan2, pow), random props and angles
//   random        random scenes of 3-8 items, core and mechanisms mixed (clusters, goals, held and fixed): doc, resolved, warnings
//   dense         dense clusters of 10-45 items against Python's overlap warnings (polygons, welded parts)
//   clean         garbage in every prop slot of every type: the 400 message or the cleaned scene, and the same through layout
//   scenarios     web/scenarios/*.json (and web/saved) as saved, with the items this side has a type for
//   summary       the engine's tracks (research/poc/worker.ts, as web/server.py runs it) for the scenarios and for random mixed scenes: summarize() given the track
//   live          the running server, read only: GET /api/catalog, POST /api/layout, POST /api/simulate (its own track and summary). A difference counts only if the
//                 server agrees with the current python files (a server that has not re-read a file the model fixers edited is reported as stale, not counted)
// --index: instead of the "before" tables and only web/sim/catalog-mechanisms.js, load web/sim/index.js as the app does (every catalog port registered: catalog_items,
// catalog_everyday, catalog_mechanisms) and compare against the whole server: then the scene files in web/scenarios are compared with every item in them, and the
// tables, catalog and registration checks hold for the whole of web/sim. (The default run needs only this module's port; this is the integration check.)
// --export writes the layout/clean cases and Python's answers (with the "before" tables) for tools/parity/browser-mechanisms.mjs, which replays them in headless Chromium.
import { spawn } from "node:child_process"
import { execFileSync } from "../child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { isDeepStrictEqual } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = path.resolve(HERE, "../..")
const SIM_DIR = path.resolve(process.env.PARITY_SIM || path.join(PG, "web/sim"))
const SIM = pathToFileURL(SIM_DIR).href
const { BadScene, clean } = await import(`${SIM}/clean.js`)
const items = await import(`${SIM}/items.js`)
const { prepare, with_statics } = await import(`${SIM}/layout.js`)
const { hasOwn } = await import(`${SIM}/pymath.js`)
const { MATERIALS, MATERIAL_INTS, MEASURED, pairKey } = await import(`${SIM}/materials.js`)
const args = process.argv.slice(2)
const opt = (name, dflt) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt)
const SEED = Number(opt("seed", 20241015))
const QUICK = args.includes("--quick")
const VERBOSE = args.includes("--verbose")
const WORKERS = Number(opt("workers", 2))
const EXPORT = opt("export", null)
const INDEX = args.includes("--index")
const FULL = args.includes("--full") // the whole input of a mismatching case, not its first 600 characters
const GROUPS = opt("groups", `registration,tables,catalog,types,sweeps,corners,ties,angles,random,dense,clean,scenarios,summary${args.includes("--no-live") ? "" : ",live"}`).split(",")
const EXPORT_CAP = { types: 200, sweeps: 150, corners: 100, ties: 100, angles: 100, random: 300, dense: 40, clean: 150, scenarios: 40 }
const exported = []

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
const dp = (x, d) => Number(x.toFixed(d))
const logU = (a, b) => Math.exp(U(Math.log(a), Math.log(b)))

// ---------------------------------------------------------------- python side
const PYTHON = process.env.PYTHON || "python3"
const PY_ARGS = ["-I", path.join(HERE, "py_dump.py"), "--mode", "server", "--snapshot", "catalog_mechanisms"]
/** What Python is sent: the JSON a browser would have posted, in which a NaN or an infinity ("@@float" marker here) is null. */
const toPython = (r) => JSON.stringify(r, (_k, v) => (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "@@float" in v ? null : v))
function askPython(requests) {
	const out = []
	const B = 400
	for (let i = 0; i < requests.length; i += B) {
		const chunk = requests.slice(i, i + B)
		const input = chunk.map(toPython).join("\n") + "\n"
		// (no physics module, machines/mod_*.py: this side registers the catalog ports alone; the modules have parity checks of their own)
		const res = execFileSync(PYTHON, PY_ARGS, { input, maxBuffer: 1 << 30, encoding: "utf8", cwd: PG, env: { ...process.env, PLAYGROUND_MODULES: "" } })
		const lines = res.split("\n").filter((l) => l.trim())
		if (lines.length !== chunk.length) throw new Error(`python answered ${lines.length} of ${chunk.length}`)
		for (const l of lines) out.push(JSON.parse(l))
	}
	return out
}

// ---------------------------------------------------------------- comparing
const isObj = (v) => v !== null && typeof v === "object"
/** Differences between two JSON-like values: numbers by Object.is, objects by keys and key order. */
function diff(a, b, p = "", out = [], limit = 8) {
	if (out.length >= limit) return out
	if (typeof a === "number" && typeof b === "number") {
		if (!Object.is(a, b)) out.push(`${p}: ${a} vs ${b}${a === b ? " (sign of zero)" : ""}`)
	} else if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) out.push(`${p}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`)
		else {
			if (a.length !== b.length) out.push(`${p}: length ${a.length} vs ${b.length}`)
			for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${p}[${i}]`, out, limit)
		}
	} else if (isObj(a) && isObj(b)) {
		const ka = Object.keys(a)
		const kb = Object.keys(b)
		for (const k of ka) if (!kb.includes(k)) out.push(`${p}.${k}: only in js`)
		for (const k of kb) if (!ka.includes(k)) out.push(`${p}.${k}: only in python`)
		if (ka.length === kb.length && ka.every((k) => kb.includes(k)) && ka.join("\u0000") !== kb.join("\u0000")) out.push(`${p}: key order ${ka.slice(0, 6).join(",")} vs ${kb.slice(0, 6).join(",")}`)
		for (const k of ka) if (kb.includes(k)) diff(a[k], b[k], `${p}.${k}`, out, limit)
	} else if (a !== b) out.push(`${p}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`)
	return out
}

const report = {}
function note(group, ok, id, diffs, detail) {
	const r = (report[group] ??= { cases: 0, bad: 0, samples: [] })
	r.cases++
	if (!ok) {
		r.bad++
		if (r.samples.length < 5) r.samples.push({ id, diffs, detail })
	}
}

// ---------------------------------------------------------------- the js side
function revive(v) {
	if (Array.isArray(v)) return v.map(revive)
	if (isObj(v)) {
		const ks = Object.keys(v)
		if (ks.length === 1 && ks[0] === "@@float") return { nan: NaN, inf: Infinity, "-inf": -Infinity }[v["@@float"]]
		const o = {}
		for (const k of ks) Object.defineProperty(o, k, { value: revive(v[k]), enumerable: true, writable: true, configurable: true })
		return o
	}
	return v
}
const wire = (v) => (v === undefined ? undefined : revive(JSON.parse(JSON.stringify(v)))) // what the Python was sent

function jsAnswer(req) {
	const scene = wire(req.scene)
	if (req.op === "clean") {
		try {
			return { ok: clean(scene) }
		} catch (e) {
			if (e instanceof BadScene) return { error: e.message }
			return { error500: `${e.name}: ${e.message}` }
		}
	}
	if (req.op === "layout") {
		try {
			const { scene: s, doc, resolved } = prepare(scene)
			const out = { doc, resolved, warnings: items.overlaps(s, doc) }
			if (req.track != null) out.summary = items.summarize(s, doc, with_statics(req.track))
			return out
		} catch (e) {
			if (e instanceof BadScene) return { error: e.message }
			return { error500: `${e.name}: ${e.message}` }
		}
	}
	throw new Error(`op ${req.op}`)
}

let python500 = 0
const known = {} // differences that are understood and not counted (group chainties)
/** A hanging chain's middle link (odd number of links) is centred on the chain's axis: its x is zero but for rounding noise (about 3e-17 m), whatever libm computes
 *  the catenary with, and the noise decides the rounding of the link's world x (or y, turned a quarter) where the chain's own place is exactly an odd multiple of
 *  1/64 m (or ends in 5 at the 6th decimal), a tie for round(x, 5). Python's libm (Apple's asinh, sinh) and V8's make that noise differently, so those places are the one thing a port cannot repeat:
 *  the cases here move such a place by 2^-30 m (group chainties does not, and reports the difference apart: see there). */
function avoidChainTies(req) {
	// (a 6-decimal place ending in 5, as 0.123455, is a tie too: its double is a hair either side of one, and the same noise decides)
	const moved = (v) => (typeof v === "number" && Math.abs(Math.abs(v * 1e5) % 1 - 0.5) < 1e-6 ? v + 2 ** -30 : v)
	const its = req.scene?.items
	if (!Array.isArray(its) || !its.some((i) => i?.type === "hanging-chain")) return req
	return { ...req, scene: { ...req.scene, items: its.map((i) => (i?.type === "hanging-chain" ? { ...i, x: moved(i.x), y: moved(i.y) } : i)) } }
}
/** Runs the requests on both sides and notes every comparison under `group`. Returns [{req, py, js, ok}]. opts.raw: the requests as they are (no avoidChainTies);
 *  opts.known: the differences are kept apart (printed, not counted). */
function compare(group, requests, opts = {}) {
	if (!opts.raw) requests = requests.map(avoidChainTies)
	const py = askPython(requests)
	const out = []
	requests.forEach((req, i) => {
		const p = py[i].res
		let j
		try {
			j = jsAnswer(req)
		} catch (e) {
			j = { harness_error: `${e.name}: ${e.message}\n${e.stack}` }
		}
		let diffs = []
		if (p.harness_error) diffs = [`python harness: ${p.harness_error}`]
		else if (p.error500 !== undefined) {
			// (a 500 is the server's crash page: for a built-in type it should never come; if it does, any error will do here, but it is counted and shown)
			python500++
			// (a prop of the wrong type, the one thing a scene can do to a built-in builder, is an error with a text of its own: the same here)
			const same = j.error500 !== undefined && (!p.error500.startsWith("TypeError: unsupported operand") || p.error500 === j.error500)
			diffs = same ? [] : [`python error500 ${p.error500} but js ${JSON.stringify(j).slice(0, 100)}`]
			if (VERBOSE) console.log(`  python 500 in ${req.id}: ${p.error500}`)
		} else diffs = diff(j, p)
		if (opts.known) {
			const k = (known[group] ??= { cases: 0, bad: 0, samples: [] })
			k.cases++
			if (diffs.length) {
				k.bad++
				if (k.samples.length < 3) k.samples.push({ id: req.id, diffs, detail: JSON.stringify(req.scene) })
			}
		} else note(group, diffs.length === 0, req.id, diffs, FULL ? JSON.stringify(req.scene) : JSON.stringify(req.scene)?.slice(0, 600))
		if (EXPORT && req.track == null && exported.filter((e) => e.group === group).length < (EXPORT_CAP[group] ?? 0)) exported.push({ group, req: JSON.parse(JSON.stringify(req)), py: p })
		out.push({ req, py: p, js: j, ok: diffs.length === 0 })
	})
	return out
}

// ---------------------------------------------------------------- the tables, and the module registered on them
let PRE = null // python's tables just before catalog_mechanisms.py registers (items.py, catalog_items.py and catalog_everyday.py's)
let POST = null // and just after
let PY_TYPES = [] // the keys catalog_mechanisms.py registers, in order
let MECH = [] // the keys web/sim/catalog-mechanisms.js registered, in order
let MODULE = null
const CORE = ["table", "wall", "plank", "superball", "plastic-ball", "clay-ball", "domino", "domino-row", "seesaw", "box"]
const BALLS = ["superball", "plastic-ball", "clay-ball"]

/** Materials, measured pairs and looks that web/sim holds, against a python snapshot: `exact` = the same set too (and the same order). */
function checkTables(t, exact, group) {
	const pyMaterials = Object.fromEntries(Object.entries(t.materials).map(([k, d]) => [k, Object.fromEntries(Object.entries(d).filter(([kk]) => kk !== "_ints"))]))
	const pyPairs = Object.fromEntries(t.measured.map(([pair, kw]) => [pairKey(pair[0], pair[pair.length - 1]), kw]))
	let n = 0
	for (const [name, vals] of Object.entries(MATERIALS)) {
		let d = hasOwn(pyMaterials, name) ? diff(vals, pyMaterials[name]) : ["not in python"]
		if (!d.length) d = diff([...(MATERIAL_INTS.get(name) ?? [])].sort(), t.materials[name]._ints, "which numbers are ints") // (700 and 700.0 print differently)
		note(group, d.length === 0, `material ${name}`, d)
		n++
	}
	for (const [key, kw] of MEASURED) {
		const d = hasOwn(pyPairs, key) ? diff(kw, pyPairs[key]) : ["not in python"]
		note(group, d.length === 0, `measured ${key.replace("\u0000", " + ")}`, d)
		n++
	}
	for (const [name, look] of Object.entries(items.LOOKS)) {
		const d = hasOwn(t.looks, name) ? diff(look, t.looks[name]) : ["not in python"]
		note(group, d.length === 0, `look ${name}`, d)
		n++
	}
	if (exact) {
		for (const name of Object.keys(pyMaterials)) if (!hasOwn(MATERIALS, name)) note(group, false, `material ${name}`, ["only in python"])
		for (const key of Object.keys(pyPairs)) if (!MEASURED.has(key)) note(group, false, `measured ${key.replace("\u0000", " + ")}`, ["only in python"])
		for (const name of Object.keys(t.looks)) if (!hasOwn(items.LOOKS, name)) note(group, false, `look ${name}`, ["only in python"])
	}
	return n
}

/** Loads what items.py and the catalog modules before this one leave into web/sim, then registers web/sim/catalog-mechanisms.js on it as index.js does. */
async function loadModule() {
	PRE = askPython([{ id: "tables-before", op: "tables", at: "before" }])[0].res
	POST = askPython([{ id: "tables-after", op: "tables", at: "after" }])[0].res
	PY_TYPES = askPython([{ id: "module-types", op: "module-types" }])[0].res.catalog_mechanisms
	if (INDEX) {
		await import(`${SIM}/index.js`) // registers catalog_items, catalog_everyday and catalog_mechanisms
		MECH = PY_TYPES.filter((k) => hasOwn(items.TYPES, k))
		console.log(`  web/sim/index.js loaded: ${items.CATALOG_MODULES.join(", ")} registered (${Object.keys(items.TYPES).length} types, ${MECH.length} of catalog_mechanisms.py's ${PY_TYPES.length})`)
		return
	}
	const checked = checkTables(PRE, false, "tables before the module")
	let added = 0
	for (const [name, d] of Object.entries(PRE.materials)) {
		const { _ints, ...vals } = d
		if (!hasOwn(MATERIALS, name)) {
			items.define_material(name, vals, _ints)
			added++
		}
	}
	for (const [pair, kw] of PRE.measured) items.measured(pair[0], pair[pair.length - 1], kw)
	for (const [k, v] of Object.entries(PRE.looks)) if (!hasOwn(items.LOOKS, k)) items.add_look(k, v)
	for (const c of PRE.categories) if (!items.CATEGORIES.includes(c)) items.CATEGORIES.push(c)
	const before = new Set(Object.keys(items.TYPES))
	MODULE = await import(`${SIM}/catalog-mechanisms.js`)
	items.use_catalog_module("catalog_mechanisms", MODULE.register_all)
	MECH = Object.keys(items.TYPES).filter((k) => !before.has(k))
	console.log(`  tables before catalog_mechanisms.py: ${added} materials added, ${PRE.measured.length} measured pairs, ${Object.keys(PRE.looks).length} looks; the ${checked} entries web/sim held already are Python's`)
	console.log(`  web/sim/catalog-mechanisms.js registered ${MECH.length} types: ${MECH.join(", ")}`)
}

// ---------------------------------------------------------------- cases
const STAGE = { x0: -0.55908203125, x1: 3.19091796875, y0: -0.15625, y1: 2.34375 }
let caseNo = 0
const cid = (g) => `${g}-${++caseNo}`

/** A set of props for `type`, for every one of its numeric, bool and choice props: mode default | min | max | below | above | random. */
function propValues(type, mode) {
	const specs = items.TYPES[type].schema().props
	const props = {}
	for (const p of specs) {
		if (p.kind === "number" || p.kind === "int") {
			const lo = p.min
			const hi = p.max
			if (mode === "default") continue
			if (mode === "min") props[p.key] = lo
			else if (mode === "max") props[p.key] = hi
			else if (mode === "below") props[p.key] = lo - (chance(0.5) ? 1 : 1e-3 * (hi - lo))
			else if (mode === "above") props[p.key] = hi + (chance(0.5) ? 1 : 0.5 * (hi - lo))
			else if (chance(0.8)) {
				const r = rng()
				let v
				if (r < 0.5) v = U(lo, hi)
				else if (r < 0.85 && lo > 0) v = logU(lo, hi)
				else if (r < 0.92) v = lo + (hi - lo) * pick([0, 0.5, 0.25, 0.75, 1])
				else if (r < 0.96) v = Math.min(hi, Math.max(lo, Math.round(U(lo, hi) * 64) / 64)) // exact binary ties for round(x, 5)
				else v = dp(U(lo, hi), ri(0, 3))
				if (p.kind === "int") v = ri(lo, hi)
				else if (chance(0.3)) v = dp(v, ri(2, 6))
				props[p.key] = v
			}
		} else if (p.kind === "bool") {
			if (mode === "min") props[p.key] = false
			else if (mode === "max") props[p.key] = true
			else if (mode === "random" && chance(0.5)) props[p.key] = chance(0.5)
			else if (mode === "below") props[p.key] = pick(["yes", "no", 1, 0, "True"])
		} else if (p.kind === "choice") {
			if (mode === "min") props[p.key] = p.choices[0]
			else if (mode === "max") props[p.key] = p.choices[p.choices.length - 1]
			else if (mode === "random" && chance(0.6)) props[p.key] = pick(p.choices)
		}
	}
	return props
}

function placement() {
	const tie = chance(0.12) // multiples of 1/64: exact binary ties when rounded to 5 decimals
	return {
		x: tie ? ri(-30, 200) / 64 : chance(0.2) ? pick([0, 1.3, 2.5, -0.5]) : dp(U(-0.5, 3.1), ri(0, 6)),
		y: tie ? ri(0, 100) / 64 : chance(0.2) ? pick([0, 0.5, 1]) : dp(U(0, 1.6), ri(0, 6)),
		angle: tie || chance(0.4) ? 0 : chance(0.04) ? pick([5.729e-11, 5.8e-11, 5.7e-11, 1e-10, -1e-10, 1e-9, 1e-12]) : chance(0.5) ? ri(-360, 360) : chance(0.5) ? dp(U(-180, 180), ri(1, 8)) : U(-720, 720)
	}
}

/** A stage whose camera pixel origin lands exactly on a .5 (a tie for round()), or an ordinary random one. */
function randomStage() {
	if (chance(0.5)) return { ...STAGE }
	if (chance(0.5)) {
		const ppm = pick([64, 100, 128, 200, 256, 384, 400, 512])
		const x0 = (ri(-300, 300) + 0.5) / ppm
		const y0 = (ri(-300, 300) + 0.5) / ppm
		return { x0, x1: x0 + 1536 / ppm, y0, y1: y0 + 1024 / ppm }
	}
	const x0 = dp(U(-3, 1), ri(0, 6))
	const y0 = dp(U(-2, 1), ri(0, 6))
	return { x0, x1: dp(x0 + U(0.5, 8), ri(0, 6)), y0, y1: dp(y0 + U(0.5, 5), ri(0, 6)) }
}

function itemOf(id, type, props, extra = {}) {
	const o = { id, type, ...placement(), ...extra }
	if (props && Object.keys(props).length) o.props = props
	return o
}

const sceneOf = (itemsList, extra = {}) => ({ version: 2, id: "t", name: "t", seconds: 4.5, release: 0.5, stage: STAGE, items: itemsList, goals: [], ...extra })
const flagsOf = () => (chance(0.25) ? { held: chance(0.5) } : chance(0.25) ? { fixed: true } : {})

/** Every type alone: default, min, max, below, above, 20 random prop sets, held and fixed ones, and each material with its numbers edited. */
function typeCases(types) {
	const reqs = []
	for (const type of types) {
		const modes = ["default", "min", "max", "below", "above", ...Array(20).fill("random")]
		for (const mode of modes) reqs.push({ id: cid(`type-${type}-${mode}`), op: "layout", scene: sceneOf([itemOf("a", type, propValues(type, mode), flagsOf())]) })
		for (const mode of ["default", "min", "max", "random", "random"]) {
			reqs.push({ id: cid(`type-${type}-${mode}-fixed`), op: "layout", scene: sceneOf([itemOf("a", type, propValues(type, mode), { fixed: true })]) })
			reqs.push({ id: cid(`type-${type}-${mode}-held`), op: "layout", scene: sceneOf([itemOf("a", type, propValues(type, mode), { held: true })]) })
		}
		const t = items.TYPES[type].schema()
		const mat = t.props.find((p) => p.key === "material")
		if (mat) {
			for (const m of mat.choices) {
				reqs.push({ id: cid(`type-${type}-mat-${m}`), op: "layout", scene: sceneOf([itemOf("a", type, { material: m })]) })
				reqs.push({ id: cid(`type-${type}-mat-${m}-random`), op: "layout", scene: sceneOf([itemOf("a", type, { ...propValues(type, "random"), material: m })]) })
				reqs.push({ id: cid(`type-${type}-mat-${m}-edit`), op: "layout", scene: sceneOf([itemOf("a", type, { material: m, friction: dp(U(0, 2), 3), bounce: dp(U(0, 1), 2) })]) })
			}
			for (const k of ["bounce", "friction", "rolling", "side"]) {
				const p = t.props.find((q) => q.key === k)
				reqs.push({ id: cid(`type-${type}-${k}-edit`), op: "layout", scene: sceneOf([itemOf("a", type, { [k]: pick([p.min, p.max, dp(U(p.min, p.max), 3), p.default, dp(p.default * 1.0000000001, 12)]) })]) })
				for (const v of [1e-5, 1e-4, 1.5e-7, 0.30000000000000004, 0.9999999999999999, 0.1, p.default * (1 + 1e-12), p.default * (1 - 1e-9)]) {
					reqs.push({ id: cid(`type-${type}-${k}-${v}`), op: "layout", scene: sceneOf([itemOf("a", type, { [k]: v })]) })
				}
			}
		}
	}
	return reqs
}

/** Each prop of each type in turn, the others at default. */
function sweepCases(types) {
	const reqs = []
	for (const type of types) {
		for (const p of items.TYPES[type].schema().props) {
			let vals
			if (p.kind === "number" || p.kind === "int") {
				const span = p.max - p.min
				vals = [p.min, p.max, p.default, p.min + p.step, p.max - p.step, p.min + span / 2, p.min + span / 4, p.min + (3 * span) / 4, p.default * 2, p.default / 2, p.default * 1.5, 0, 1, -1, p.default * (1 + 1e-9)]
				vals = vals.filter((v) => v >= p.min && v <= p.max)
				if (p.kind === "int") vals = vals.map((v) => Math.round(v))
				else vals = vals.concat(vals.slice(0, 5).map((v) => dp(v, 3)))
				vals = [...new Set(vals)]
			} else if (p.kind === "bool") vals = [true, false]
			else vals = p.choices
			for (const v of vals) reqs.push({ id: cid(`sweep-${type}-${p.key}-${v}`), op: "layout", scene: sceneOf([{ id: "a", type, x: 1.3, y: 0.4, angle: 0, props: { [p.key]: v } }]) })
		}
	}
	return reqs
}

/** Each type with every numeric prop at its min or max (random corner), and at a hair inside it. */
function cornerCases(types) {
	const reqs = []
	for (const type of types) {
		const specs = items.TYPES[type].schema().props
		for (let i = 0; i < 40; i++) {
			const props = {}
			const inside = chance(0.3)
			for (const p of specs) {
				if (p.kind === "number" || p.kind === "int") {
					const up = chance(0.5)
					let v = up ? p.max : p.min
					if (inside) v = up ? p.max - (p.max - p.min) * 1e-4 : p.min + (p.max - p.min) * 1e-4
					props[p.key] = p.kind === "int" ? Math.round(v) : v
				} else if (p.kind === "bool") props[p.key] = chance(0.5)
				else if (p.kind === "choice" && chance(0.5)) props[p.key] = pick(p.choices)
			}
			reqs.push({ id: cid(`corner-${type}`), op: "layout", scene: sceneOf([itemOf("a", type, props, flagsOf())]) })
		}
	}
	return reqs
}

/** Props and places at exact binary ties for Python's round(x, 5) (and half of one: a length's half is a tie too): odd multiples of 1/64, 1/32 and 1/128. */
function tieCases(types) {
	const reqs = []
	const dyadic = (p) => {
		const q = pick([64, 32, 128, 16, 256])
		const lo = Math.ceil(p.min * q)
		const hi = Math.floor(p.max * q)
		if (hi < lo) return null
		let k = ri(lo, hi)
		if (chance(0.7) && k % 2 === 0 && k + 1 <= hi) k++ // an odd one
		return k / q
	}
	for (const type of types) {
		const specs = items.TYPES[type].schema().props.filter((p) => p.kind === "number" && p.key !== "bounce" && p.key !== "friction" && p.key !== "rolling" && p.key !== "side")
		for (const p of specs) {
			for (let i = 0; i < 8; i++) {
				const v = dyadic(p)
				if (v === null) break
				const angle = pick([0, 0, 0, 30, 90, 120, -30, 45, 180, -90])
				reqs.push({ id: cid(`ties-${type}-${p.key}`), op: "layout", scene: sceneOf([{ id: "a", type, x: pick([0, 1, 0.015625, 1.3, 2.609375, 0.5]), y: pick([0, 0.5, 0.015625, 0.140625, 1]), angle, props: { [p.key]: v } }]) })
			}
		}
		for (let i = 0; i < 20; i++) {
			const props = {}
			for (const p of specs) if (chance(0.7)) {
				const v = dyadic(p)
				if (v !== null) props[p.key] = v
			}
			const angle = pick([0, 0, 30, 60, 90, 120, 150, -30, -60, -90, -120, 180, 45])
			reqs.push({ id: cid(`ties-${type}-all`), op: "layout", scene: sceneOf([{ id: "a", type, x: pick([0, 1, 0.015625, 2.609375, 0.5, -0.484375]), y: pick([0, 0.5, 0.015625, 0.140625, 0.734375]), angle, props, ...flagsOf() }]) })
		}
	}
	return reqs
}

/** Each type at round angles: where a position lands exactly on a rounding tie, sin/cos at multiples of 30 degrees are the places Python's libm and JavaScript's differ. */
function angleCases(types) {
	const reqs = []
	const angles = [...Array.from({ length: 49 }, (_, i) => (i - 24) * 15), 90, 180, 270, 360, -360, 720, 3600, -3600, 3630, 7200, -7230, 99990, 1e5, -1e5, 12.452, 1e-9, 5.729e-11, 89.999999, 179.9999999, 0.5, 22.5, 67.5, 112.5, ...Array.from({ length: 12 }, () => ri(-360, 360)), ...Array.from({ length: 6 }, () => U(-180, 180))]
	for (const type of types) {
		for (const a of angles) {
			const props = chance(0.5) ? {} : propValues(type, chance(0.5) ? "random" : pick(["min", "max"]))
			const x = pick([0, 1.3, 0.5, -0.52, 3.12, 0.00001, 0.123455, 2.5, 0.015625, 1])
			const y = pick([0, 0.5, 0.7, 0.00001, 1.0, 0.015625, 0.25])
			reqs.push({ id: cid(`angle-${type}-${a}`), op: "layout", scene: sceneOf([{ id: "a", type, x, y, angle: a, ...(Object.keys(props).length ? { props } : {}), ...flagsOf() }]) })
		}
	}
	return reqs
}

/** A random scene of core and mechanisms items (the mechanisms types most of the list). `spread`: the cluster's size. */
function mixedScene(n, spread = null) {
	const pool = [...MECH, ...MECH, ...MECH, ...CORE]
	const list = []
	const cluster = spread !== null || chance(0.5)
	const sp = spread ?? 0.4
	const cx = U(0.2, 2.8)
	const cy = U(0.05, 0.9)
	if (chance(0.6)) list.push({ id: "table", type: "table", x: 1.3, y: 0, props: chance(0.5) ? {} : propValues("table", "random") })
	while (list.length < n) {
		const type = pick(pool)
		const id = chance(0.1) ? pick(["Ball 1", "x", "a b", "é", "10", "2", "constructor", "__proto__"]) + list.length : `i${list.length}`
		const o = itemOf(id, type, propValues(type, "random"), chance(0.2) ? { held: chance(0.7) } : chance(0.1) ? { fixed: true } : {})
		if (cluster) {
			o.x = dp(cx + U(-sp, sp), ri(2, 6))
			o.y = dp(cy + U(-sp / 4, sp), ri(2, 6))
		}
		if (chance(0.1)) o.angle = pick([0, 90, 45, 30, -30, 180, ri(-180, 180)])
		if (chance(0.3)) o.name = pick(["Ball", "Dominoes", "the thing", "", "ss", "boss", "Bats", "Springs", "Wheels"])
		list.push(o)
	}
	const goals = []
	const ball = list.find((i) => BALLS.includes(i.type))
	const box = list.find((i) => i.type === "box")
	if (ball && box) goals.push({ kind: "in", item: ball.id, container: box.id, label: chance(0.5) ? "Land it" : "" })
	if (chance(0.3)) goals.push({ kind: pick(["in", "in", "on"]), item: pick(list).id, container: pick(list).id, label: pick(["", "L", undefined]) })
	return sceneOf(list, { goals, stage: randomStage(), seconds: pick([4.5, 2, 6, 10]), release: pick([0.5, 0, 1.25]) })
}

// ---------------------------------------------------------------- scene files
function sceneFiles() {
	const known = (t) => typeof t === "string" && hasOwn(items.TYPES, t)
	const out = []
	for (const dir of ["web/scenarios", "web/saved"]) {
		const d = path.join(PG, dir)
		if (!fs.existsSync(d)) continue
		for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json")).sort()) {
			let s
			try {
				s = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))
			} catch {
				continue
			}
			if (!s || !Array.isArray(s.items)) continue
			const kept = s.items.filter((i) => known(i.type))
			out.push({ name: `${dir}/${f}`, file: f, scene: { ...s, items: kept }, all: s.items.length, kept: kept.length, usesMech: kept.some((i) => MECH.includes(i.type)) })
		}
	}
	return out
}

// ---------------------------------------------------------------- the engine (for the summary cases), as web/server.py runs it
class Engine {
	constructor() {
		this.proc = spawn("node", ["--no-warnings", path.join(PG, "research/poc/worker.ts")], { cwd: PG, stdio: ["pipe", "pipe", "ignore"] })
		this.pending = new Map()
		this.n = 0
		readline.createInterface({ input: this.proc.stdout }).on("line", (line) => {
			const [id, what, raw] = [line.slice(0, line.indexOf("\t")), line.slice(line.indexOf("\t") + 1, line.indexOf("\t", line.indexOf("\t") + 1)), line.slice(line.indexOf("\t", line.indexOf("\t") + 1) + 1)]
			const p = this.pending.get(Number(id))
			if (!p) return
			this.pending.delete(Number(id))
			if (what === "error") p.reject(new Error(JSON.parse(raw)))
			else p.resolve(JSON.parse(raw))
		})
		this.proc.on("exit", () => {
			for (const p of this.pending.values()) p.reject(new Error("engine stopped"))
			this.pending.clear()
		})
	}

	run(doc) {
		return new Promise((resolve, reject) => {
			const id = ++this.n
			this.pending.set(id, { resolve, reject })
			this.proc.stdin.write(JSON.stringify({ id, doc, rate: 120 }) + "\n")
		})
	}

	stop() {
		this.proc.stdin.end()
		this.proc.kill()
	}
}

async function tracksFor(scenes, label) {
	const engines = Array.from({ length: WORKERS }, () => new Engine())
	const out = new Array(scenes.length)
	let next = 0
	let failed = 0
	await Promise.all(engines.map(async (eng) => {
		while (next < scenes.length) {
			const i = next++
			try {
				const { doc } = prepare(wire(scenes[i]))
				out[i] = await eng.run(JSON.parse(JSON.stringify(doc)))
			} catch (e) {
				failed++
				out[i] = null
				if (VERBOSE) console.log(`  engine refused ${label} ${i}: ${e.message}`)
			}
		}
	}))
	engines.forEach((e) => e.stop())
	if (failed) console.log(`  ${label}: the engine refused ${failed} of ${scenes.length} scenes (left out of the summary comparison)`)
	return out
}

// ---------------------------------------------------------------- groups
const stat = (res) => ({
	errors: res.filter((r) => r.py.error !== undefined).length,
	warns: res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0),
	solids: res.reduce((a, r) => a + (r.py.doc?.solids.length ?? 0), 0),
	joints: res.reduce((a, r) => a + (r.py.doc?.joints?.length ?? 0), 0)
})
const show = (s) => `${s.solids} solids and ${s.joints} joints built, ${s.errors} refused as a BadScene (same message), ${s.warns} overlap warnings`

const groups = {
	async registration() {
		note("registration", isDeepStrictEqual(MECH, PY_TYPES), "the types registered, in python's order", diff(MECH, PY_TYPES, "types"))
		// index.js, in a child process of its own: it must register catalog_mechanisms after the catalog modules that precede it in items.py's CATALOG_MODULES
		const code = `const m = await import(${JSON.stringify(`${SIM}/index.js`)}); const it = await import(${JSON.stringify(`${SIM}/items.js`)}); console.log(JSON.stringify({ modules: it.CATALOG_MODULES, types: Object.keys(m.TYPES), categories: m.CATEGORIES }))`
		let child = null
		try {
			child = JSON.parse(execFileSync("node", ["--no-warnings", "--input-type=module", "-e", code], { encoding: "utf8", cwd: PG, maxBuffer: 1 << 26 }))
		} catch (e) {
			note("registration", false, "index.js loads", [String(e.message).slice(0, 300)])
		}
		if (child) {
			const pyMods = ["catalog_items", "catalog_everyday", "catalog_mechanisms"]
			const order = pyMods.filter((m) => child.modules.includes(m))
			note("registration", child.modules.includes("catalog_mechanisms"), "index.js registers catalog_mechanisms", [`modules: ${child.modules.join(", ")}`])
			note("registration", isDeepStrictEqual(order, child.modules.filter((m) => pyMods.includes(m))), "index.js registers the catalog modules in CATALOG_MODULES' order", [`${child.modules.join(", ")}`])
			note("registration", PY_TYPES.every((k) => child.types.includes(k)), "index.js has every mechanisms type", [`missing ${PY_TYPES.filter((k) => !child.types.includes(k)).join(", ")}`])
			const at = child.types.indexOf(PY_TYPES[0])
			note("registration", isDeepStrictEqual(child.types.slice(at, at + PY_TYPES.length), PY_TYPES), "the mechanisms types follow each other in python's order", diff(child.types.slice(at, at + PY_TYPES.length), PY_TYPES))
			console.log(`  registration: index.js registers ${child.modules.join(", ")} (${child.types.length} types in all, ${child.categories.length} categories)`)
		}
		console.log(`  registration: ${MECH.length} types registered, python's catalog_mechanisms.py defines ${PY_TYPES.length}`)
	},

	async tables() {
		const n = checkTables(POST, true, "tables") // every material, measured pair and look: the same set and values as Python's "after" tables, which numbers are ints too
		const order = (what, a, b) => note("tables", isDeepStrictEqual(a, b), `${what} order`, diff(a, b, what))
		order("materials", Object.keys(MATERIALS), Object.keys(POST.materials))
		order("looks", Object.keys(items.LOOKS), Object.keys(POST.looks))
		order("categories", items.CATEGORIES, POST.categories)
		const mine = Object.keys(POST.materials).filter((k) => !hasOwn(PRE.materials, k))
		const own = Object.keys(POST.looks).filter((k) => !hasOwn(PRE.looks, k))
		console.log(`  tables: ${n} materials, measured pairs and looks compared (${mine.length} materials [${mine.join(", ")}] and ${own.length} looks [${own.join(", ")}] are catalog_mechanisms.py's own), ${POST.categories.length} categories: same set, same order`)
	},

	async catalog() {
		const py = askPython([{ id: "catalog", op: "catalog" }])[0].res
		const js = items.catalog()
		let ds = diff(js.categories, POST.categories, "categories")
		const pyMech = py.types.map((t) => t.key).filter((k) => MECH.includes(k))
		ds = ds.concat(diff(js.types.map((t) => t.key).filter((k) => MECH.includes(k)), pyMech, "mechanisms type order"))
		ds = ds.concat(diff(js.materials, py.materials, "materials"))
		ds = ds.concat(diff(js.looks, py.looks, "looks"))
		note("catalog", ds.length === 0, "catalog() categories, order, materials, looks", ds)
		let solids = 0
		for (const key of MECH) {
			const t = js.types.find((x) => x.key === key)
			const pt = py.types.find((x) => x.key === key)
			const d = t && pt ? diff(t, pt, `types[${key}]`) : [`types[${key}]: missing from ${pt ? "js" : "python"}`]
			note("catalog", d.length === 0, key, d)
			solids += t?.preview?.solids?.length ?? 0
			note("catalog", !t?.preview?.error, `${key} preview builds`, [t?.preview?.error])
		}
		for (const t of js.types.filter((x) => CORE.includes(x.key))) {
			const pt = py.types.find((x) => x.key === t.key)
			note("catalog", pt && diff(t, pt).length === 0, `core type ${t.key} (with the materials python's server has loaded)`, pt ? diff(t, pt, `types[${t.key}]`) : ["missing"])
		}
		console.log(`  catalog: ${MECH.length} mechanisms types compared with items.catalog() incl. their previews (${solids} solids), ${CORE.length} core types too; ${Object.keys(js.materials).length} materials, ${Object.keys(js.looks).length} looks, ${js.categories.length} categories`)
	},

	async types() {
		const reqs = typeCases(MECH)
		const res = compare("types", reqs)
		console.log(`  types: ${reqs.length} scenes of ${MECH.length} types alone (default, min, max, below, above, 20 random prop sets, held and fixed, materials and their edits); ${show(stat(res))}`)
	},

	async sweeps() {
		const reqs = sweepCases(MECH)
		const res = compare("sweeps", reqs)
		console.log(`  sweeps: ${reqs.length} scenes (every prop of every type in turn); ${show(stat(res))}`)
	},

	async corners() {
		const reqs = cornerCases(MECH)
		const res = compare("corners", reqs)
		console.log(`  corners: ${reqs.length} scenes with every prop at a min or a max; ${show(stat(res))}`)
	},

	async ties() {
		const reqs = tieCases(MECH)
		const res = compare("ties", reqs)
		console.log(`  ties: ${reqs.length} scenes with props and places at exact binary ties; ${show(stat(res))}`)
	},

	async angles() {
		const reqs = angleCases(MECH)
		const res = compare("angles", reqs)
		console.log(`  angles: ${reqs.length} scenes at round and tiny angles; ${show(stat(res))}`)
	},

	async tiebulk() {
		const R = Number(opt("bulk", QUICK ? 4 : 40))
		const types = MECH.filter((k) => k !== "hanging-chain")
		let n = 0
		const total = { errors: 0, warns: 0, solids: 0, joints: 0 }
		for (let rep = 0; rep < R; rep++) {
			const reqs = tieCases(types)
			n += reqs.length
			const st = stat(compare("tiebulk", reqs))
			for (const k of Object.keys(total)) total[k] += st[k]
		}
		console.log(`  tiebulk: ${n} scenes with props and places at exact binary ties (${R} rounds, every type but the hanging chain); ${show(total)}`)
	},

	async chainties() {
		const N = Number(opt("bulk", QUICK ? 2000 : 20000))
		const reqs = []
		for (let i = 0; i < N; i++) {
			const props = propValues("hanging-chain", "random")
			if (chance(0.6)) props.links = 2 * ri(3, 14) + 1 // odd: the middle link is centred on the symmetry axis
			const o = { id: "a", type: "hanging-chain", x: (2 * ri(-20, 150) + 1) / 64, y: chance(0.5) ? (2 * ri(0, 60) + 1) / 64 : dp(U(0, 1.5), 3), angle: pick([0, 0, 0, 180, 360, -180]), props, ...flagsOf() }
			reqs.push({ id: cid("chainties"), op: "layout", scene: sceneOf([o]) })
		}
		const res = compare("chainties", reqs, { raw: true, known: true })
		const k = known.chainties
		const x5 = res.filter((r) => !r.ok && diff(r.js, r.py, "", [], 100).every((d) => /^\.doc\.solids\[\d+\]\.at\.[xy]: /.test(d))).length
		console.log(`  chainties: ${N} hanging chains at odd multiples of 1/64; ${show(stat(res))}; NOT COUNTED: ${k.bad} differ (${x5} of them in nothing but the 5th decimal of one link's x or y, a tie that libm's last bit decides: Python's cannot be repeated)`)
	},

	async bulk() {
		const N = Number(opt("bulk", QUICK ? 2000 : 20000))
		const heavy = MECH.filter((k) => ["hanging-chain", "pulley-lift", "skateboard", "pinball-flipper", "rope-pendulum", "wrecking-ball", "swing", "spring-gate", "spring-catapult", "hanging-spring", "atwood-machine", "toy-car", "motor-car", "cart", "truck", "trampoline", "bicycle-wheel", "wheel"].includes(k))
		const total = { errors: 0, warns: 0, solids: 0, joints: 0 }
		for (let done = 0; done < N; done += 10000) {
			const reqs = []
			for (let i = done; i < Math.min(N, done + 10000); i++) {
				const type = pick(heavy)
				const o = itemOf("a", type, propValues(type, "random"), flagsOf())
				if (chance(0.5)) o.angle = chance(0.5) ? U(-360, 360) : dp(U(-180, 180), ri(0, 4))
				reqs.push({ id: cid(`bulk-${type}`), op: "layout", scene: sceneOf([o]) })
			}
			const st = stat(compare("bulk", reqs)) // (the answers are dropped after each batch of 10000)
			for (const k of Object.keys(total)) total[k] += st[k]
		}
		console.log(`  bulk: ${N} random single items of ${heavy.length} types that call libm; ${show(total)}`)
	},

	async random() {
		const N = QUICK ? 300 : 3000
		const reqs = []
		for (let i = 0; i < N; i++) reqs.push({ id: cid("random"), op: "layout", scene: mixedScene(ri(3, 8)) })
		const res = compare("random", reqs)
		console.log(`  random: ${N} scenes of 3-8 items (mechanisms and core types mixed); ${show(stat(res))}`)
	},

	async dense() {
		const reqs = []
		for (let i = 0; i < (QUICK ? 30 : 200); i++) reqs.push({ id: cid("dense"), op: "layout", scene: mixedScene(ri(10, 45), pick([0.05, 0.2, 0.6, 1.2])) })
		const res = compare("dense", reqs)
		console.log(`  dense: ${reqs.length} clusters of 10-45 items; ${show(stat(res))}`)
	},

	async clean() {
		// garbage in every prop slot of every mechanisms type, and the same cases through layout
		const garbage = () => pick([undefined, null, true, false, 0, 1, -1, 2.5, 1e30, "7", "x", "", [], {}, [1], { a: 1 }, "1e3", "-0", " 4 ", "nan", 0.5, 3.5, -2.5])
		const scenes = []
		for (const type of MECH) {
			for (let i = 0; i < (QUICK ? 6 : 30); i++) {
				const props = {}
				for (const p of items.TYPES[type].schema().props) if (chance(0.5)) props[p.key] = garbage()
				scenes.push({ items: [{ id: "g", type, x: garbage(), y: garbage(), angle: garbage(), held: garbage(), fixed: garbage(), name: garbage(), props }], seconds: garbage(), release: garbage() })
			}
			// a material that is not offered, a choice of the right kind, another type's prop
			scenes.push({ items: [{ id: "a", type, props: { material: "gold" } }] }, { items: [{ id: "a", type, props: { material: 5 } }] }, { items: [{ id: "a", type, props: { zzz: 1, color: "#ff0000" } }] })
			for (const m of items.TYPES[type].schema().props.find((p) => p.key === "material")?.choices ?? []) scenes.push({ items: [{ id: "a", type, props: { material: m } }] })
		}
		// a wrecking ball lists no bob_diameter, but an item may set one (clean() keeps a scalar it does not know): the builder reads it, as `"bob_diameter" in P`
		for (const v of [0, 0.05, 0.1, 0.3, 0.001, 1e-9, 1e-300, 5, -1, -0.05, true, false, "x", "0.05", "", "1e3", "٣", 1e15, 123456789.123, 0.0049999999, 0.01]) {
			for (const extra of [{}, { bob_mass: 0.2 }, { bob_mass: 30, length: 0.2 }, { material: "steel", start_angle: 170 }]) {
				scenes.push({ items: [{ id: "w", type: "wrecking-ball", x: 1, y: 1, props: { bob_diameter: v, ...extra } }] })
			}
		}
		const reqs = scenes.map((scene) => ({ id: cid("clean"), op: "clean", scene }))
		compare("clean", reqs)
		compare("clean via layout", reqs.map((r) => ({ ...r, id: `${r.id}-layout`, op: "layout" })))
		console.log(`  clean: ${reqs.length} garbage scenes for ${MECH.length} types, through clean() and through layout()`)
	},

	async scenarios() {
		const files = sceneFiles()
		const reqs = []
		for (const f of files) {
			if (!f.kept) continue
			reqs.push({ id: `scenario ${f.name}${f.kept < f.all ? ` (${f.kept} of ${f.all} items: the types web/sim has)` : ""}`, op: "layout", scene: f.scene })
			reqs.push({ id: `scenario ${f.name} clean`, op: "clean", scene: f.scene })
		}
		compare("scenarios", reqs)
		const using = files.filter((f) => f.usesMech)
		console.log(`  scenarios: ${files.length} scene files (web/scenarios, web/saved); ${using.length} use mechanisms types: ${using.map((f) => `${f.file} [${[...new Set(f.scene.items.filter((i) => MECH.includes(i.type)).map((i) => i.type))].join(", ")}]${f.kept < f.all ? ` (${f.kept} of ${f.all} items)` : ""}`).join("; ")}`)
	},

	async summary() {
		const scenes = []
		for (const f of sceneFiles()) if (f.kept) scenes.push({ id: `scenario ${f.name}`, scene: f.scene })
		// each type alone on a table (dropped where it stands), and random mixed scenes
		for (const type of MECH) {
			const t = items.TYPES[type]
			scenes.push({
				id: `alone-${type}`,
				scene: sceneOf([{ id: "table", type: "table", x: 1.3, y: 0, angle: 0 }, { id: "thing", type, x: 1.3, y: t.dynamic ? 0.9 : 0, angle: 0 }, { id: "ball", type: "superball", x: 1.1, y: 1.4, angle: 0 }], { seconds: 3, release: 0.3 })
			})
		}
		const N = QUICK ? 10 : 120
		for (let i = 0; i < N; i++) {
			const s = mixedScene(ri(3, 7))
			s.seconds = pick([1.5, 2.5, 3])
			s.release = pick([0.2, 0.5])
			scenes.push({ id: `summary-random-${i}`, scene: s })
		}
		const tracks = await tracksFor(scenes.map((x) => x.scene), "summary")
		const reqs = []
		scenes.forEach((x, i) => {
			if (tracks[i]) reqs.push({ id: x.id, op: "layout", scene: x.scene, track: tracks[i] })
		})
		const res = compare("summary", reqs)
		const sum = (f) => res.reduce((a, r) => a + f(r.py.summary), 0)
		const moved = sum((s) => s?.stories.filter((x) => x.moved_at !== null).length ?? 0)
		console.log(`  summary: ${reqs.length} tracks run on the engine; ${sum((s) => s?.stories.length ?? 0)} stories (${moved} moved), ${sum((s) => s?.events.length ?? 0)} events, ${sum((s) => s?.goals.length ?? 0)} goals compared`)
	},

	async live() {
		const base = process.env.PARITY_SERVER ?? "http://localhost:8790"
		let cat
		try {
			cat = await (await fetch(`${base}/api/catalog`)).json()
		} catch (e) {
			console.log(`  live: server at ${base} not reachable (${e.message}); skipped`)
			return
		}
		const py = askPython([{ id: "catalog", op: "catalog" }])[0].res
		const js = items.catalog()
		let stale = 0
		for (const key of MECH) {
			const t = js.types.find((x) => x.key === key)
			const st = cat.types.find((x) => x.key === key)
			const pt = py.types.find((x) => x.key === key)
			const d = st ? diff(t, st, `types[${key}]`) : ["missing from the server"]
			const fresh = st && !diff(st, pt).length // the server agrees with the python files as they are now
			if (d.length && !fresh) stale++
			note("live catalog (running server)", d.length === 0 || !fresh, key, d)
		}
		console.log(`  live: GET /api/catalog lists ${cat.types.length} types; the ${MECH.length} mechanisms ones ${stale ? `${stale} DIFFER because the server has not re-read machines/catalog_mechanisms.py since it changed (not counted; GET /api/catalog?reload=1)` : "match, previews included"}`)
		// /api/layout and /api/simulate: scenes through the running server
		const post = async (p, body) => {
			const r = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
			return { status: r.status, json: await r.json() }
		}
		const scenes = [...Array.from({ length: QUICK ? 20 : 120 }, () => mixedScene(ri(2, 6)))]
		for (const type of MECH) scenes.push(sceneOf([itemOf("a", type, {})]))
		let n = 0
		let notFresh = 0
		const pyAnswers = askPython(scenes.map((s) => ({ id: "l", op: "layout", scene: s })))
		for (const [i, sc] of scenes.entries()) {
			const { json: sv } = await post("/api/layout", { scene: sc })
			const mine = jsAnswer({ op: "layout", scene: sc })
			const d = diff(mine, sv)
			const fresh = !diff(sv, pyAnswers[i].res).length
			if (d.length && !fresh) notFresh++
			note("live /api/layout (running server)", d.length === 0 || !fresh, `layout ${++n}`, d, JSON.stringify(sc).slice(0, 300))
		}
		console.log(`  live: ${scenes.length} scenes through POST /api/layout: ${report["live /api/layout (running server)"].bad} differ${notFresh ? `, ${notFresh} more differ where the server is behind the python files (not counted)` : ""}`)
		const files = sceneFiles().filter((f) => f.kept && f.usesMech)
		const sims = [...files.map((f) => ({ name: f.name, scene: f.scene })), ...MECH.slice(0, QUICK ? 3 : MECH.length).map((type) => ({ name: `drop ${type}`, scene: sceneOf([{ id: "table", type: "table", x: 1.3, y: 0, angle: 0 }, { id: "thing", type, x: 1.3, y: items.TYPES[type].dynamic ? 0.9 : 0, angle: 0 }], { seconds: 2.5 }) }))]
		let ok = 0
		for (const f of sims) {
			const { status, json: sim } = await post("/api/simulate", { scene: f.scene })
			if (status !== 200) {
				note("live /api/simulate (running server)", false, f.name, [`HTTP ${status}: ${sim.error}`])
				continue
			}
			const { scene: cs, doc, resolved } = prepare(wire(f.scene))
			const out = { doc, resolved, warnings: items.overlaps(cs, doc), summary: items.summarize(cs, doc, with_statics(sim.track)) }
			const d = diff(out, { doc: sim.doc, resolved: sim.resolved, warnings: sim.warnings, summary: sim.summary })
			const pyAns = askPython([{ id: "s", op: "layout", scene: f.scene, track: sim.track }])[0].res
			const fresh = !diff({ doc: sim.doc, resolved: sim.resolved, warnings: sim.warnings, summary: sim.summary }, pyAns).length
			if (!d.length) ok++
			note("live /api/simulate (running server)", d.length === 0 || !fresh, f.name, d)
		}
		console.log(`  live: ${sims.length} scenes through POST /api/simulate (the scenarios with mechanisms in them, and each type dropped on a table): doc, resolved, warnings and the summary given the server's own track: ${ok} match`)
	}
}

// ---------------------------------------------------------------- run
async function main() {
	const t0 = Date.now()
	const v = askPython([{ id: "v", op: "version" }])[0].res
	console.log(`python ${v.python.split("|")[0].trim()} (${v.platform}); node ${process.version}; mechanisms; seed ${SEED}${QUICK ? "; quick" : ""}`)
	for (const f of ["machines/items.py", "machines/catalog_items.py", "machines/catalog_everyday.py", "machines/catalog_mechanisms.py", "web/server.py", "web/sim/catalog-mechanisms.js"]) {
		const st = fs.statSync(path.join(PG, f))
		console.log(`  ${f.padEnd(34)} ${st.size} bytes, modified ${st.mtime.toISOString().slice(0, 19)}`)
	}
	await loadModule()
	try {
		for (const g of GROUPS) {
			if (!groups[g]) throw new Error(`no group ${g}`)
			const t = Date.now()
			console.log(`[${g}]`)
			await groups[g]()
			if (VERBOSE) console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`)
		}
	} finally {
		if (EXPORT) {
			// (JSON would turn -0 into 0: keep the sign of zero the way browser-mechanisms.mjs reads it back)
			fs.writeFileSync(EXPORT, JSON.stringify({ pre: PRE, post: POST, types: MECH, cases: exported }, (_k, v) => (typeof v === "number" && Object.is(v, -0) ? { "@@float": "-0" } : v)))
			console.log(`exported ${exported.length} cases to ${EXPORT}`)
		}
	}
	console.log("\ngroup".padEnd(36) + "cases".padStart(8) + "mismatches".padStart(12))
	let total = 0
	let bad = 0
	for (const [g, r] of Object.entries(report)) {
		console.log(`${g.padEnd(35)}${String(r.cases).padStart(8)}${String(r.bad).padStart(12)}`)
		total += r.cases
		bad += r.bad
		for (const s of r.samples) console.log(`    ${s.id}\n      ${s.diffs.slice(0, 4).join("\n      ")}${s.detail ? "\n      input: " + s.detail : ""}`)
	}
	for (const [g, r] of Object.entries(known)) {
		console.log(`not counted: ${g.padEnd(23)}${String(r.cases).padStart(8)}${String(r.bad).padStart(12)}   (libm's last bit at an exact tie: see avoidChainTies)`)
		for (const x of r.samples.slice(0, 2)) console.log(`    ${x.id}\n      ${x.diffs.slice(0, 2).join("\n      ")}\n      input: ${x.detail.slice(0, 500)}`)
	}
	console.log(`${"total".padEnd(35)}${String(total).padStart(8)}${String(bad).padStart(12)}   (${((Date.now() - t0) / 1000).toFixed(0)} s)${python500 ? `; python answered ${python500} cases with a 500` : ""}`)
	process.exit(bad ? 1 : 0)
}
main().catch((e) => {
	console.error(e)
	process.exit(2)
})
