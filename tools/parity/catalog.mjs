// Parity harness for a ported catalog module: web/sim/catalog-items.js (or another catalog-*.js) against machines/catalog_items.py (or its sibling) as
// machines/items.py and web/server.py run it. The companion of core.mjs (which checks items.js, clean.js and layout.js, the core types); nothing here
// changes how core.mjs, py_dump.py or run.sh behave.
//
//   node tools/parity/catalog.mjs [--module catalog_items[,catalog_everyday,...]] [--seed N] [--quick] [--groups a,b,c] [--workers 2] [--verbose]
//                                 [--no-browser]
//
// The JS side is items.js + clean.js + layout.js with the named module(s) registered the way web/sim/index.js does it (use_catalog_module, in the
// order of items.py's CATALOG_MODULES). The Python side is py_dump_cat.py: items.py with exactly those catalog files real and the others replaced by
// empty stand-ins, so the two sides hold the same tables (the materials, looks and measured pairs of the core and of the named modules, and nothing
// the other modules add). "Types of the module" below means the keys the named modules register (TYPES after minus before).
// Every case is JSON for Python and a call here; the answers are compared number against number (Object.is: the sign of a zero counts), key
// order included, as in core.mjs.
//   registration  index.js registers the module (its place among CATALOG_MODULES, its types in python's order) - a child node, not this process
//   tables        MATERIALS (and which numbers are ints), measured pairs, looks: web/sim holds what python does, nothing more, nothing less
//   catalog       catalog(): every type's JSON incl. its preview (the picture of the card), the order, the materials, the looks, the categories
//   types         each type alone: default, min, max, below min, above max, 20 random prop sets, every material, a material's numbers edited
//   materials     every pair of materials the module's types offer (the contacts list: measured pairs, the mixing rule, an item's own edits)
//   random        random scenes of 3-8 items from the core and the module's types (clusters, goals, held and fixed): doc, resolved, warnings
//   dense         dense clusters of them against python's overlap warnings (polygons, tapers, balls inside slabs)
//   angles        every type at round angles (multiples of 30, 45, 90 degrees and whole degrees: where sin/cos land on a rounding tie), round props
//   ties          the same at every multiple of 30 degrees with props of 4 and 5 decimals (half of one is an exact tie for round(x, 5)) and angle props at
//                 multiples of 30: where the last bit of cos(+-120 deg) and the like could flip a rounded number
//   pow           the steel weights' side, (mass / 8000) ** (1 / 3), at thousands of masses: a raw float in the document (not rounded), so every bit counts
//   clean         garbage in every prop slot of every type: the 400 message or the cleaned scene, and the same through layout
//   scenarios     web/scenarios/*.json as saved (types the sim does not have are left out by clean() on both sides)
//   summary       the engine's tracks (research/poc/worker.ts, as web/server.py runs it) for the scenarios and random scenes: summarize() given the track
//   live          the running server read-only: GET /api/catalog, POST /api/layout, POST /api/simulate (its own track and summary). A difference is
//                 classified: real / the other catalog modules (python with every module agrees with the server, not with this side) / server stale
//                 (the server's own answer is not what python gives now: its modules were loaded before a file changed)
//   browser       the same cases in headless Chromium (never a visible window): web/sim as a page loads it, over HTTP from a throwaway server here
import { execFileSync, spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = path.resolve(HERE, "../..")
const SIM_DIR = path.resolve(process.env.PARITY_SIM || path.join(PG, "web/sim"))
const SIM = pathToFileURL(SIM_DIR).href
const args = process.argv.slice(2)
const opt = (name, dflt) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt)
const MODULES = opt("module", "catalog_items").split(",").filter(Boolean)
const SEED = Number(opt("seed", 20241015))
const QUICK = args.includes("--quick")
const VERBOSE = args.includes("--verbose")
const WORKERS = Number(opt("workers", 2))
const GROUPS = opt("groups", `registration,tables,catalog,types,materials,random,dense,angles,ties,pow,clean,scenarios,summary,live${args.includes("--no-browser") ? "" : ",browser"}`).split(",")
const fileOf = (m) => `${m.replaceAll("_", "-")}.js`

const { BadScene, clean } = await import(`${SIM}/clean.js`)
const items = await import(`${SIM}/items.js`)
const { layout, prepare, with_statics, finish } = await import(`${SIM}/layout.js`)
const { ValueError, ZeroDivisionError, hasOwn } = await import(`${SIM}/pymath.js`)
const { MATERIALS, MATERIAL_INTS, MEASURED, pairKey } = await import(`${SIM}/materials.js`)
const CORE = Object.keys(items.TYPES)
for (const m of MODULES) items.use_catalog_module(m, (await import(`${SIM}/${fileOf(m)}`)).register_all)
const NEW = Object.keys(items.TYPES).filter((k) => !CORE.includes(k))
const ALL = [...CORE, ...NEW]
const CONTAINERS = ALL.filter((t) => ["box", "cup", "bucket", "basket"].includes(t))
const BALLS = ALL.filter((t) => items.TYPES[t].category === "Balls")
const STAGE = { x0: -0.55908203125, x1: 3.19091796875, y0: -0.15625, y1: 2.34375 }
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "parity-cat-"))

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
const toPython = (r) => JSON.stringify(r, (_k, v) => (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "@@float" in v ? null : v))
/** real = "all": py_dump.py as the server has everything; else py_dump_cat.py with those modules real (default: the ones under test). */
function askPython(requests, real = MODULES.join(",")) {
	const argv = real === "all" ? ["-I", path.join(HERE, "py_dump.py"), "--mode", "server"] : ["-I", path.join(HERE, "py_dump_cat.py"), "--real", real]
	const out = []
	const B = 150
	for (let i = 0; i < requests.length; i += B) {
		const chunk = requests.slice(i, i + B)
		const res = execFileSync(PYTHON, argv, { input: chunk.map(toPython).join("\n") + "\n", maxBuffer: 1 << 30, encoding: "utf8", cwd: PG })
		const lines = res.split("\n").filter((l) => l.trim())
		if (lines.length !== chunk.length) throw new Error(`python answered ${lines.length} of ${chunk.length}`)
		for (const l of lines) out.push(JSON.parse(l))
	}
	return out
}

// ---------------------------------------------------------------- comparing
const isObj = (v) => v !== null && typeof v === "object"
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
const info = [] // lines printed after the table (things that are not mismatches)
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
const wire = (v) => (v === undefined ? undefined : revive(JSON.parse(JSON.stringify(v)))) // what Python was sent

function jsAnswer(req) {
	const scene = wire(req.scene)
	try {
		if (req.op === "clean") return { ok: clean(scene) }
		const { scene: s, doc, resolved } = prepare(scene)
		const out = { doc, resolved, warnings: items.overlaps(s, doc) }
		if (req.track != null) out.summary = items.summarize(s, doc, with_statics(req.track))
		return out
	} catch (e) {
		if (e instanceof BadScene) return { error: e.message }
		return { error500: `${e.name}: ${e.message}` }
	}
}

const exported = [] // cases for the browser group: {group, req, py}
const EXPORT_CAP = { types: 500, random: 500, dense: 60, angles: 400, clean: 300, scenarios: 40 }
/** Runs the requests on both sides and notes every comparison under `group`. Returns [{req, py, js, ok}]. */
function compare(group, requests, { loose500 = true } = {}) {
	const py = askPython(requests)
	return requests.map((req, i) => {
		const p = py[i].res
		let j
		try {
			j = jsAnswer(req)
		} catch (e) {
			j = { harness_error: `${e.name}: ${e.message}\n${e.stack}` }
		}
		let diffs
		if (p.harness_error) diffs = [`python harness: ${p.harness_error}`]
		else if (loose500 && p.error500 !== undefined) {
			// (a 500 is the server's crash page: any error will do, except the one scenes can really cause, a prop of the wrong type, whose text must match)
			const same = j.error500 !== undefined && (!p.error500.startsWith("TypeError: unsupported operand") || p.error500 === j.error500)
			diffs = same ? [] : [`python error500 ${p.error500} but js ${JSON.stringify(j).slice(0, 100)}`]
		} else diffs = diff(j, p)
		note(group, diffs.length === 0, req.id, diffs, JSON.stringify(req.scene)?.slice(0, 400))
		if (req.track == null && exported.filter((e) => e.group === group).length < (EXPORT_CAP[group] ?? 0)) exported.push({ group, req: JSON.parse(JSON.stringify(req)), py: p })
		return { req, py: p, js: j, ok: diffs.length === 0 }
	})
}

// ---------------------------------------------------------------- cases
let caseNo = 0
const cid = (g) => `${g}-${++caseNo}`

function propValues(type, mode) {
	const props = {}
	for (const p of items.TYPES[type].schema().props) {
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

/** A random scene of n items from `pool` (the core's and the module's types), in a cluster or spread out, with goals. */
function randomScene(n, pool = ALL, { cluster = chance(0.5), spread = 0.4 } = {}) {
	const list = []
	const cx = U(0.2, 2.8)
	const cy = U(0.05, 0.9)
	if (chance(0.6)) list.push({ id: "table", type: "table", x: 1.3, y: 0, props: chance(0.5) ? {} : propValues("table", "random") })
	while (list.length < n) {
		const type = pick(pool)
		const id = chance(0.1) ? pick(["Ball 1", "x", "a b", "é", "10", "2", "constructor", "__proto__"]) + list.length : `i${list.length}`
		const o = itemOf(id, type, propValues(type, "random"), chance(0.2) ? { held: chance(0.7) } : chance(0.1) ? { fixed: true } : {})
		if (cluster) {
			o.x = dp(cx + U(-spread, spread), ri(2, 6))
			o.y = dp(cy + U(-spread / 4, spread), ri(2, 6))
			if (chance(0.3)) o.angle = pick([0, 90, 45, 30, -30, 180, ri(-180, 180)])
		}
		if (chance(0.3)) o.name = pick(["Ball", "Dominoes", "the thing", "", "ss", "boss", "Bats"])
		list.push(o)
	}
	const goals = []
	const ball = list.find((i) => BALLS.includes(i.type))
	const box = list.find((i) => CONTAINERS.includes(i.type))
	if (ball && box) goals.push({ kind: "in", item: ball.id, container: box.id, label: chance(0.5) ? "Land it" : "" })
	// other goals: any item in any item (only boxes, cups, buckets and baskets can hold), a kind that is not "in", an item that is not there
	if (chance(0.3)) goals.push({ kind: pick(["in", "in", "on"]), item: pick(list).id, container: pick(list).id, label: pick(["", "L", undefined]) })
	if (chance(0.1)) goals.push({ kind: "in", item: "ghost", container: pick(list).id })
	return sceneOf(list, { goals, stage: randomStage(), seconds: pick([4.5, 2, 6, 10]), release: pick([0.5, 0, 1.25]) })
}

// ---------------------------------------------------------------- the engine (for the summary cases), as web/server.py runs it
class Engine {
	constructor() {
		this.proc = spawn("node", ["--no-warnings", path.join(PG, "research/poc/worker.ts")], { cwd: PG, stdio: ["pipe", "pipe", "ignore"] })
		this.pending = new Map()
		this.n = 0
		readline.createInterface({ input: this.proc.stdout }).on("line", (line) => {
			const t1 = line.indexOf("\t")
			const t2 = line.indexOf("\t", t1 + 1)
			const p = this.pending.get(Number(line.slice(0, t1)))
			if (!p) return
			this.pending.delete(Number(line.slice(0, t1)))
			if (line.slice(t1 + 1, t2) === "error") p.reject(new Error(JSON.parse(line.slice(t2 + 1))))
			else p.resolve(JSON.parse(line.slice(t2 + 1)))
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

const sceneFiles = () => fs.readdirSync(path.join(PG, "web/scenarios")).filter((f) => f.endsWith(".json")).sort()
const readScene = (f) => JSON.parse(fs.readFileSync(path.join(PG, "web/scenarios", f), "utf8"))

// ---------------------------------------------------------------- groups
const groups = {
	async registration() {
		// web/sim/index.js in a child node (this process has registered the module by hand): is it there, and in items.py's order?
		const itemsPy = fs.readFileSync(path.join(PG, "machines/items.py"), "utf8")
		const pyModules = [...itemsPy.match(/CATALOG_MODULES\s*=\s*\(([^)]*)\)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
		const code = `const items = await import(${JSON.stringify(`${SIM}/items.js`)}); const m = await import(${JSON.stringify(`${SIM}/index.js`)});` +
			"process.stdout.write(JSON.stringify({modules: items.CATALOG_MODULES, types: Object.keys(m.TYPES), listed: m.catalog().types.map((t) => t.key)}))"
		const child = JSON.parse(execFileSync("node", ["--no-warnings", "--input-type=module", "-e", code], { cwd: PG, encoding: "utf8" }))
		const sub = (list, of) => {
			let k = -1
			return list.every((x) => (k = of.indexOf(x, k + 1)) >= 0)
		}
		for (const m of MODULES) note("registration", child.modules.includes(m), `index.js registers ${m}`, [`its modules: ${child.modules.join(", ")}`])
		note("registration", sub(child.modules, pyModules), "index.js's modules are in items.py's order", [`js ${child.modules.join(", ")} vs python ${pyModules.join(", ")}`])
		const pyTypes = askPython([{ id: "tables", op: "tables" }], "all")[0].res.types
		note("registration", sub(child.types, pyTypes), "index.js's types are a subsequence of the server's, in its order", [`js ${child.types.join(",")}`])
		for (const t of NEW) note("registration", child.types.includes(t) && child.listed.includes(t), `index.js has type ${t}`, ["missing from TYPES or catalog()"])
		const at = child.types.indexOf(NEW[0])
		note("registration", NEW.every((t, k) => child.types[at + k] === t), "the module's types are one run in index.js's TYPES, in registration order", [`${child.types.slice(at, at + NEW.length).join(",")}`])
		console.log(`  registration: index.js registers ${child.modules.join(", ")} (items.py: ${pyModules.join(", ")}); ${child.types.length} types in all, ${NEW.length} of them ${MODULES.join("+")}'s`)
	},

	async tables() {
		const t = askPython([{ id: "tables", op: "tables" }])[0].res
		const js = { materials: { ...MATERIALS }, pairs: Object.fromEntries(MEASURED), looks: items.LOOKS }
		const pyMaterials = Object.fromEntries(Object.entries(t.materials).map(([k, d]) => [k, Object.fromEntries(Object.entries(d).filter(([kk]) => kk !== "_ints"))]))
		const pyPairs = Object.fromEntries(t.measured.map(([pair, kw]) => [pairKey(pair[0], pair[pair.length - 1]), kw]))
		for (const [name, vals] of Object.entries(js.materials)) {
			let d = hasOwn(pyMaterials, name) ? diff(vals, pyMaterials[name]) : ["not in python"]
			if (!d.length) d = diff([...(MATERIAL_INTS.get(name) ?? [])].sort(), t.materials[name]._ints, "which numbers are ints")
			note("tables", d.length === 0, `material ${name}`, d)
		}
		for (const [key, kw] of Object.entries(js.pairs)) note("tables", hasOwn(pyPairs, key) && !diff(kw, pyPairs[key]).length, `measured ${key.replace("\u0000", " + ")}`, hasOwn(pyPairs, key) ? diff(kw, pyPairs[key]) : ["not in python"])
		for (const [name, look] of Object.entries(js.looks)) note("tables", hasOwn(t.looks, name) && !diff(look, t.looks[name]).length, `look ${name}`, hasOwn(t.looks, name) ? diff(look, t.looks[name]) : ["not in python"])
		for (const name of Object.keys(pyMaterials)) if (!hasOwn(js.materials, name)) note("tables", false, `material ${name}`, ["only in python"])
		for (const key of Object.keys(pyPairs)) if (!hasOwn(js.pairs, key)) note("tables", false, `measured ${key.replace("\u0000", " + ")}`, ["only in python"])
		for (const name of Object.keys(t.looks)) if (!hasOwn(js.looks, name)) note("tables", false, `look ${name}`, ["only in python"])
		note("tables", diff(Object.keys(items.TYPES), t.types.filter((k) => k !== "probe")).length === 0, "types, in order", diff(Object.keys(items.TYPES), t.types.filter((k) => k !== "probe")))
		console.log(`  tables: ${Object.keys(js.materials).length} materials (${Object.keys(js.materials).length - 6} of them the module's), ${Object.keys(js.pairs).length} measured pairs, ${Object.keys(js.looks).length} looks; web/sim holds what python does, nothing more`)
	},

	async catalog() {
		const py = askPython([{ id: "catalog", op: "catalog" }])[0].res
		py.types = py.types.filter((t) => t.key !== "probe") // (py_dump.py registers a test type)
		const js = items.catalog()
		let ds = diff(js.categories, py.categories, "categories")
		const order = diff(js.types.map((t) => t.key), py.types.map((t) => t.key), "type order")
		ds = ds.concat(order, diff(js.materials, py.materials, "materials"), diff(js.looks, py.looks, "looks"))
		note("catalog", ds.length === 0, "catalog() as a whole", ds)
		let solids = 0
		for (const t of js.types) {
			const pt = py.types.find((x) => x.key === t.key)
			const d = pt ? diff(t, pt, `types[${t.key}]`) : [`types[${t.key}]: missing from python`]
			note("catalog types", d.length === 0, `${t.key}${NEW.includes(t.key) ? "" : " (core)"}`, d)
			solids += t.preview.solids.length
		}
		const bad = js.types.filter((t) => t.preview.error)
		note("catalog types", bad.length === 0, "no type's preview failed to build", bad.map((t) => `${t.key}: ${t.preview.error}`))
		console.log(`  catalog: ${js.types.length} types (${NEW.length} the module's) with their previews (${solids} solids), ${Object.keys(js.materials).length} materials, ${Object.keys(js.looks).length} looks, categories`)
	},

	async types() {
		const reqs = []
		for (const type of NEW) {
			const modes = ["default", "min", "max", "below", "above", ...Array(20).fill("random")]
			for (const mode of modes) {
				reqs.push({ id: cid(`type-${type}-${mode}`), op: "layout", scene: sceneOf([itemOf("a", type, propValues(type, mode), flagsOf())]) })
			}
			reqs.push({ id: cid(`type-${type}-origin`), op: "layout", scene: sceneOf([{ id: "a", type, x: 0, y: 0, angle: 0 }]) }) // (as a catalog card builds it)
			const t = items.TYPES[type].schema()
			const mat = t.props.find((p) => p.key === "material")
			if (mat) {
				for (const m of mat.choices) {
					reqs.push({ id: cid(`type-${type}-mat-${m}`), op: "layout", scene: sceneOf([itemOf("a", type, { material: m })]) })
					reqs.push({ id: cid(`type-${type}-mat-${m}-edit`), op: "layout", scene: sceneOf([itemOf("a", type, { material: m, friction: dp(U(0, 2), 3), bounce: dp(U(0, 1), 2) })]) })
				}
				// a material's own numbers edited: a hair from the material's (the name stays the base's), far from it (a hashed name), magnitudes that print differently
				for (const k of ["bounce", "friction", "rolling", "side"]) {
					const p = t.props.find((q) => q.key === k)
					reqs.push({ id: cid(`type-${type}-${k}-edit`), op: "layout", scene: sceneOf([itemOf("a", type, { [k]: pick([p.min, p.max, dp(U(p.min, p.max), 3), p.default, dp(p.default * 1.0000000001, 12)]) })]) })
					for (const v of [1e-5, 1.5e-7, 1e-20, 0.30000000000000004, 0.9999999999999999, p.default * (1 + 1e-12), p.default * (1 - 1e-9), 0]) {
						reqs.push({ id: cid(`type-${type}-${k}-${v}`), op: "layout", scene: sceneOf([itemOf("a", type, { [k]: v })]) })
					}
				}
			}
		}
		const res = compare("types", reqs)
		const warned = res.filter((r) => r.py.warnings?.length).length
		console.log(`  types: ${reqs.length} scenes of one item (${NEW.length} types: default, min, max, below, above, 20 random, every material, material numbers edited); ${warned} start with an overlap warning`)
	},

	async materials() {
		// every material the types offer, met with every other: the contacts list (measured pairs, the mixing rule, an item's own bounce/friction scaling a pair)
		const offers = new Map() // material -> a (type, props) that builds with it
		for (const type of ALL) {
			const mat = items.TYPES[type].schema().props.find((p) => p.key === "material")
			if (mat) for (const m of mat.choices) if (!offers.has(m) || (NEW.includes(type) && !NEW.includes(offers.get(m).type))) offers.set(m, { type, material: m })
		}
		const mats = [...offers.values()]
		const at = (c, k, extra = {}) => ({ id: `i${k}`, type: c.type, x: 0.2 * k, y: 0.1 * (k % 5), angle: 0, props: { material: c.material, ...extra } })
		const reqs = [{ id: cid("materials-all"), op: "layout", scene: sceneOf(mats.map((c, k) => at(c, k))) }]
		for (let i = 0; i < mats.length; i++) for (let j = i; j < mats.length; j++) reqs.push({ id: cid(`materials-${mats[i].material}-${mats[j].material}`), op: "layout", scene: sceneOf([at(mats[i], 0), at(mats[j], 1)]) })
		// each material with its own numbers moved, among the others (an item's bounce/friction/rolling/side scales a measured pair and changes a mixed one)
		for (const c of mats) {
			for (const k of ["bounce", "friction", "rolling", "side"]) {
				const p = items.TYPES[c.type].schema().props.find((q) => q.key === k)
				for (const v of [p.min, p.max, dp(U(p.min, p.max), 3), p.default * 0.5, p.default * 1.0000000001, 0]) {
					const others = mats.filter(() => chance(0.25))
					reqs.push({ id: cid(`materials-edit-${c.material}-${k}`), op: "layout", scene: sceneOf([...others.map((o, j) => at(o, j)), at(c, 9, { [k]: v })]) })
				}
			}
		}
		const res = compare("materials", reqs)
		const pairs = new Set(res.flatMap((r) => (r.py.doc?.contacts ?? []).map((c) => c.between.join(" | "))))
		const measuredPairs = res.reduce((s, r) => s + (r.py.doc?.contacts.filter((c) => !/^Mixed/.test(c.source ?? "")).length ?? 0), 0)
		console.log(`  materials: ${mats.length} materials, ${reqs.length} scenes; ${pairs.size} distinct material pairs, ${measuredPairs} measured contacts among them`)
	},

	async random() {
		const N = QUICK ? 300 : 3000
		const reqs = []
		for (let i = 0; i < N; i++) reqs.push({ id: cid("random"), op: "layout", scene: randomScene(ri(3, 8), chance(0.3) ? NEW : ALL) })
		const res = compare("random", reqs)
		const w = res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0)
		const used = new Set(res.flatMap((r) => (r.req.scene.items ?? []).map((i) => i.type)))
		console.log(`  random: ${N} scenes of 3-8 items from the core and the module's types (${[...used].filter((t) => NEW.includes(t)).length} of ${NEW.length} types appear), ${w} overlap warnings among them`)
	},

	async dense() {
		const reqs = []
		for (let i = 0; i < (QUICK ? 40 : 250); i++) reqs.push({ id: cid("dense"), op: "layout", scene: randomScene(ri(8, 40), chance(0.6) ? NEW : ALL, { cluster: true, spread: pick([0.05, 0.2, 0.6]) }) })
		const res = compare("dense", reqs)
		console.log(`  dense: ${reqs.length} scenes of 8-40 items in clusters against python's overlap warnings (${res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0)} warnings)`)
	},

	async angles() {
		// sin/cos: JavaScript's differ from the C library's in the last bit for a few percent of arguments; it shows only where a position lands exactly on a
		// rounding tie by construction (round numbers at round angles). Every type at multiples of 30 and 45 degrees and whole degrees, with its own angle
		// props (a pendulum's start angle, a lever's tilt) at round values too.
		const angles = [...Array.from({ length: 49 }, (_, i) => (i - 24) * 30), ...Array.from({ length: 33 }, (_, i) => (i - 16) * 45), ...Array.from({ length: 40 }, () => ri(-720, 720)), 12.452, 1e-9, 89.999999]
		const reqs = []
		for (const type of NEW) {
			const deg = items.TYPES[type].schema().props.filter((p) => p.unit === "°")
			const pool = QUICK ? angles.filter(() => chance(0.25)) : angles
			for (const a of pool) {
				const props = chance(0.5) ? propValues(type, "random") : {}
				for (const p of deg) if (chance(0.7)) props[p.key] = Math.min(p.max, Math.max(p.min, pick([0, 30, -30, 45, -45, 60, 90, -90, 120, 150, 170, -170, 15, 75, ri(-5, 5) * 30])))
				reqs.push({ id: cid(`angle-${type}`), op: "layout", scene: sceneOf([{ id: "a", type, x: pick([0, 1.3, 0.5, -0.52, 3.12, 0.00001, 0.123455, 2.5, 0.015625]), y: pick([0, 0.5, 0.7, 0.00001, 1.0, 0.015625]), angle: a, props }]) })
			}
		}
		compare("angles", reqs)
		console.log(`  angles: ${reqs.length} scenes at round angles and round angle props`)
	},

	async ties() {
		// Where JavaScript's sin/cos could show: an item at a multiple of 30 degrees (sin/cos are 0, +-1/2, +-sqrt(3)/2, +-1) holding parts whose offsets
		// have 5 decimals (or a half of one: 6 decimals ending in 5), so that a position lands exactly on a rounding tie by construction. Every numeric prop
		// gets 4 or 5 decimals, the angle props (a pendulum's start angle, a lever's tilt, a gate's) multiples of 30, the item sits at round places.
		// web/sim/trig.js holds the sin/cos of the multiples of 30 degrees that both sides use (pymath.js, and the builders through machines/crmath.py);
		// V8's own differ from it in the last bit at some (cos(+-120), sin(+-240), ...: found here by comparing); those "hard" angles get many more
		// scenes, and a pendulum and a gate hang at them with lengths whose quarter is a tie.
		const { TRIG30_SIN, TRIG30_COS, TRIG30_RANGE } = await import(`${SIM}/trig.js`)
		const D2R = Math.PI / 180
		const hard = []
		for (let d = -TRIG30_RANGE; d <= TRIG30_RANGE; d += 30) {
			const i = d / 30 + TRIG30_RANGE / 30
			if (Math.sin(d * D2R) !== TRIG30_SIN[i] || Math.cos(d * D2R) !== TRIG30_COS[i]) hard.push(d)
		}
		const reqs = []
		const mult30 = Array.from({ length: 49 }, (_, i) => (i - 24) * 30)
		const fiveDecimals = (type) => {
			const props = {}
			for (const p of items.TYPES[type].schema().props) {
				if (["material", "bounce", "friction", "rolling", "side"].includes(p.key)) continue
				if (p.kind === "number") props[p.key] = p.unit === "°" ? Math.min(p.max, Math.max(p.min, pick([0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 15, ri(-5, 5) * 30]))) : dp(U(p.min, Math.min(p.max, p.min * 40 + 0.3)), pick([4, 5, 5, 5]))
				else if (p.kind === "int") props[p.key] = ri(p.min, Math.min(p.max, 9))
				else if (p.kind === "bool" && chance(0.5)) props[p.key] = chance(0.5)
			}
			return props
		}
		const at = () => ({ x: pick([0, 0.5, 1, 1.25, 2, -0.5, 1.3, 0.015625]), y: pick([0, 0, 0.5, 1, 0.25, 0.7]) })
		for (const type of NEW) {
			for (const a of QUICK ? mult30.filter((_, i) => i % 4 === 0) : mult30) {
				for (let rep = 0; rep < (QUICK ? 1 : 3); rep++) reqs.push({ id: cid(`tie-${type}`), op: "layout", scene: sceneOf([{ id: "a", type, ...at(), angle: a, props: fiveDecimals(type) }]) })
			}
			for (const a of hard) for (let rep = 0; rep < (QUICK ? 1 : 6); rep++) reqs.push({ id: cid(`tie-hard-${type}`), op: "layout", scene: sceneOf([{ id: "a", type, ...at(), angle: a, props: fiveDecimals(type) }]) })
		}
		for (const type of ["pendulum", "hinged-gate"].filter((t) => NEW.includes(t))) {
			const len = items.TYPES[type].schema().props.find((p) => p.key === "length")
			for (let k = 0; k < (QUICK ? 40 : 400); k++) {
				const L = dp((4 * ri(Math.ceil(len.min * 25000), Math.floor(len.max * 25000)) + 2) / 1e5, 5) // a quarter of it ends in 5 at the sixth decimal
				reqs.push({ id: cid(`tie-hang-${type}`), op: "layout", scene: sceneOf([{ id: "a", type, x: pick([0, 0.5, 1]), y: pick([0, 0, 0.5]), angle: pick([0, 0, 0, ...hard]), props: { length: L, start_angle: pick([120, -120]), thickness: dp(U(0.003, 0.1), 5) } }]) })
			}
		}
		const res = compare("ties", reqs)
		console.log(`  ties: ${reqs.length} scenes at multiples of 30 degrees with 4 and 5 decimal props and angle props at multiples of 30 (${hard.length} hard angles: ${hard.slice(0, 6).join(", ")}...)`)
		void res
	},

	async pow() {
		// c.slab("weight", s, s, s): s = (mass / 8000) ** (1 / 3) goes into the document as it is (the depth), so the pow must be the same to the last bit
		const weights = ALL.filter((t) => /^steel-weight/.test(t))
		const reqs = []
		for (const type of weights) {
			const m = items.TYPES[type].schema().props.find((p) => p.key === "mass")
			for (let k = 0; k < (QUICK ? 300 : 3000); k++) {
				const mass = k < 6 ? [m.min, m.max, m.default, 0.1, 50, 0.7][k] : chance(0.5) ? U(m.min, m.max) : chance(0.5) ? logU(m.min, m.max) : dp(U(m.min, m.max), ri(1, 6))
				reqs.push({ id: cid(`pow-${type}`), op: "layout", scene: sceneOf([{ id: "a", type, x: 1, y: 0.5, angle: 0, props: { mass } }]) })
			}
		}
		for (let k = 0; k < (QUICK ? 200 : 2000); k++) {
			// a pendulum's bob: its density is mass / (4/3 pi r**3), r ** 3 by the same pow
			if (NEW.includes("pendulum")) reqs.push({ id: cid("pow-pendulum"), op: "layout", scene: sceneOf([{ id: "a", type: "pendulum", x: 1, y: 1, angle: 0, props: { bob_mass: logU(0.01, 10), bob_diameter: logU(0.01, 0.3), length: U(0.1, 2) } }]) })
		}
		compare("pow", reqs)
		console.log(`  pow: ${reqs.length} scenes (steel weights at random masses, pendulum bobs at random sizes and weights)`)
	},

	async clean() {
		const garbage = () => pick([undefined, null, true, false, 0, 1, -1, 2.5, 1e30, "7", "x", "", [], {}, [1], { a: 1 }, "1e3", "-0", " 4 ", "nan", "0.05", 1e-9, -1e30])
		const reqs = []
		for (const type of NEW) {
			for (let i = 0; i < (QUICK ? 4 : 14); i++) {
				const props = {}
				for (const p of items.TYPES[type].schema().props) if (chance(0.5)) props[p.key] = garbage()
				reqs.push({ items: [{ id: "g", type, x: garbage(), y: garbage(), angle: garbage(), held: garbage(), fixed: garbage(), name: garbage(), props }], seconds: garbage(), release: garbage() })
			}
			// a choice that is not offered, a number as text, a bool as text, a prop the type does not list
			const mat = items.TYPES[type].schema().props.find((p) => p.key === "material")
			if (mat) for (const m of ["gold", "", mat.choices[0] + "!", 5, ["steel"]]) reqs.push({ items: [{ id: "g", type, props: { material: m } }] })
			for (const p of items.TYPES[type].schema().props.slice(0, 4)) for (const v of ["abc", "2.5", "1_0", "inf", "nan", " 3 ", "yes", "TRUE", true, null, [3], 1e999]) reqs.push({ items: [{ id: "g", type, props: { [p.key]: v } }] })
			reqs.push({ items: [{ id: "g", type, props: { color: "#ff0000", zzz: 1.5, yyy: "s" } }] })
		}
		const list = reqs.map((scene) => ({ id: cid("clean"), op: "clean", scene }))
		compare("clean", list, { loose500: false })
		compare("clean via layout", list.map((r) => ({ ...r, id: `${r.id}-layout`, op: "layout" })))
		console.log(`  clean: ${list.length} scenes with garbage in the props of the module's types: the cleaned scene or the 400 message, and the same through layout`)
	},

	async scenarios() {
		const reqs = []
		for (const f of sceneFiles()) {
			const s = readScene(f)
			const unknown = [...new Set(s.items.map((i) => i.type).filter((t) => !items.TYPES[t]))]
			const ours = [...new Set(s.items.map((i) => i.type).filter((t) => NEW.includes(t)))]
			if (ours.length) console.log(`  ${f}: uses ${ours.join(", ")}${unknown.length ? `; left out by clean() on both sides: ${unknown.join(", ")}` : ""}`)
			reqs.push({ id: `scenario-${f}`, op: "layout", scene: s }, { id: `scenario-${f}-clean`, op: "clean", scene: s })
		}
		compare("scenarios", reqs)
	},

	async summary() {
		const scenes = []
		for (const f of sceneFiles()) scenes.push({ id: `scenario-${f}`, scene: readScene(f) })
		for (let i = 0; i < (QUICK ? 15 : 300); i++) {
			const s = randomScene(ri(3, 7), chance(0.5) ? NEW : ALL)
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
		console.log(`  summary: ${reqs.length} tracks run on the engine; ${sum((s) => s?.stories.length ?? 0)} stories, ${sum((s) => s?.events.length ?? 0)} events, ${sum((s) => s?.goals.length ?? 0)} goals (${sum((s) => s?.goals.filter((g) => g.ok).length ?? 0)} met) compared`)
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
		// What python gives now with every catalog module (the server's own state, if it were restarted), to tell a stale server from a difference of
		// ours: for an answer of the server that differs from ours, "stale" = python-now differs from the server's answer too (its modules were loaded
		// before a file changed), "other modules" = python-now agrees with the server and ours agrees with python holding only our module (the
		// other catalog files define things that change this answer; their ports are not here yet), "real" = anything else.
		let pyOK = true
		try {
			askPython([{ id: "v", op: "version" }], "all")
		} catch (e) {
			pyOK = false
			console.log(`  live: python cannot import every catalog module right now (${String(e.message).split("\n").filter(Boolean).slice(-1)[0]}); differences cannot be told apart`)
		}
		const kinds = { real: [], other: [], stale: [] }
		const verdict = (d, label, pyAllVal, pyItemsVal, serverVal, mineVal) => {
			if (!d.length) return "same"
			let k = "real"
			if (pyOK && pyAllVal !== undefined) k = diff(pyAllVal, serverVal).length ? "stale" : pyItemsVal !== undefined && !diff(mineVal, pyItemsVal).length ? "other" : "real"
			kinds[k].push(`${label}: ${d[0]}`)
			return k
		}
		const js = items.catalog()
		const pyAll = pyOK ? askPython([{ id: "catalog", op: "catalog" }], "all")[0].res : undefined
		const pyItems = askPython([{ id: "catalog", op: "catalog" }])[0].res
		let same = 0
		for (const t of js.types) {
			const lt = cat.types.find((x) => x.key === t.key)
			const d = lt ? diff(t, lt, `types[${t.key}]`) : [`types[${t.key}]: not in the server's catalog`]
			if (!d.length) same++
			const v = verdict(d, `catalog ${t.key}`, pyAll?.types.find((x) => x.key === t.key), pyItems.types.find((x) => x.key === t.key), lt ?? null, t)
			note("live catalog (running server)", v !== "real", t.key, d)
		}
		for (const [what, jsObj, liveObj] of [["materials", js.materials, cat.materials], ["looks", js.looks, cat.looks]]) {
			for (const k of Object.keys(jsObj)) {
				const d = hasOwn(liveObj, k) ? diff(jsObj[k], liveObj[k], `${what}[${k}]`) : [`${what}[${k}]: not in the server's catalog`]
				const v = verdict(d, `catalog ${what} ${k}`, pyAll?.[what][k], pyItems[what][k], liveObj[k] ?? null, jsObj[k])
				note("live catalog (running server)", v !== "real", `${what} ${k}`, d)
			}
		}
		console.log(`  live: GET /api/catalog lists ${cat.types.length} types; ${same} of the ${js.types.length} here (${NEW.length} the module's, with their previews) are identical to it`)
		// POST /api/layout: the module's scenes, the server's answer against ours
		const post = async (route, body) => (await fetch(`${base}/api/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()
		// (the scenarios without the items whose types only the other catalog files have: the server would build those and this side cannot)
		const known = (sc) => ({ ...sc, items: sc.items.filter((i) => items.TYPES[i.type]) })
		const list = [...sceneFiles().map((f) => known(readScene(f))), ...Array.from({ length: QUICK ? 15 : 70 }, () => randomScene(ri(3, 8), chance(0.5) ? NEW : ALL))]
		let n = 0
		let differs = 0
		for (const sc of list) {
			const sv = await post("layout", { scene: sc })
			const mine = jsAnswer({ op: "layout", scene: sc })
			const d = diff(mine, sv)
			let v = "same"
			if (d.length) {
				differs++
				v = verdict(d, `layout ${n + 1}`, pyOK ? askPython([{ id: "x", op: "layout", scene: sc }], "all")[0].res : undefined, askPython([{ id: "x", op: "layout", scene: sc }])[0].res, sv, mine)
			}
			note("live /api/layout (running server)", v !== "real", `layout ${++n}`, d, JSON.stringify(sc).slice(0, 300))
		}
		console.log(`  live: ${list.length} scenes through POST /api/layout: ${differs} differ from the server's answer`)
		// POST /api/simulate for the scenarios with the module's types: the server's own track and summary, given to our summarize()
		for (const f of sceneFiles()) {
			const whole = readScene(f)
			if (!whole.items.some((i) => NEW.includes(i.type))) continue
			const s = known(whole)
			const sv = await post("simulate", { scene: s })
			if (sv.error) {
				console.log(`  live: ${f}: the server answered ${sv.error}`)
				continue
			}
			let mine
			try {
				const { scene: cs, doc, resolved } = prepare(s)
				mine = finish(cs, doc, resolved, sv.track)
			} catch (e) {
				mine = { error: e.message }
			}
			const pick4 = (o) => ({ doc: o.doc, summary: o.summary, warnings: o.warnings, resolved: o.resolved })
			const d = diff(pick4(mine), pick4(sv))
			let v = "same"
			if (d.length) {
				const req = { id: "x", op: "layout", scene: s, track: sv.track }
				const pa = pyOK ? askPython([req], "all")[0].res : undefined
				v = verdict(d, `simulate ${f}`, pa && pick4(pa), pick4(askPython([req])[0].res), pick4(sv), pick4(mine))
			}
			note("live /api/simulate (running server)", v !== "real", `simulate ${f}`, d)
			console.log(`  live: ${f} through POST /api/simulate (the server's own track, ${sv.track?.frames?.length ?? 0} frames): doc, resolved, warnings, summary ${v === "same" ? "identical" : v === "other" ? "differ: the other catalog modules' types or tables" : v === "stale" ? "differ: stale server" : "DIFFER"}`)
		}
		for (const [k, label] of [["real", "REAL differences"], ["other", "differences owed to the other catalog modules (python with every module agrees with the server)"], ["stale", "differences owed to a stale server (its answer is not what python gives now; GET /api/catalog?reload=1 would refresh it)"]]) {
			if (kinds[k].length) info.push(`live: ${kinds[k].length} ${label}: ${kinds[k].slice(0, VERBOSE ? 99 : 3).join(" | ")}`)
		}
	},

	async browser() {
		// the cases of the groups above, answered by web/sim in headless Chromium (never a visible window)
		let chromium
		try {
			;({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1"))
		} catch (e) {
			console.log(`  browser: playwright-core not found (${e.message.split("\n")[0]}); skipped`)
			return
		}
		const MIME = { ".js": "text/javascript", ".json": "application/json", ".html": "text/html" }
		const server = http.createServer((req, res) => {
			const u = decodeURIComponent(new URL(req.url, "http://x").pathname)
			if (u === "/") {
				res.writeHead(200, { "content-type": "text/html" })
				return res.end("<!doctype html><meta charset=utf-8><title>parity</title>")
			}
			const f = path.join(SIM_DIR, "..", u)
			if (!f.startsWith(SIM_DIR) || !fs.existsSync(f)) {
				res.writeHead(404)
				return res.end()
			}
			res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream", "cache-control": "no-store" })
			res.end(fs.readFileSync(f))
		})
		await new Promise((r) => server.listen(0, "127.0.0.1", r))
		const shell = path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell")
		const browser = await chromium.launch({ headless: true, ...(fs.existsSync(shell) ? { executablePath: shell } : {}) })
		try {
			const page = await browser.newPage()
			const errors = []
			page.on("pageerror", (e) => errors.push(e.message))
			page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
			await page.goto(`http://127.0.0.1:${server.address().port}`)
			const cases = exported.map((c) => ({ id: c.req.id, op: c.req.op, scene: c.req.scene }))
			const out = await page.evaluate(async ({ json, modules, files }) => {
				const cs = JSON.parse(json) // (as text: an own "__proto__" key survives)
				const items = await import("/sim/items.js")
				for (const [m, f] of files) items.use_catalog_module(m, (await import(`/sim/${f}`)).register_all)
				const { clean, BadScene } = await import("/sim/clean.js")
				const { layout } = await import("/sim/layout.js")
				const revive = (v) => {
					if (Array.isArray(v)) return v.map(revive)
					if (v && typeof v === "object") {
						const ks = Object.keys(v)
						if (ks.length === 1 && ks[0] === "@@float") return { nan: NaN, inf: Infinity, "-inf": -Infinity }[v["@@float"]]
						const o = {}
						for (const k of ks) Object.defineProperty(o, k, { value: revive(v[k]), enumerable: true, writable: true, configurable: true })
						return o
					}
					return v
				}
				const enc = (_k, v) => (typeof v === "number" && Object.is(v, -0) ? { "@@float": "-0" } : v)
				const answers = []
				const t0 = performance.now()
				for (const c of cs) {
					const scene = c.scene === undefined ? undefined : revive(JSON.parse(JSON.stringify(c.scene)))
					let a
					try {
						a = c.op === "clean" ? { ok: clean(scene) } : layout(scene)
					} catch (e) {
						a = e instanceof BadScene ? { error: e.message } : { error500: `${e.name}: ${e.message}` }
					}
					answers.push(JSON.stringify(a, enc))
				}
				const ms = performance.now() - t0
				const catalog = JSON.stringify(items.catalog(), enc)
				// and only now index.js itself, which registers every module web/sim has (more than the one under test, which would change the answers above)
				const idx = await import("/sim/index.js")
				return { answers, ms, catalog, indexModules: items.CATALOG_MODULES, indexTypes: Object.keys(idx.TYPES), modules }
			}, { json: JSON.stringify(cases), modules: MODULES, files: MODULES.map((m) => [m, fileOf(m)]) })
			const reviveFile = (v) => {
				if (Array.isArray(v)) return v.map(reviveFile)
				if (v && typeof v === "object") {
					const ks = Object.keys(v)
					if (ks.length === 1 && ks[0] === "@@float" && v["@@float"] === "-0") return -0
					return Object.fromEntries(ks.map((k) => [k, reviveFile(v[k])]))
				}
				return v
			}
			exported.forEach((c, i) => {
				const mine = reviveFile(JSON.parse(out.answers[i]))
				const d = c.py.error500 !== undefined ? (mine.error500 !== undefined ? [] : [`python error500 but chromium ${JSON.stringify(mine).slice(0, 80)}`]) : diff(mine, c.py)
				note("browser (chromium)", d.length === 0, `${c.group}: ${c.req.id}`, d, JSON.stringify(c.req.scene).slice(0, 300))
			})
			const pyCat = askPython([{ id: "catalog", op: "catalog" }])[0].res
			pyCat.types = pyCat.types.filter((t) => t.key !== "probe")
			const cd = diff(reviveFile(JSON.parse(out.catalog)), pyCat)
			note("browser (chromium)", cd.length === 0, "catalog() as a whole", cd)
			note("browser (chromium)", NEW.every((t) => out.indexTypes.includes(t)) && MODULES.every((m) => out.indexModules.includes(m)), "index.js loads in the page and has the module's types", [`${out.indexModules}`])
			note("browser (chromium)", errors.length === 0, "no page errors", errors.slice(0, 3))
			console.log(`  browser: ${exported.length} scenes (types, random, dense, angles, clean, scenarios) and catalog() in headless Chromium: ${out.ms.toFixed(0)} ms for the scenes${errors.length ? `; PAGE ERRORS ${errors[0]}` : ""}`)
		} finally {
			await browser.close()
			server.close()
		}
	}
}

// ---------------------------------------------------------------- run
const md5 = (f) => crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex")
async function main() {
	const t0 = Date.now()
	const v = askPython([{ id: "v", op: "version" }])[0].res
	console.log(`python ${v.python.split("|")[0].trim()} (${v.platform}); node ${process.version}; modules ${MODULES.join(", ")}; seed ${SEED}${QUICK ? "; quick" : ""}`)
	console.log(`  JS here: ${CORE.length} core types + ${NEW.length} registered by ${MODULES.join(", ")}: ${NEW.join(", ")}`)
	const files = MODULES.map((m) => `machines/${m}.py`)
	const before = Object.fromEntries(files.map((f) => [f, md5(path.join(PG, f))]))
	for (const f of ["machines/items.py", ...files, ...MODULES.map((m) => `web/sim/${fileOf(m)}`), "web/server.py"]) {
		const st = fs.statSync(path.join(PG, f))
		console.log(`  ${f.padEnd(34)} ${st.size} bytes, modified ${st.mtime.toISOString().slice(0, 19)}${before[f] ? `, md5 ${before[f]}` : ""}`)
	}
	try {
		for (const g of GROUPS) {
			if (!groups[g]) throw new Error(`no group ${g}`)
			const t = Date.now()
			console.log(`[${g}]`)
			await groups[g]()
			if (VERBOSE) console.log(`  (${((Date.now() - t) / 1000).toFixed(1)} s)`)
		}
	} finally {
		fs.rmSync(TMP, { recursive: true, force: true })
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
	console.log(`${"total".padEnd(35)}${String(total).padStart(8)}${String(bad).padStart(12)}   (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
	for (const l of info) console.log(`  note: ${l}`)
	const changed = files.filter((f) => md5(path.join(PG, f)) !== before[f])
	if (changed.length) console.log(`\n  WARNING: ${changed.join(", ")} changed while this ran: re-port what changed and run again`)
	process.exit(bad ? 1 : 0)
}
main().catch((e) => {
	console.error(e)
	process.exit(2)
})
