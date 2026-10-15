// Parity harness for the core port: web/sim/items.js (+ clean.js, layout.js) against machines/items.py and web/server.py.
//
//   node tools/parity/core.mjs [--mode core|server|everyday] [--seed N] [--quick] [--groups a,b,c] [--workers 2] [--verbose] [--export file.json] [--dump fails.jsonl]
//
// Every case is made here, written as JSON lines for tools/parity/py_dump.py (the Python side: server.clean(), items.build(), items.overlaps(),
// items.summarize()), and the answers are compared with what web/sim gives for the same input, number against number (Object.is: the sign of a
// zero counts), key order included. Nothing here starts, stops or touches web/server.py or its workers; the only things started are
// python3 (py_dump.py) and, for the summary cases, up to --workers node processes running research/poc/worker.ts (the engine, as the server does).
//   --mode core    (default) Python gets items.py alone (catalog modules replaced by empty stand-ins), plus the measured pairs catalog_items.py
//                  defines among items.py's own six materials (steel meets steel and both woods there): the same tables as web/sim
//   --mode server  Python gets everything the server imports; this side loads those materials, measured pairs and looks first
//                  (they are the later catalog ports' job), so core items that meet steel or other new materials are compared with the real thing.
//                  THIS IS THE GATE FOR A RELEASE: it also checks that the pairs web/sim already holds are the server's own, value for value.
//   --mode everyday [--integrated]
//                  web/sim's port of machines/catalog_everyday.py (web/sim/catalog-everyday.js), against Python with the whole server loaded: this side
//                  starts from the tables items.py and catalog_items.py leave (py_dump.py's "before" snapshot of the materials, measured pairs, looks and
//                  categories: what the catalog_items port will have made), registers the module on them, and compares everything it defines (the ev-* groups below).
//                  --integrated: no tables from Python: web/sim/index.js is imported as the app does, with all three catalog ports registered (catalog-items.js,
//                  catalog-everyday.js, catalog-mechanisms.js), and the same groups compare that with the whole server, tables included
// groups: tables, catalog, starter, scenarios, types, materials, random, clean, direct, isolation, labels, probe, angles, overlaps, sprites, overlapties, summary, live
//         (live = the running server's /api/catalog and /api/simulate, read only; sprites = balls of the three sprite types that differ only in hollow,
//         wall, a hair of diameter, weight or colour, side by side: the same document as Python's, one the engine admits (every scene is run on it), and the
//         default ball keeps its sprite; overlapties = 3 mm planks, dominoes and box walls through one another at non-round angles, where the overlap depth
//         is the 3 mm tolerance to the last bit of sin/cos: the same warnings as Python's)
// Every layout answer, in every group and mode, is also checked for a sprite shared by two solids of different body or words (the engine refuses those).
//   everyday mode's own: ev-tables (the materials, pairs, looks and categories the module adds, against Python's "after" snapshot), ev-catalog (catalog() of every type
//         against items.catalog(): props, defaults, facts, edit handles, previews), ev-types (each everyday type alone at default, min, max, below, above, 20 random
//         prop sets, material edits), ev-corners (every combination of each type's own sliders at their ends, and each slider swept along its range: where a
//         polygon's side drops under the engine's 0.5 mm the BadScene message must be the same), ev-raw (props no slider can reach, handed to items.build() without clean(): sizes of 0, 1e-7, negative, huge: the polygons the engine would
//         refuse, the divisions by zero, and the exact text of each ValueError/ZeroDivisionError), ev-angles (each type at round angles and round positions, where a rounding tie could show a last-bit difference), ev-materials
//         (scenes with a dozen kinds of material meeting, each item with its own bounce, friction...), ev-clean (clean() on garbage props of every type: the messages),
//         ev-random (random mixed scenes of core and everyday items), ev-scenarios (every web/scenarios and web/saved file, whole),
//         ev-summary (the engine's track of each type dropped on a table or run down a slope and of random scenes, summarised on both sides), ev-live
//         (the running server's /api/catalog for these types, and /api/simulate for the scenes that use them, read only; the summary is computed here from the server's track)
// What clean() is given: the app sent JSON.stringify(scene) over HTTP, so a NaN or an infinity arrived as null. clean() does the same to the scene
// it is handed (a NaN in a scene means null, as it did over HTTP), so the cases that carry a NaN or an infinity ("@@float" markers) are sent to
// Python as null, which is what its server received; the "direct" group hands in-memory scenes (real NaN, undefined, Date, toJSON) to clean() itself.
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { isDeepStrictEqual } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = path.resolve(HERE, "../..")
// the module folder under test (PARITY_SIM=<dir> points it at a copy, for trying a deliberate mistake and seeing the harness catch it)
const SIM = pathToFileURL(path.resolve(process.env.PARITY_SIM || path.join(PG, "web/sim"))).href
const { BadScene, clean, prop_specs } = await import(`${SIM}/clean.js`)
const items = await import(`${SIM}/items.js`)
const { layout, prepare, with_statics } = await import(`${SIM}/layout.js`)
const { ValueError, ZeroDivisionError, hasOwn, pyRound } = await import(`${SIM}/pymath.js`)
const { MATERIALS, MATERIAL_INTS, MEASURED, pairKey } = await import(`${SIM}/materials.js`)
const args = process.argv.slice(2)
const opt = (name, dflt) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt)
const MODE = opt("mode", "core")
const SEED = Number(opt("seed", 20241014))
const QUICK = args.includes("--quick")
const VERBOSE = args.includes("--verbose")
const WORKERS = Number(opt("workers", 2))
const DUMP = opt("dump", null) // write every failing request here (JSON lines, with Python's answer), to reproduce it: node tools/parity/core.mjs --mode everyday --seed N --dump fails.jsonl
const EXPORT = opt("export", null) // write the clean/layout cases and Python's answers here (tools/parity/browser.mjs replays them in a browser)
const EXPORT_CAP = { types: 150, random: 300, materials: 150, overlaps: 40, sprites: 400, overlapties: 400, "ev-types": 400, "ev-corners": 300, "ev-angles": 300, "ev-materials": 60, "ev-random": 300, "ev-scenarios": 40 }
const exported = []
const EV_GROUPS = "ev-tables,ev-catalog,ev-types,ev-corners,ev-raw,ev-angles,ev-materials,ev-clean,ev-random,ev-scenarios,ev-summary,ev-live"
const GROUPS = opt("groups", MODE === "everyday" ? EV_GROUPS : "tables,catalog,starter,scenarios,types,materials,random,clean,direct,isolation,labels,probe,angles,overlaps,sprites,overlapties,summary,live").split(",")
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "parity-"))

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
/** What Python is sent: the JSON a browser would have posted, in which a NaN or an infinity ("@@float" marker here) is null. */
const toPython = (r) => JSON.stringify(r, (_k, v) => (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && "@@float" in v ? null : v))
function askPython(requests, mode = MODE) {
	const out = []
	const B = 150
	for (let i = 0; i < requests.length; i += B) {
		const chunk = requests.slice(i, i + B)
		const input = chunk.map(toPython).join("\n") + "\n"
		const res = execFileSync(PYTHON, ["-I", path.join(HERE, "py_dump.py"), "--mode", mode], { input, maxBuffer: 1 << 30, encoding: "utf8", cwd: PG })
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

function probeBuild(c, P) {
	const ops = probeOps[c.item.id] ?? []
	const resolve = (v) => {
		if (isObj(v) && !Array.isArray(v)) {
			const ks = Object.keys(v)
			if (ks.length === 1 && ks[0] === "$mat") return c.mat(Object.fromEntries(Object.entries(v.$mat).map(([k, x]) => [k, resolve(x)])))
			if (ks.length === 1 && ks[0] === "$pyint") return new items.PyInt(v.$pyint)
		}
		return v
	}
	for (const [name, a, kw] of ops) {
		if (kw !== undefined) c[name](...a, Object.fromEntries(Object.entries(kw).map(([k, x]) => [k, resolve(x)])))
		else c[name](...a)
	}
}
let probeOps = {}
items.register(new items.ItemType("probe", "Probe", "Scenery", probeBuild, { material: "varnished hardwood", materials: [...items.WOOD_PLANKS, "steel"], dynamic: true }))

const errName = (e) => (e instanceof ValueError ? "ValueError" : e instanceof ZeroDivisionError ? "ZeroDivisionError" : /^'.*'$/.test(e.message) ? "KeyError" : e.name)

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
	if (req.op === "raw") {
		probeOps = wire(req.probe ?? {})
		try {
			const { doc, resolved } = items.build(scene)
			return { doc, resolved, warnings: items.overlaps(scene, doc) }
		} catch (e) {
			return { exc: errName(e), message: e.message }
		}
	}
	throw new Error(`op ${req.op}`)
}

// ---------------------------------------------------------------- overlap depth on the tolerance (once the one known difference; now counted)
// A solid pair "starts inside each other" when its overlap depth is above 3 mm. A ruler or a 3 mm plank is 3 mm thick, so one lying through another solid
// has a depth of exactly the tolerance, give or take the noise of the last bit; and the last bit of Math.sin/Math.cos (the corners of a turned solid)
// differs from the platform libm's CPython calls for about 4 % of angles (Apple's libm is not correctly rounded either), so which side of the tolerance
// such a pair fell on could differ. items.py and items.js now compare round(depth, 9) with the tolerance, so both sides agree: a difference there is
// counted like any other, and labelled with the pair (overlapTie) so it is easy to recognise. Group "overlapties" builds such pairs on purpose.
const OVERLAP_TOL = 0.003
function overlapTie(req) {
	try {
		const { doc } = prepare(wire(req.scene))
		const poses = items._world_poses(doc)
		const S = doc.solids
		for (let i = 0; i < S.length; i++) {
			for (let j = i + 1; j < S.length; j++) {
				if (S[i].item === S[j].item) continue
				const d = items._overlap_depth(S[i], poses.get(S[i].id), S[j], poses.get(S[j].id))
				if (Math.abs(d - OVERLAP_TOL) < 1e-9) return `${S[i].id} and ${S[j].id}: depth ${d}`
			}
		}
	} catch {
		return null
	}
	return null
}

/** Why the engine would refuse a document for its sprites, or null: its own rule (tooling/src/sim/document.ts): solids that name one sprite are one
 *  rigid object drawn once, so each must be drawn rigid and have the first one's body and words. */
function spriteConflict(doc) {
	const shared = new Map()
	for (const s of doc.solids ?? []) {
		if (s.sprite === undefined) continue
		if (s.render?.kind !== "rigid") return `${s.id} shares sprite "${s.sprite}", so it must be drawn rigid`
		const first = shared.get(s.sprite)
		if (first === undefined) shared.set(s.sprite, s)
		else if (JSON.stringify(first.body) !== JSON.stringify(s.body) || first.words !== s.words) return `${s.id} shares sprite "${s.sprite}" with ${first.id} but differs in its body or words`
	}
	return null
}

/** Runs the requests on both sides and notes every comparison under `group`. Returns [{req, py, js, ok}]. */
function compare(group, requests, { loose500 = true } = {}) {
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
		else if (loose500 && p.error500 !== undefined) {
			// (a 500 is the server's crash page: any error will do, except the one scenes can really cause, a prop of the wrong type, whose text must match)
			const same = j.error500 !== undefined && (!p.error500.startsWith("TypeError: unsupported operand") || p.error500 === j.error500)
			diffs = same ? [] : [`python error500 ${p.error500} but js ${JSON.stringify(j).slice(0, 100)}`]
		}
		else if (req.op === "raw" && p.exc !== undefined) {
			if (j.exc === undefined) diffs = [`python raised ${p.exc}: ${p.message} but js built it`]
			else if (["ValueError", "ZeroDivisionError", "KeyError"].includes(p.exc)) diffs = diff(j, p)
		} else diffs = diff(j, p)
		if (req.op === "layout" && diffs.length && diffs.every((d) => d.startsWith(".warnings"))) {
			const tie = overlapTie(req)
			if (tie) diffs = [...diffs, `(a pair on the 3 mm tolerance, ${tie}: overlaps() rounds the depth to 9 decimals on both sides, so they must agree)`]
		}
		if (req.op === "layout") {
			// what the engine would refuse: two solids that share a sprite but not their body or words (both sides must make documents it admits)
			for (const [side, a] of [["python", p], ["js", j]]) {
				const why = a && a.doc ? spriteConflict(a.doc) : null
				if (why) diffs = [...diffs, `${side}'s document is one the engine refuses: ${why}`]
			}
		}
		note(group, diffs.length === 0, req.id, diffs, JSON.stringify(req.scene)?.slice(0, 400))
		if (DUMP && diffs.length) fs.appendFileSync(DUMP, JSON.stringify({ group, req, py: p, diffs }) + "\n")
		if (EXPORT && req.op !== "raw" && req.track == null && exported.filter((e) => e.group === group).length < (EXPORT_CAP[group] ?? 1e9)) exported.push({ group, req: JSON.parse(JSON.stringify(req)), py: p })
		out.push({ req, py: p, js: j, ok: diffs.length === 0 })
	})
	return out
}

// ---------------------------------------------------------------- tables: what web/sim holds against Python's
/** Materials, measured pairs and looks that web/sim already has, compared with Python's own tables (group "tables"). Core mode: web/sim must hold
 *  exactly what Python (items.py plus catalog_items.py's pairs among the six core materials) holds. Server mode: whatever web/sim holds must be
 *  the server's value for the same name (the catalog modules' other entries are added next, by loadTables). */
function checkTables(t, exact, group = "tables") {
	const js = {
		materials: Object.fromEntries(Object.entries(MATERIALS)),
		pairs: Object.fromEntries([...MEASURED].map(([k, v]) => [k, v])),
		looks: items.LOOKS
	}
	const pyMaterials = Object.fromEntries(Object.entries(t.materials).map(([k, d]) => [k, Object.fromEntries(Object.entries(d).filter(([kk]) => kk !== "_ints"))]))
	const pyPairs = Object.fromEntries(t.measured.map(([pair, kw]) => [pairKey(pair[0], pair[pair.length - 1]), kw]))
	let n = 0
	for (const [name, vals] of Object.entries(js.materials)) {
		let d = hasOwn(pyMaterials, name) ? diff(vals, pyMaterials[name]) : ["not in python"]
		if (!d.length) d = diff([...(MATERIAL_INTS.get(name) ?? [])].sort(), t.materials[name]._ints, "which numbers are ints") // (700 and 700.0 print differently)
		note(group, d.length === 0, `material ${name}`, d)
		n++
	}
	for (const [key, kw] of Object.entries(js.pairs)) {
		const d = hasOwn(pyPairs, key) ? diff(kw, pyPairs[key]) : ["not in python"]
		note(group, d.length === 0, `measured ${key.replace("\u0000", " + ")}`, d)
		n++
	}
	for (const [name, look] of Object.entries(js.looks)) {
		const d = hasOwn(t.looks, name) ? diff(look, t.looks[name]) : ["not in python"]
		note(group, d.length === 0, `look ${name}`, d)
		n++
	}
	if (exact) {
		for (const name of Object.keys(pyMaterials)) if (!hasOwn(js.materials, name)) note(group, false, `material ${name}`, ["only in python"])
		for (const key of Object.keys(pyPairs)) if (!hasOwn(js.pairs, key)) note(group, false, `measured ${key.replace("\u0000", " + ")}`, ["only in python"])
		for (const name of Object.keys(t.looks)) if (!hasOwn(js.looks, name)) note(group, false, `look ${name}`, ["only in python"])
	}
	return n
}

function loadTables() {
	const t = askPython([{ id: "tables", op: "tables" }], "server")[0].res
	const checked = checkTables(t, false)
	let added = 0
	for (const [name, d] of Object.entries(t.materials)) {
		const { _ints, ...vals } = d
		if (!hasOwn(MATERIALS, name)) {
			items.define_material(name, vals, _ints)
			added++
		}
	}
	for (const [pair, kw] of t.measured) items.measured(pair[0], pair[pair.length - 1], kw)
	for (const [k, v] of Object.entries(t.looks)) if (!hasOwn(items.LOOKS, k)) items.add_look(k, v)
	console.log(`  tables from the server's catalog modules: ${added} materials added, ${t.measured.length} measured pairs in all, ${Object.keys(t.looks).length} looks; the ${checked} entries web/sim held already are the server's`)
}

// ---------------------------------------------------------------- cases
const CORE = ["table", "wall", "plank", "superball", "plastic-ball", "clay-ball", "domino", "domino-row", "seesaw", "box"]
const BALLS = ["superball", "plastic-ball", "clay-ball"]
const STAGE = { x0: -0.55908203125, x1: 3.19091796875, y0: -0.15625, y1: 2.34375 }
let caseNo = 0
const cid = (g) => `${g}-${++caseNo}`

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

function typeCases(list = CORE) {
	const reqs = []
	for (const type of list) {
		const modes = ["default", "min", "max", "below", "above", ...Array(20).fill("random")]
		for (const mode of modes) {
			const flags = chance(0.25) ? { held: chance(0.5) } : chance(0.25) ? { fixed: true } : {}
			reqs.push({ id: cid(`type-${type}-${mode}`), op: "layout", scene: sceneOf([itemOf("a", type, propValues(type, mode), flags)]) })
		}
		// the same props on the table's material variants (a changed material brings its own bounce, friction...)
		const t = items.TYPES[type].schema()
		const mat = t.props.find((p) => p.key === "material")
		if (mat) {
			for (const m of mat.choices) {
				reqs.push({ id: cid(`type-${type}-mat-${m}`), op: "layout", scene: sceneOf([itemOf("a", type, { material: m })]) })
				reqs.push({ id: cid(`type-${type}-mat-${m}-edit`), op: "layout", scene: sceneOf([itemOf("a", type, { material: m, friction: dp(U(0, 2), 3), bounce: dp(U(0, 1), 2) })]) })
			}
			for (const k of ["bounce", "friction", "rolling", "side"]) {
				const p = t.props.find((q) => q.key === k)
				reqs.push({ id: cid(`type-${type}-${k}-edit`), op: "layout", scene: sceneOf([itemOf("a", type, { [k]: pick([p.min, p.max, dp(U(p.min, p.max), 3), p.default, dp(p.default * 1.0000000001, 12)]) })]) })
				// magnitudes that print differently in Python (1e-05, 1e-07...) and values a hair from the material's own
				for (const v of [1e-5, 5e-5, 1e-4, 1.5e-7, 1e-12, 1e-20, 0.30000000000000004, 0.9999999999999999, 2.5e-6, 0.1, 1e-4 + 1e-19, p.default * (1 + 1e-12), p.default * (1 - 1e-9)]) {
					reqs.push({ id: cid(`type-${type}-${k}-${v}`), op: "layout", scene: sceneOf([itemOf("a", type, { [k]: v })]) })
				}
			}
		}
	}
	return reqs
}

function randomScene(n) {
	const list = []
	const cluster = chance(0.5)
	const cx = U(0.2, 2.8)
	const cy = U(0.05, 0.9)
	if (chance(0.6)) list.push({ id: "table", type: "table", x: 1.3, y: 0, props: chance(0.5) ? {} : propValues("table", "random") })
	while (list.length < n) {
		const type = pick(CORE)
		const id = chance(0.1) ? pick(["Ball 1", "x", "a b", "é", "10", "2", "constructor", "__proto__"]) + list.length : `i${list.length}`
		const o = itemOf(id, type, propValues(type, "random"), chance(0.2) ? { held: chance(0.7) } : chance(0.1) ? { fixed: true } : {})
		if (cluster) {
			o.x = dp(cx + U(-0.4, 0.4), ri(2, 6))
			o.y = dp(cy + U(-0.1, 0.4), ri(2, 6))
		}
		if (chance(0.3)) o.name = pick(["Ball", "Dominoes", "the thing", "", "ss", "boss", "Bats"])
		list.push(o)
	}
	const goals = []
	const ball = list.find((i) => BALLS.includes(i.type))
	const box = list.find((i) => i.type === "box")
	if (ball && box) goals.push({ kind: "in", item: ball.id, container: box.id, label: chance(0.5) ? "Land it" : "" })
	// other goals: any item in any item (only boxes can hold), a kind that is not "in", an item that is not there
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

// ---------------------------------------------------------------- clean edge inputs
function cleanCases() {
	const t = (extra) => ({ id: "a", type: "table", ...extra })
	const huge = "x".repeat(200)
	const cases = [
		undefined, null, {}, [], "scene", 5, true,
		{ seconds: "abc" }, { seconds: "5" }, { seconds: "  7.5  " }, { seconds: "1_0" }, { seconds: "1e1" }, { seconds: "inf" }, { seconds: "-inf" }, { seconds: "nan" }, { seconds: "infinity" }, { seconds: "+3" },
		{ seconds: "٣" }, { seconds: "1__0" }, { seconds: "_1" }, { seconds: "0x10" }, { seconds: "" }, { seconds: " " }, { seconds: "1.5.2" }, { seconds: ".5" }, { seconds: "5." }, { seconds: "." }, { seconds: "e5" }, { seconds: "1e" },
		{ seconds: true }, { seconds: false }, { seconds: [1] }, { seconds: [] }, { seconds: {} }, { seconds: { a: 1 } }, { seconds: ["a", [1, 2], { b: true }] },
		{ seconds: 0 }, { seconds: 0.1 }, { seconds: 100 }, { seconds: -5 }, { seconds: 1e300 }, { seconds: -1e300 }, { seconds: 4.5 },
		{ seconds: { "@@float": "nan" } }, { seconds: { "@@float": "inf" } }, { seconds: { "@@float": "-inf" } },
		{ release: "x" }, { release: -1 }, { release: 99 }, { release: 0 }, { release: null }, { seconds: null },
		{ stage: [] }, { stage: "s" }, { stage: 5 }, { stage: {} }, { stage: { x0: 1, x1: 1 } }, { stage: { x0: 5, x1: 3 } }, { stage: { y0: 3 } }, { stage: { x0: "a" } },
		{ stage: { x0: -2000, x1: 2000, y0: -5000, y1: 5000 } }, { stage: { x0: 0, x1: 0.005, y0: 0, y1: 1 } }, { stage: { x0: 0, x1: 1, y0: 0, y1: 0.01 } }, { stage: { x0: [1] } },
		{ name: 5 }, { name: [1, 2] }, { name: true }, { name: { a: 1 } }, { name: "n".repeat(100) }, { name: "é😀".repeat(50) }, { id: 12 }, { id: "i".repeat(90) }, { id: null }, { name: null },
		{ version: 7 }, { version: "x" },
		{ items: 5 }, { items: "x" }, { items: {} }, { items: null }, { items: [1] }, { items: [null] }, { items: ["a"] }, { items: [[]] }, { items: [{}] }, { items: [{ type: 5 }] },
		{ items: [{ type: "nope" }] }, { items: [{ type: "nope", id: "" }] },
		{ items: [{ type: "table" }] }, { items: [{ type: "table", id: "" }] }, { items: [{ type: "table", id: 5 }] }, { items: [{ type: "table", id: "a/b" }] },
		{ items: [{ type: "table", id: "x".repeat(81) }] }, { items: [{ type: "table", id: "x".repeat(80) }] }, { items: [{ type: "table", id: "😀".repeat(80) }] }, { items: [{ type: "table", id: "😀".repeat(81) }] },
		{ items: [{ type: "table", id: "a" }, { type: "table", id: "a" }] }, { items: [{ type: "table", id: "it's" }, { type: "table", id: "it's" }] },
		{ items: [{ type: "table", id: 'say "hi"' }, { type: "table", id: 'say "hi"' }] }, { items: [{ type: "table", id: "both ' and \"" }, { type: "table", id: "both ' and \"" }] },
		{ items: [{ type: "table", id: "tab\there" }, { type: "table", id: "tab\there" }] }, { items: [{ type: "table", id: "é" }, { type: "table", id: "é" }] },
		{ items: [{ type: "table", id: "\u0001\u007f" }, { type: "table", id: "\u0001\u007f" }] }, { items: [{ type: "table", id: "​" }, { type: "table", id: "​" }] },
		{ items: [t({ x: "abc" })] }, { items: [t({ x: "1.5" })] }, { items: [t({ x: true })] }, { items: [t({ y: [1, 2.5] })] }, { items: [t({ angle: { k: "v" } })] }, { items: [t({ x: 5000 })] }, { items: [t({ y: -5000 })] },
		{ items: [t({ angle: 1e7 })] }, { items: [t({ angle: -1e7 })] }, { items: [t({ x: "x".repeat(40) })] }, { items: [t({ x: ["x".repeat(40)] })] }, { items: [t({ x: [1, [2, [3, { a: [4, 5] }]]] })] },
		{ items: [t({ x: "é\u0000" })] }, { items: [t({ x: "it's" })] }, { items: [t({ x: 'say "hi" it\'s' })] }, { items: [t({ x: "\n\t\\" })] }, { items: [t({ x: "日本語" })] }, { items: [t({ x: " " })] },
		{ items: [t({ x: "🙂" })] }, { items: [t({ x: "a​b" })] }, { items: [t({ x: [1e21] })] }, { items: [t({ x: [1e20] })] }, { items: [t({ x: [0.00001, 1e16, 1e15, 123456789.123456789] })] }, { items: [t({ x: [-5] })] },
		{ items: [t({ held: "yes" })] }, { items: [t({ held: "NO" })] }, { items: [t({ held: " True " })] }, { items: [t({ held: "maybe" })] }, { items: [t({ held: 2 })] }, { items: [t({ held: 1 })] }, { items: [t({ held: 0 })] },
		{ items: [t({ held: "1" })] }, { items: [t({ held: "0" })] }, { items: [t({ held: [] })] }, { items: [t({ held: {} })] }, { items: [t({ fixed: "x" })] }, { items: [t({ fixed: 0.5 })] }, { items: [t({ fixed: null })] },
		{ items: [t({ held: " true " })] }, { items: [t({ held: "﻿true" })] }, { items: [t({ held: "\u001ctrue\u001d" })] }, { items: [t({ held: "TRUE\u0085" })] },
		{ items: [t({ name: 5 })] }, { items: [t({ name: [1] })] }, { items: [t({ name: "n".repeat(100) })] }, { items: [t({ name: false })] }, { items: [t({ name: { a: 1 } })] }, { items: [t({ name: "😀".repeat(100) })] },
		{ items: [t({ props: 5 })] }, { items: [t({ props: [] })] }, { items: [t({ props: "x" })] }, { items: [t({ props: null })] }, { items: [t({ props: {} })] },
		{ items: [t({ props: { width: "abc" } })] }, { items: [t({ props: { width: "2.5" } })] }, { items: [t({ props: { width: 100 } })] }, { items: [t({ props: { width: -100 } })] }, { items: [t({ props: { width: [1] } })] },
		{ items: [t({ props: { width: true } })] }, { items: [t({ props: { width: null } })] }, { items: [t({ props: { width: { "@@float": "nan" } } })] }, { items: [t({ props: { width: { "@@float": "inf" } } })] },
		{ items: [t({ props: { material: "gold" } })] }, { items: [t({ props: { material: 5 } })] }, { items: [t({ props: { material: "steel" } })] }, { items: [t({ props: { material: ["steel"] } })] },
		{ items: [t({ props: { material: "domino wood", friction: 0.2 } })] }, { items: [t({ props: { bounce: 5, friction: -1, rolling: 1, side: "0.3" } })] },
		{ items: [t({ props: { color: "#ff0000" } })] }, { items: [t({ props: { color: "c".repeat(64) } })] }, { items: [t({ props: { color: "c".repeat(65) } })] }, { items: [t({ props: { color: "é".repeat(64) } })] },
		{ items: [t({ props: { zzz: 5 } })] }, { items: [t({ props: { zzz: true } })] }, { items: [t({ props: { zzz: [1] } })] }, { items: [t({ props: { zzz: { a: 1 } } })] }, { items: [t({ props: { zzz: { "@@float": "nan" } } })] },
		{ items: [t({ props: { zzz: 1.5, yyy: "s", __proto__x: 1 } })] }, { items: [{ id: "a", type: "table", props: JSON.parse('{"__proto__": 5, "constructor": "x", "width": 2}') }] },
		{ items: [{ id: "__proto__", type: "table" }, { id: "constructor", type: "wall" }] },
		{ items: [{ id: "a", type: "wall", props: { invisible_in_3d: "yes", height: "2", thickness: 0 } }] },
		{ items: [{ id: "a", type: "domino-row", props: { count: 7.5 } }] }, { items: [{ id: "a", type: "domino-row", props: { count: 2.5 } }] }, { items: [{ id: "a", type: "domino-row", props: { count: 3.5 } }] },
		{ items: [{ id: "a", type: "domino-row", props: { count: "4.6" } }] }, { items: [{ id: "a", type: "domino-row", props: { count: 0 } }] }, { items: [{ id: "a", type: "domino-row", props: { count: 99 } }] },
		{ items: [{ id: "a", type: "domino-row", props: { count: -0.5 } }] }, { items: [{ id: "a", type: "domino-row", props: { count: 0.5 } }] }, { items: [{ id: "a", type: "domino-row", props: { count: 1.5 } }] },
		{ items: [{ id: "a", type: "superball", props: { mass: 1e-9, diameter: 0.0001, wall: 5, hollow: "x" } }] }, { items: [{ id: "a", type: "plastic-ball", props: { mass: 1e-9, diameter: 0.0001, wall: 5, hollow: false } }] },
		{ items: [{ id: "a", type: "plastic-ball", props: { material: "steel" } }] }, { items: [{ id: "a", type: "plastic-ball", props: { diameter: "0.1", hollow: "no" } }] },
		{ goals: 5 }, { goals: {} }, { goals: [1] }, { goals: [{}] }, { goals: [{ item: 5, container: [], label: 7 }] }, { goals: [{ kind: "in", item: "a", container: "b", label: "L".repeat(300) }] }, { goals: [{ label: { a: 1 } }] },
		{ goals: null }, { goals: [] }, { goals: [{ kind: "in", item: "a", container: "b" }, "x"] }, { items: Array.from({ length: 201 }, (_, i) => ({ id: `i${i}`, type: "table" })) },
		{ items: Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, type: "table" })) }, { items: Array.from({ length: 201 }, (_, i) => ({ id: `i${i}`, type: "nope" })) },
		{ extra: { a: [1, 2, { b: 3 }] }, items: [{ id: "q", type: "table", note: "keep me", props: { width: 4 } }] }, { seconds: 0.5, release: 20, stage: { x0: -1000, x1: 1000, y0: -1000, y1: 1000 } },
		{ items: [t({ x: 1e-300, y: -1e-300, angle: 5e-324 })] }, { items: [t({ x: -0.0, y: 0.0 })] }, { items: [{ id: "a", type: "table", x: null, y: null, angle: null }] },
		{ items: [{ id: "a", type: "table", type_x: 1 }, 5] }, { items: [{ id: "a", type: "nope" }, 5] }, { items: [{ id: "a", type: "table" }, { id: "b", type: "nope", x: "bad" }, { id: "c", type: "table", x: "bad" }] },
		{ seconds: "bad", items: 5 }, { items: 5, stage: [] }, { stage: [], seconds: "bad" }, { release: "bad", seconds: "bad" }, { items: [t({ x: "bad", held: "bad" })] }, { items: [t({ held: "bad", props: 5 })] },
		// text that depends on the Unicode version (Python 3.13 has 15.1; node and the browsers a newer one, or another): which characters repr() escapes
		// in a message, which are decimal digits for float(), how lower() maps them
		{ items: [t({ x: "\u{10D41}" })] }, { items: [t({ x: "\u{10D4A}" })] }, { items: [t({ y: "1\u{10D41}" })] }, { items: [t({ angle: "\u{1E4F1}" })] }, { seconds: "\u{1E4F1}5" },
		{ items: [t({ x: "\u{1c89}" })] }, { items: [t({ held: "\u{1c89}" })] }, { items: [t({ held: "\u{1c89}true" })] }, { items: [t({ name: "\u{1c89}" })] }, { items: [t({ props: { width: "\u{A7DC}\u{10D50}" } })] },
		{ items: [{ type: "table", id: "\u{8CF}" }, { type: "table", id: "\u{8CF}" }] }, { items: [{ type: "table", id: "\u{1c89}" }, { type: "table", id: "\u{1c89}" }] }, { items: [{ type: "table", id: "\u{10D50}\u{A7CE}" }, { type: "table", id: "\u{10D50}\u{A7CE}" }] },
		{ items: [{ type: "table", id: "\u{E01F0}" }, { type: "table", id: "\u{E01F0}" }] }, { items: [{ type: "table", id: "\u{2FFC}" }, { type: "table", id: "\u{2FFC}" }] }, { items: [{ type: "table", id: "\u{31EF}" }, { type: "table", id: "\u{31EF}" }] },
		{ items: [t({ held: "T\u212aUE" })] }, { items: [t({ held: "\u0130" })] }, { items: [t({ held: " Y\u00cfes" })] }, { items: [t({ x: "\u0661\u0662" })] }, { items: [t({ x: "\u0e51\u0e52.\u0e55" })] },
		// a ball type that lists no `wall` prop still reads one the item sets: a string there is a TypeError in Python (HTTP 500), a number or a bool is fine
		...["superball", "clay-ball"].flatMap((type) => [
			{ hollow: true, wall: "0.01" }, { hollow: true, wall: "nan" }, { hollow: true, wall: "1e-300" }, { hollow: true, wall: "0" }, { hollow: true, wall: "" }, { hollow: true, wall: " " }, { hollow: true, wall: "x".repeat(64) },
			{ hollow: true, wall: true }, { hollow: true, wall: false }, { hollow: true, wall: 0.01 }, { hollow: true, wall: 0 }, { hollow: true, wall: 1 }, { hollow: true, wall: 5 }, { hollow: true, wall: -1 },
			{ hollow: "yes", wall: "0.01" }, { hollow: "no", wall: "0.01" }, { hollow: "", wall: "0.01" }, { hollow: 0, wall: "0.01" }, { hollow: false, wall: "0.01" }, { hollow: 1, wall: "0.01" },
			{ wall: "0.01" }, { hollow: true }, { hollow: true, wall: "0.01", mass: 0.1 }, { hollow: true, wall: "0.01", diameter: 0.2 }, { hollow: true, wall: "\u{10D41}" }
		].map((props) => ({ items: [{ id: "a", type, props }] }))),
		{ items: [{ id: "a", type: "plastic-ball", props: { hollow: true, wall: "0.01" } }] }, { items: [{ id: "a", type: "plastic-ball", props: { hollow: "yes", wall: "nan" } }] }
	]
	// random garbage in every numeric slot
	const garbage = () => pick([undefined, null, true, false, 0, 1, -1, 2.5, 1e30, "7", "x", "", [], {}, [1], { a: 1 }, "1e3", "-0", " 4 "])
	for (let i = 0; i < 150; i++) {
		const type = pick(CORE)
		const props = {}
		for (const p of items.TYPES[type].schema().props) if (chance(0.5)) props[p.key] = garbage()
		cases.push({ items: [{ id: "g", type, x: garbage(), y: garbage(), angle: garbage(), held: garbage(), fixed: garbage(), name: garbage(), props }], seconds: garbage(), release: garbage() })
	}
	return cases.map((scene) => ({ id: cid("clean"), op: "clean", scene }))
}

// ---------------------------------------------------------------- probe scenes: every Ctx method, random arguments
function probeScene(invalidRate = 0.04) {
	const probeItems = []
	const ops = {}
	const n = ri(1, 3)
	const mat = () => {
		const r = rng()
		if (r < 0.5) return undefined
		const base = pick(["varnished hardwood", "domino wood", "steel", "solid rubber", "hollow plastic", "modeling clay"])
		const spec = { base }
		if (chance(0.5)) spec.density = chance(0.3) ? { $pyint: ri(100, 9000) } : chance(0.5) ? dp(U(50, 9000), ri(0, 6)) : pick([700, 906, 7850])
		if (chance(0.4)) spec.overrides = chance(0.3) ? {} : Object.fromEntries(["bounce", "friction", "rolling", "side"].filter(() => chance(0.5)).map((k) => [k, chance(0.2) ? null : dp(U(0, 1), ri(1, 5))]))
		return { $mat: spec }
	}
	const kwCommon = () => {
		const kw = {}
		if (chance(0.3)) kw.kind = pick(["static", "dynamic", null])
		if (chance(0.3)) kw.look = pick(["wood", "steel", "light wood", "plastic", "nolook", null, ""])
		if (chance(0.3)) kw.words = pick(["a thing", "", null])
		if (chance(0.3)) kw.fill = pick(["#123456", "", null])
		const m = mat()
		if (m) kw.material = m
		if (chance(0.15)) kw.pivot = { x: dp(U(-0.5, 0.5), ri(1, 7)), y: dp(U(-0.5, 0.5), ri(1, 7)) }
		if (chance(0.1)) kw.legs = true
		if (chance(0.1)) kw.hidden_3d = chance(0.5)
		if (chance(0.1)) kw.motor = { speed: U(-5, 5), torque: U(0, 5) }
		if (chance(0.1)) kw.surfaceSpeed = dp(U(-2, 2), 3)
		return kw
	}
	const poly = () => {
		const k = ri(3, 8)
		const cx = U(-0.05, 0.05)
		const cy = U(-0.05, 0.05)
		const rx = U(0.01, 0.2)
		const ry = U(0.01, 0.2)
		const angs = Array.from({ length: k }, () => U(0, 2 * Math.PI)).sort((a, b) => a - b)
		let pts = angs.map((a) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
		const r = rng() / invalidRate
		if (r < 0.1) pts = pts.reverse()
		else if (r < 0.2) pts.push([...pts[0]])
		else if (r < 0.28) pts.splice(1, 0, [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2])
		else if (r < 0.34) pts = pts.slice(0, 2)
		else if (r < 0.4) pts = [...pts, ...pts.slice(0, 3)]
		else if (r < 0.46) pts[1] = [pts[0][0] + 0.0001, pts[0][1]]
		else if (r < 0.52) pts = [pts[0], pts[2] ?? pts[1], pts[1], ...pts.slice(3)]
		else if (r < 0.57) pts = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]]
		else if (r < 0.6) pts = [[0, 0], [0.1, 0], [0.2, 0], [0.1, 0.1]]
		const dpn = ri(1, 7)
		pts = pts.map(([x, y]) => (chance(0.7) ? [dp(x, dpn), dp(y, dpn)] : [x, y]))
		return chance(0.3) ? pts.map(([x, y]) => ({ x, y })) : pts
	}
	const parts = []
	for (let i = 0; i < n; i++) {
		const id = `p${i}`
		probeItems.push({ id, type: "probe", ...placement(), ...(chance(0.15) ? { fixed: true } : {}), ...(chance(0.15) ? { held: true } : {}), props: chance(0.3) ? propValues("table", "random") : {} })
		ops[id] = []
		const m = ri(1, 7)
		for (let j = 0; j < m; j++) {
			const part = `s${j}`
			const r = rng()
			const lx = dp(U(-0.6, 0.6), ri(1, 7))
			const ly = dp(U(-0.1, 0.6), ri(1, 7))
			if (r < 0.34) {
				const kw = kwCommon()
				if (chance(0.3)) kw.langle = chance(0.5) ? ri(-90, 90) : U(-180, 180)
				if (chance(0.2)) kw.taper = dp(U(0.2, 1), 2)
				const mineParts = parts.filter((p) => p.startsWith(`${id}/`))
				if (mineParts.length && chance(0.15)) kw.parent = pick(mineParts)
				else if (chance(0.01)) kw.parent = `${id}/nope`
				ops[id].push(["slab", [part, dp(U(0.005, 0.7), ri(2, 7)), dp(U(0.005, 0.5), ri(2, 7)), pick([0.04, 0.12, 0.3, 1.6]), lx, ly], kw])
				parts.push(`${id}/${part}`)
			} else if (r < 0.52) {
				const kw = kwCommon()
				if (chance(0.4)) kw.langle = U(-180, 180)
				ops[id].push(["poly", [part, poly(), pick([0.04, 0.12]), lx, ly], kw])
				parts.push(`${id}/${part}`)
			} else if (r < 0.74) {
				const kw = kwCommon()
				if (chance(0.3)) kw.wall = dp(U(0.0001, 0.01), ri(2, 6))
				if (chance(0.15)) kw.inertia = dp(U(1e-6, 1e-3), 8)
				if (chance(0.3)) kw.sprite = pick(["rubber", "plastic", "clay", "hand-open"])
				if (chance(0.2)) kw.pattern = pick(["pingpong", "tennis"])
				if (chance(0.2)) kw.color = "#abcdef"
				ops[id].push(["ball", [part, dp(U(0.005, 0.25), ri(2, 7)), lx, ly], kw])
				parts.push(`${id}/${part}`)
			} else if (r < 0.82) {
				ops[id].push(["cord", [`cord${j}`, lx, ly]])
			} else if (r < 0.88) {
				ops[id].push(["mat", [], mat()?.$mat ?? {}].slice(0, 2))
			} else if (parts.length >= 1) {
				const mine = parts.filter((p) => p.startsWith(`${id}/`)).map((p) => p.split("/")[1])
				const pt = () => (chance(0.5) ? [dp(U(-0.5, 0.5), ri(1, 7)), dp(U(-0.5, 0.5), ri(1, 7))] : { x: dp(U(-0.5, 0.5), ri(1, 7)), y: dp(U(-0.5, 0.5), ri(1, 7)) })
				const side = () => (chance(0.25) ? null : mine.length && chance(0.8) ? pick(mine) : chance(0.5) ? "other/part" : "s0")
				const kind = pick(["spring", "rope", "pin", "wheel", "pulley"])
				const f = {}
				if (kind === "spring") Object.assign(f, { a: side(), b: side(), anchorA: pt(), anchorB: pt(), rest: dp(U(0.01, 0.5), 3), stiffness: ri(10, 5000), damping: dp(U(0, 5), 2) })
				else if (kind === "rope") Object.assign(f, { a: side(), b: side(), anchorA: pt(), anchorB: pt(), length: dp(U(0.05, 1), 3) })
				else if (kind === "pin") Object.assign(f, { a: side(), b: side(), anchorA: pt(), anchorB: pt(), ...(chance(0.5) ? { motor: { speed: 3, torque: 2 } } : {}) })
				else if (kind === "wheel") Object.assign(f, { chassis: side(), wheel: side(), anchor: pt(), axis: [0, 1], frequency: 4, damping: 0.7 })
				else Object.assign(f, { a: side(), b: side(), groundA: pt(), groundB: pt(), anchorA: pt(), anchorB: pt(), ratio: 1 })
				ops[id].push(["joint", [kind, `j${j}`], f])
			}
		}
	}
	// some probes sit with core items
	const extra = []
	if (chance(0.5)) extra.push({ id: "table", type: "table", x: 1.3, y: 0 })
	if (chance(0.4)) extra.push(itemOf("ball", pick(BALLS), propValues("superball", "random")))
	return { scene: sceneOf([...probeItems, ...extra]), probe: ops }
}

// ---------------------------------------------------------------- groups
const sceneFiles = () => fs.readdirSync(path.join(PG, "web/scenarios")).filter((f) => f.endsWith(".json")).sort()
const readScene = (f) => JSON.parse(fs.readFileSync(path.join(PG, "web/scenarios", f), "utf8"))
const coreOnly = (s) => ({ ...s, items: s.items.filter((i) => CORE.includes(i.type)) })

/** Every material choice of every core type (steel on the table, the plank...), met with every other, as the contacts list says how: the measured pairs
 *  (steel with steel and the woods, the balls' own), the mixing rule, and an item's own bounce/friction/rolling/side scaling a pair. */
function materialRequests() {
	// every material choice of every core type (steel on the table, the plank...), met with every other, as the contacts list says how: the
	// measured pairs (steel with steel and the woods, the balls' own), the mixing rule, and an item's own bounce/friction/rolling/side scaling a pair
	const combos = []
	for (const type of CORE) {
		const mat = items.TYPES[type].schema().props.find((p) => p.key === "material")
		for (const m of mat.choices) combos.push({ type, material: m })
	}
	const at = (c, k, extra = {}) => ({ id: `i${k}`, type: c.type, x: 0.3 * k, y: 0.2 * (k % 5), angle: 0, props: { material: c.material, ...extra } })
	const reqs = [{ id: cid("materials-all"), op: "layout", scene: sceneOf(combos.map((c, k) => at(c, k))) }]
	for (const a of combos) for (const b of combos) reqs.push({ id: cid(`materials-${a.type}-${a.material}-${b.type}-${b.material}`), op: "layout", scene: sceneOf([at(a, 0), at(b, 1)]) })
	const others = combos.filter((c, k) => combos.findIndex((d) => d.material === c.material) === k) // one item of each material
	for (const c of combos) {
		for (const k of ["bounce", "friction", "rolling", "side"]) {
			const p = items.TYPES[c.type].schema().props.find((q) => q.key === k)
			for (const v of [p.min, p.max, dp(U(p.min, p.max), 3), p.default * 0.5, p.default * 1.0000000001, 0]) {
				reqs.push({ id: cid(`materials-edit-${c.type}-${c.material}-${k}`), op: "layout", scene: sceneOf([...others.map((o, j) => at(o, j)), at(c, 9, { [k]: v })]) })
			}
		}
	}
	return reqs
}

/** The rule web/sim's overlaps() must give the answer of: compare every pair of solids (the first version, a line-by-line port of items.py's,
 *  the depth rounded to 9 decimals as items.py rounds it). */
function overlapsRef(scene, doc, tol = 0.003) {
	const its = new Map((scene.items ?? []).map((i) => [i.id, i]))
	const name = (iid) => (its.has(iid) ? (its.get(iid).name ? its.get(iid).name : items.TYPES[its.get(iid).type].name) : iid)
	const world = items._world_poses(doc)
	const solids = doc.solids
	const typeOf = (iid) => (its.has(iid) ? its.get(iid).type : undefined)
	const seen = new Set()
	const out = []
	for (let i = 0; i < solids.length; i++) {
		let a = solids[i]
		for (let j = i + 1; j < solids.length; j++) {
			let b = solids[j]
			if (a.item === b.item || (a.kind === "static" && b.kind === "static" && (typeOf(a.item) === "table" || typeOf(b.item) === "table"))) continue
			if (pyRound(items._overlap_depth(a, world.get(a.id), b, world.get(b.id)), 9) <= tol) continue
			const key = JSON.stringify(a.item < b.item ? [a.item, b.item] : [b.item, a.item])
			if (seen.has(key)) continue
			seen.add(key)
			if (b.kind === "dynamic" && a.kind !== "dynamic") [a, b] = [b, a]
			const na = name(a.item)
			const nb = name(b.item)
			if (a.kind === "dynamic") {
				const many = na.endsWith("s") && !na.endsWith("ss")
				out.push({ items: [a.item, b.item], text: `${na} start${many ? "" : "s"} inside ${nb}: ${many ? "they" : "it"}'ll be shoved out at the start` })
			} else out.push({ items: [a.item, b.item], text: `${na} and ${nb} overlap` })
		}
	}
	return out
}

const groups = {
	async tables() {
		if (MODE !== "core") {
			console.log("  tables: compared as the server's catalog modules were loaded (see above)")
			return
		}
		const t = askPython([{ id: "tables", op: "tables" }])[0].res
		const n = checkTables(t, true)
		console.log(`  tables: ${n} materials, measured pairs and looks, and none left out; web/sim holds what python does in core mode`)
	},

	async materials() {
		const reqs = materialRequests()
		const res = compare("materials", reqs)
		const steel = res.filter((r) => r.py.doc?.contacts.some((x) => /^(Hard steel|Physics Factbook: a steel)/.test(x.source ?? ""))).length
		console.log(`  materials: ${reqs.length} scenes of material combinations; ${steel} of them have a steel contact with steel or a wood (the pairs catalog_items.py defines)`)
	},

	async direct() {
		// scenes handed to clean()/layout() in memory, the way a browser integration would: what the server received was JSON.stringify of them
		const toJSON = () => "from toJSON"
		const toNum = () => 2
		const toYes = () => "yes"
		const [fn1, fn3, fn5, fnF] = [() => 1, () => 3, () => 5, () => "f"] // (shared, so that "the scene is unchanged" can compare two makes of it)
		const SYM = Symbol("s")
		const [PROTO1, PROTO2] = [{ inherited: 1 }, { items: [{ id: "a", type: "table" }] }]
		const date = new Date(86400000)
		const item = (extra = {}) => ({ id: "a", type: "table", ...extra })
		const makers = [
			() => ({ items: [item({ x: NaN })] }), () => ({ items: [item({ x: Infinity })] }), () => ({ items: [item({ x: -Infinity, y: NaN, angle: Infinity })] }),
			() => ({ items: [item({ props: { height: NaN } })] }), () => ({ items: [item({ props: { width: Infinity, thickness: -Infinity } })] }),
			() => ({ items: [{ id: "b", type: "wall", props: { height: NaN, thickness: NaN, invisible_in_3d: NaN } }] }), () => ({ seconds: NaN }), () => ({ seconds: Infinity, release: -Infinity }), () => ({ release: NaN, seconds: 2 }),
			() => ({ items: [item({ held: NaN })] }), () => ({ items: [item({ fixed: Infinity })] }), () => ({ items: [{ id: "s", type: "superball", props: { color: "#abc", zzz: NaN, yyy: Infinity, mass: NaN } }] }),
			() => ({ stage: { x0: NaN, x1: Infinity, y0: undefined, y1: -Infinity } }), () => ({ stage: { x0: 0, x1: NaN } }), () => ({ stage: NaN }), () => ({ items: NaN }), () => ({ goals: NaN }),
			() => ({ goals: [{ kind: "in", item: "a", container: "b", label: NaN }, { item: NaN, container: Infinity, label: Infinity }] }),
			() => ({ name: date, id: date, items: [item({ name: date })] }), () => ({ items: [item({ x: undefined, y: undefined, angle: undefined, props: undefined })] }),
			() => ({ items: [item({ x: -0, y: -0, angle: -0 })] }), () => ({ items: [item({ x: 1e999 })] }), () => ({ items: [item({ x: Number.MAX_VALUE, y: -Number.MAX_VALUE, angle: Number.MIN_VALUE })] }),
			() => ({ name: { toJSON }, items: [item({ name: { toJSON }, props: { width: { toJSON: toNum } } })] }), () => ({ items: [item({ x: { toJSON: toNum }, held: { toJSON: toYes } })] }),
			() => ({ items: [item({ name: new String("boxed"), x: new Number(3), held: new Boolean(true) })] }), () => ({ items: [item({ x: fn5, y: Symbol.iterator, name: fnF })] }),
			() => ({ items: [item({ props: { width: fn3, thickness: undefined, height: [NaN] } })] }), () => ({ items: [item({ x: [NaN] }), 5, null, undefined] }), () => ({ items: [undefined, item(), null] }),
			() => ({ items: [item(), item()] }), () => ({ items: [item({ x: NaN }), item({ x: NaN })] }), () => ({ goals: [undefined] }), () => ({ goals: [null, {}] }), () => ({ seconds: undefined, release: undefined, stage: undefined, items: undefined, goals: undefined }),
			() => ({ items: [item({ props: { material: NaN } })] }), () => ({ items: [item({ props: { material: undefined } })] }), () => ({ items: [item({ id: NaN })] }), () => ({ items: [item({ type: NaN })] }), () => ({ items: [item({ id: undefined })] }),
			() => ({ [NaN]: Infinity, items: [item({ [undefined]: 1, "": NaN })] }), () => JSON.parse('{"__proto__": {"x": 1}, "items": [{"id": "a", "type": "table", "__proto__": 5}]}'), () => ({}), () => undefined, () => null, () => NaN, () => Infinity, () => fn1, () => SYM,
			() => new Date(0), () => new Map(), () => new Set([1]), () => [NaN], () => new Number(5), () => new String("s"), () => Object.create(PROTO1), () => Object.assign(Object.create(PROTO2), { seconds: 3 }),
			() => ({ items: Array.from({ length: 4 }, (_, i) => ({ id: `i${i}`, type: i % 2 ? "superball" : "domino", x: i % 2 ? NaN : 0.5 * i, y: 0.1, props: i % 2 ? { hollow: NaN } : {} })) }),
			() => {
				const shared = { id: "a", type: "table" }
				return { items: [shared, { ...shared, id: "b" }], goals: [{ kind: "in", item: "a", container: "b" }] }
			}
		]
		const reqs = []
		for (const m of makers) {
			const sample = m()
			const text = JSON.stringify(sample)
			const sent = text === undefined ? undefined : JSON.parse(text) // what the server received
			for (const op of ["clean", "layout"]) reqs.push({ id: cid(`direct-${op}`), op, scene: sent, maker: m })
		}
		const py = askPython(reqs.map(({ id, op, scene }) => ({ id, op, scene: scene === undefined ? {} : scene })), MODE) // (a body with nothing in it is {} for the server)
		reqs.forEach((req, i) => {
			const input = req.maker()
			const keep = req.maker()
			let j
			try {
				j = req.op === "clean" ? { ok: clean(input) } : layout(input)
			} catch (e) {
				j = e instanceof BadScene ? { error: e.message } : { error500: `${e.name}: ${e.message}` }
			}
			const p = py[i].res
			let diffs = diff(j, p)
			if (p.error500 !== undefined && j.error500 !== undefined) diffs = []
			if (!isDeepStrictEqual(input, keep)) diffs.push("the scene handed in was changed")
			note("direct", diffs.length === 0, req.id, diffs, String(req.maker).slice(0, 300))
		})
		console.log(`  direct: ${reqs.length} calls with in-memory scenes (NaN, infinities, undefined, Date, toJSON, boxed values, odd objects) against python given the JSON of them; none changed the scene it was given`)
	},

	async isolation() {
		// what catalog() and layout() hand out is the caller's own: changing it changes nothing later
		const scramble = (v, seen = new Set()) => {
			if (v === null || typeof v !== "object" || seen.has(v)) return
			seen.add(v)
			if (Array.isArray(v)) {
				for (const x of v) scramble(x, seen)
				v.push("zzz")
				return
			}
			for (const k of Object.keys(v)) {
				if (typeof v[k] === "string") v[k] = `${v[k]}!`
				else if (typeof v[k] === "number") v[k] += 1
				else if (typeof v[k] === "boolean") v[k] = !v[k]
				else scramble(v[k], seen)
			}
			v.zzz = true
		}
		const ref = items.catalog()
		const c1 = items.catalog()
		scramble(c1)
		note("isolation", isDeepStrictEqual(items.catalog(), ref), "catalog() after its last result was scrambled", ["the next catalog() differs"])
		const typeLists = () => JSON.stringify(Object.values(items.TYPES).map((t) => [t.tags, t.edit, t.materials, t.props.map((p) => p.choices)]))
		const refTypes = typeLists()
		scramble(items.TYPES.table.schema())
		note("isolation", typeLists() === refTypes, "a type's own lists after its schema() was scrambled", ["a type changed"])
		for (const spec of prop_specs("table").values()) scramble(spec) // (what clean() checks with is its own copy)
		for (const probe of [{ material: "zzz" }, { material: "steel!" }, { zzz: 1 }]) {
			let msg = null
			try {
				clean({ items: [{ id: "a", type: "table", props: probe }] })
			} catch (e) {
				msg = e.message
			}
			const want = "material" in probe ? `a: Material must be one of varnished hardwood, domino wood, steel, not '${probe.material}'` : null
			note("isolation", msg === want, `clean() after the catalog, a schema and prop_specs() were scrambled: ${JSON.stringify(probe)}`, [`got ${msg}, wanted ${want}`])
		}
		const scene = sceneOf([itemOf("a", "superball", { diameter: 0.1 }), itemOf("t", "table", {}), itemOf("d", "domino-row", { count: 5 })])
		const before = JSON.parse(JSON.stringify(scene))
		const l1 = layout(scene)
		const snap = structuredClone(l1)
		scramble(l1)
		const l2 = layout(scene)
		note("isolation", isDeepStrictEqual(l2, snap), "layout() after its last result was scrambled", ["the next layout() differs"])
		note("isolation", isDeepStrictEqual(JSON.parse(JSON.stringify(scene)), before), "layout() leaves the scene it is given alone", ["the scene changed"])
		console.log("  isolation: catalog(), a type's schema(), prop_specs() and layout() hand out copies; changing one changes nothing later nor what clean() accepts")
	},

	async labels() {
		// goals' labels use str.lower() of an item's name: in Unicode 15.1 (Python 3.13), whatever the engine's Unicode is
		const names = ["Ᲊ crate", "Ᲊ", "ᲊ", "Σ", "ΑΣ", "ΑΣ ΑΣ.", "ΟΔΥΣΣΕΥΣ", "İSTANBUL", "ẞ", "K", "Å", "ǅ", "Ǆ", "A­Σ", "aͅΣ", "Σ́", "A.Σ", "AΣ.B", "ვ0 ვ0", "Ƛ", "꟎", "\u{10D50}", "\u{10D51}Box", "\u{10570}", "\u{1E900}", "\u{16E40}", "\u{1C90}", "Box", "THE CRATE", "cafÉ ÜÖ", "Ångström's", "Ѡ ᾼ", "ⅠⅡ", "Ⓐ", "\u{1F130}", "s", "ss", "Σs"]
		const randomName = () => {
			const parts = []
			for (let i = ri(1, 5); i > 0; i--) {
				const r = rng()
				if (r < 0.25) parts.push(pick(["Σ", "Α", "σ", "ς", "a", "B", " ", ".", "'", "­", "ͅ", "́", "‍", "’"]))
				else if (r < 0.5) parts.push(String.fromCodePoint(pick([0x1c89, 0x1c8a, 0xa7ce, 0xa7dc, 0x10d50, 0x10d70, 0x10570, 0x16e40, 0x1e900, 0x1c90, 0x13a0, 0xab70, 0x10c80, 0x118a0, 0x1d7ce, 0x2c2f, 0xa7c0, 0x1e4d0, 0x3130, 0x2ffc])))
				else parts.push(String.fromCodePoint(chance(0.7) ? ri(0x80, 0x24ff) : chance(0.5) ? ri(0x1c80, 0x1d00) : ri(0xa640, 0xa7ff)))
			}
			return parts.join("")
		}
		const reqs = []
		const list = [...names, ...Array.from({ length: QUICK ? 150 : 600 }, randomName)]
		for (const nm of list) {
			const scene = sceneOf([
				{ id: "bl", type: "superball", x: 1, y: 0.1, angle: 0, ...(chance(0.5) ? { name: randomName() } : {}) },
				{ id: "bx", type: "box", x: 1, y: 0, angle: 0, name: nm }
			], { goals: [{ kind: "in", item: "bl", container: "bx" }, { kind: "in", item: "bx", container: "bl", label: "" }, { kind: "in", item: "bl", container: "bx", label: "kept" }] })
			const { doc } = prepare(scene)
			const placements = Object.fromEntries([...items._world_poses(doc)].map(([sid, [x, y, a]]) => [sid, { x, y, angle: a }]))
			const track = { fps: 120, frames: [{ t: 0, placements }, { t: 1, placements }], impacts: [] }
			reqs.push({ id: cid("label"), op: "layout", scene, track })
		}
		const res = compare("labels", reqs)
		const withNonAscii = res.filter((r) => r.py.summary?.goals.some((g) => /[^\x00-\x7f]/.test(g.label))).length
		console.log(`  labels: ${reqs.length} scenes with a goal naming an item (${withNonAscii} with a non-ASCII name in the label)`)
	},

	async overlaps() {
		// (a) the box filter and the already-reported shortcut change nothing: the same answer as comparing every pair, on JS-built dense scenes
		const dense = (n) => {
			const list = []
			const cx = U(0.2, 2.8)
			const cy = U(0.05, 0.9)
			const spread = pick([0.05, 0.2, 0.6, 1.5])
			while (list.length < n) {
				const type = pick(CORE)
				const o = itemOf(`i${list.length}`, type, propValues(type, "random"), chance(0.2) ? { held: chance(0.7) } : chance(0.15) ? { fixed: true } : {})
				o.x = dp(cx + U(-spread, spread), ri(2, 6))
				o.y = dp(cy + U(-spread / 2, spread), ri(2, 6))
				if (chance(0.3)) o.angle = pick([0, 90, 45, 30, -30, 180, ri(-180, 180)])
				if (chance(0.1)) o.name = pick(["Dominoes", "ss", "Boss", "Bats", "a"])
				list.push(o)
			}
			return sceneOf(list, { stage: randomStage() })
		}
		const answer = (fn) => {
			try {
				return { ok: fn() }
			} catch (e) {
				return { threw: `${e.name}: ${e.message}` }
			}
		}
		const probeDocs = []
		const degenerate = [
			[["slab", ["z", 0, 0.1, 0.04, 0, 0.05]]], [["slab", ["z", 0.1, 0, 0.04, 0, 0.05]]], [["slab", ["z", 0.1, 0.1, 0.04, 0, 0.05], { taper: 0 }]], [["slab", ["z", 0.1, 0.1, 0.04, 0, 0.05], { taper: 1.5 }]],
			[["slab", ["z", 0.1, 0.1, 0.04, 0, 0.05], { taper: 0.5, langle: 30 }]], [["ball", ["z", 0, 0, 0]]], [["ball", ["z", 0.05, 0, 0]], ["slab", ["w", 0, 0, 0.04, 0.3, 0]]],
			[["poly", ["z", [[0, 0], [0.1, 0], [0.05, 0.1]], 0.04, 0, 0]]], [["slab", ["z", 1e-5, 0.1, 0.04, 0, 0.05]]], [["slab", ["z", 0.0000049, 0.1, 0.04, 0, 0.05]]]
		]
		for (const ops of degenerate) {
			for (const far of [0, 0.2, 3]) probeDocs.push({ ops, far })
		}
		let diffsN = 0
		let casesN = 0
		let warnsN = 0
		const bad = []
		const checkRef = (id, scene, doc) => {
			const ref = answer(() => overlapsRef(scene, doc))
			const got = answer(() => items.overlaps(scene, doc))
			const ok = isDeepStrictEqual(got, ref)
			casesN++
			if (got.ok) warnsN += got.ok.length
			note("overlaps vs every pair", ok, id, ok ? [] : [`${JSON.stringify(got).slice(0, 150)} vs ${JSON.stringify(ref).slice(0, 150)}`])
			if (!ok) diffsN++
		}
		for (let i = 0; i < (QUICK ? 150 : 1200); i++) {
			const scene = dense(ri(3, 60))
			let prep
			try {
				prep = prepare(wire(scene))
			} catch (e) {
				continue
			}
			checkRef(cid("dense"), prep.scene, prep.doc)
		}
		for (const { ops, far } of probeDocs) {
			const scene = sceneOf([{ id: "p0", type: "probe", x: 0.5, y: 0.2, angle: 0 }, { id: "p1", type: "probe", x: 0.5 + far, y: 0.2, angle: 0 }, { id: "p2", type: "superball", x: 0.5, y: 0.25, angle: 0 }])
			probeOps = { p0: ops, p1: [["slab", ["y", 0.2, 0.1, 0.04, 0, 0.05]], ["ball", ["b", 0.05, 0.05, 0.05]]] }
			const built = answer(() => items.build(scene))
			if (built.ok) checkRef(cid("degenerate"), scene, built.ok.doc)
		}
		console.log(`  overlaps: ${casesN} scenes (3-60 items in a cluster, degenerate slabs, balls and polygons), ${warnsN} warnings, new against the pair-by-pair rule: ${diffsN} differences`)
		// (b) python on denser scenes than the random group makes
		const reqs = []
		for (let i = 0; i < (QUICK ? 25 : 150); i++) reqs.push({ id: cid("dense-py"), op: "layout", scene: dense(ri(10, 45)) })
		const res = compare("overlaps", reqs)
		console.log(`  overlaps: ${reqs.length} dense scenes against python, ${res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0)} warnings`)
		// (c) time (printed; the largest scene must not take more than a few seconds)
		for (const [rows, per] of [[200, 1], [50, 30], [200, 30]]) {
			const list = Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, type: "domino-row", x: 1, y: 0, angle: 0, props: { count: per } }))
			const { scene: cs, doc } = prepare(sceneOf(list))
			const t = performance.now()
			const w = items.overlaps(cs, doc)
			const ms = performance.now() - t
			console.log(`  overlaps: ${rows} domino rows of ${per} on top of each other (${doc.solids.length} solids): ${w.length} warnings in ${ms.toFixed(0)} ms`)
			note("overlaps (time)", ms < 5000, `${rows} x ${per}`, [`${ms.toFixed(0)} ms`])
		}
		{
			// (the growing rows get enormous at 30 dominoes, so a scene that is really spread out has rows that do not grow)
			const spread = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, type: "domino-row", x: (i % 20) * 2.1, y: Math.floor(i / 20) * 0.3, angle: 0, props: { count: 30, growth: 1.0 } }))
			const { scene: cs, doc } = prepare(sceneOf(spread))
			const t = performance.now()
			const w = items.overlaps(cs, doc)
			const ms = performance.now() - t
			console.log(`  overlaps: 200 domino rows of 30 spread out (${doc.solids.length} solids): ${w.length} warnings in ${ms.toFixed(0)} ms`)
			note("overlaps (time)", ms < 5000, "200 x 30 spread out", [`${ms.toFixed(0)} ms`])
			checkRef("spread-out", cs, doc)
		}
	},

	async catalog() {
		const py = askPython([{ id: "catalog", op: "catalog" }])[0].res
		const js = items.catalog()
		let ds = diff(js.categories, MODE === "core" ? py.categories : py.categories.slice(0, js.categories.length), "categories") // (the catalog modules add categories)
		for (const t of js.types) {
			const pt = py.types.find((x) => x.key === t.key)
			ds = ds.concat(pt ? diff(t, pt, `types[${t.key}]`) : [`types[${t.key}]: missing from python`])
		}
		const order = py.types.map((t) => t.key).filter((k) => js.types.some((t) => t.key === k))
		ds = ds.concat(diff(js.types.map((t) => t.key), order, "type order"))
		ds = ds.concat(diff(js.materials, MODE === "core" ? py.materials : Object.fromEntries(Object.keys(js.materials).map((k) => [k, py.materials[k]])), "materials"))
		ds = ds.concat(diff(js.looks, MODE === "core" ? py.looks : Object.fromEntries(Object.keys(js.looks).map((k) => [k, py.looks[k]])), "looks"))
		note("catalog", ds.length === 0, "catalog()", ds)
		for (const t of js.types) note("catalog types", !diff(t, py.types.find((x) => x.key === t.key)).length, t.key, diff(t, py.types.find((x) => x.key === t.key)))
		console.log(`  catalog: ${js.types.length - 1} core types (+ the harness's probe type) compared; python lists ${py.types.length - 1} types in this mode; ${Object.keys(js.materials).length} materials, ${Object.keys(js.looks).length} looks`)
	},

	async starter() {
		const s = readScene("rube-goldberg.json")
		compare("starter", [{ id: "starter-layout", op: "layout", scene: s }, { id: "starter-clean", op: "clean", scene: s }])
	},

	async scenarios() {
		const reqs = []
		for (const f of sceneFiles()) {
			const s = readScene(f)
			const only = s.items.every((i) => CORE.includes(i.type))
			reqs.push({ id: `scenario-${f}${only ? "" : " (core items only)"}`, op: "layout", scene: coreOnly(s) })
			if (!only) console.log(`  ${f}: uses non-core types (${[...new Set(s.items.filter((i) => !CORE.includes(i.type)).map((i) => i.type))].join(", ")}); compared with its core items only`)
		}
		compare("scenarios", reqs)
	},

	async types() {
		compare("types", typeCases())
	},

	async random() {
		const N = QUICK ? 300 : 3000
		const reqs = []
		for (let i = 0; i < N; i++) reqs.push({ id: cid("random"), op: "layout", scene: randomScene(ri(3, 8)) })
		const res = compare("random", reqs)
		const w = res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0)
		console.log(`  random: ${N} scenes of 3-8 core items, ${w} overlap warnings among them`)
	},

	async clean() {
		const reqs = cleanCases()
		compare("clean", reqs, { loose500: false })
		// and the same inputs through layout (clean + build): the 400 messages and the builder
		compare("clean via layout", reqs.filter((r) => r.scene && typeof r.scene === "object").map((r) => ({ ...r, id: r.id + "-layout", op: "layout" })))
	},

	async probe() {
		const N = QUICK ? 150 : 1500
		const reqs = []
		for (let i = 0; i < N; i++) {
			const { scene, probe } = probeScene()
			reqs.push({ id: cid("probe"), op: "raw", scene, probe })
		}
		// polygons the engine refuses: one probe item with one outline each, most of them bad, for the messages
		for (let i = 0; i < (QUICK ? 100 : 600); i++) {
			const { scene, probe } = probeScene(0.6)
			const id = Object.keys(probe)[0]
			probe[id] = probe[id].filter((o) => o[0] === "poly").slice(0, 1)
			if (!probe[id].length) probe[id] = [["poly", ["s0", [[0, 0], [0.1, 0], [0.1, 0.1]], 0.04, 0, 0], {}]]
			scene.items = scene.items.filter((it) => it.id === id)
			reqs.push({ id: cid("polygon"), op: "raw", scene, probe })
		}
		const res = compare("probe", reqs)
		const threw = res.filter((r) => r.py.exc).length
		const kinds = {}
		for (const r of res) if (r.py.exc) kinds[`${r.py.exc}: ${r.py.message.replace(/p\d\/s\d|[\d.]+/g, "#").slice(0, 48)}`] = (kinds[`${r.py.exc}: ${r.py.message.replace(/p\d\/s\d|[\d.]+/g, "#").slice(0, 48)}`] ?? 0) + 1
		if (VERBOSE) console.log(kinds)
		const w = res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0)
		console.log(`  probe: ${N} scenes of random Ctx calls (slab, poly, ball, joint, cord, mat), ${threw} of them raise in Python (same error here), ${w} overlap warnings`)
	},

	async angles() {
		// Python's sin/cos are the C library's and JavaScript's differ from them in the last bit for a few percent of arguments, so the
		// places where that could show are the ones where a position lands exactly on a rounding tie by construction: round numbers at
		// round angles. Every whole degree from -720 to 720 (and every 0.25 deg to 90), nice item positions, nice local offsets
		// (multiples of 5e-6, where half of one is a tie at 5 decimals), slabs, balls, polygons and joints placed through them.
		const reqs = []
		const angles = [...Array.from({ length: 1441 }, (_, i) => i - 720), ...Array.from({ length: 360 }, (_, i) => (i + 0.5) * 0.25), 12.452, -13.999994540903613, -19.757017170598612, 1e-9, 89.999999, 179.9999999]
		const nice = () => pick([0, 0.00001, -0.00001, 0.000015, 0.000005, 0.00003, 0.5, -0.5, 0.25, 0.1, -0.1, 0.0125, 0.003, 0.0001, 0.000025, 1e-6, 0.123455, 0.2, 0.05]) * (chance(0.3) ? ri(1, 9) : 1)
		for (const a of angles) {
			for (let rep = 0; rep < (QUICK ? 1 : 3); rep++) {
				const ops = []
				for (let j = 0; j < 8; j++) {
					const lx = nice()
					const ly = nice()
					const r = rng()
					if (r < 0.6) ops.push(["slab", [`s${j}`, 0.1 + j / 100, 0.02, 0.1, lx, ly], { langle: pick([0, 30, 45, 90, -90, 180, 12.452, a]) }])
					else if (r < 0.8) ops.push(["ball", [`s${j}`, 0.03, lx, ly], {}])
					else if (r < 0.9) ops.push(["cord", [`c${j}`, lx, ly]])
					else ops.push(["joint", ["pin", `j${j}`], { a: null, b: null, anchorA: [lx, ly], anchorB: { x: ly, y: lx } }])
				}
				const scene = sceneOf([{ id: "p", type: "probe", x: pick([0, 1.3, 0.5, -0.52, 3.12, 0.00001, 0.123455, 2.5, 0.015625]), y: pick([0, 0.5, 0.7, 0.00001, 1.0, 0.015625]), angle: a }])
				reqs.push({ id: cid("angle"), op: "raw", scene, probe: { p: ops } })
			}
		}
		// the same through the seesaw (sin/cos of its tilt) and a rotated domino row, at round tilts
		for (let tilt = 1; tilt <= 40; tilt += 0.25) {
			for (const len of [0.598, 0.5, 1, 0.25]) reqs.push({ id: cid("tilt"), op: "layout", scene: sceneOf([{ id: "s", type: "seesaw", x: pick([0, 1.3, 2.7137]), y: 0, angle: pick([0, 0, 30, 90, 120]), props: { tilt, length: len, pivot_offset: pick([-0.046, 0, 0.1, -0.2]) } }]) })
		}
		compare("angles", reqs)
		console.log(`  angles: ${reqs.length} scenes at round angles and round offsets`)
	},

	async summary() {
		const scenes = []
		for (const f of sceneFiles()) scenes.push({ id: `scenario-${f}`, scene: coreOnly(readScene(f)) })
		const N = QUICK ? 12 : 300
		for (let i = 0; i < N; i++) {
			const s = randomScene(ri(3, 7))
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
		const stories = res.reduce((a, r) => a + (r.py.summary?.stories.length ?? 0), 0)
		const events = res.reduce((a, r) => a + (r.py.summary?.events.length ?? 0), 0)
		const goals = res.reduce((a, r) => a + (r.py.summary?.goals.length ?? 0), 0)
		const hit = res.reduce((a, r) => a + (r.py.summary?.goals.filter((g) => g.ok).length ?? 0), 0)
		console.log(`  summary: ${reqs.length} tracks run on the engine; ${stories} stories, ${events} events, ${goals} goals (${hit} met) compared`)
		fs.mkdirSync(path.join(HERE, "fixtures"), { recursive: true })
	},

	async live() {
		let base = "http://localhost:8790"
		try {
			const cat = await (await fetch(`${base}/api/catalog`)).json()
			const js = items.catalog()
			let bad = 0
			for (const t of js.types.filter((x) => x.key !== "probe")) {
				const pt = cat.types.find((x) => x.key === t.key)
				const d = pt ? diff(t, pt, `types[${t.key}]`) : ["missing"]
				note("live catalog (running server)", d.length === 0, t.key, d)
				bad += d.length
			}
			console.log(`  live: GET /api/catalog lists ${cat.types.length} types; the ${js.types.length - 1} core ones ${bad ? "DIFFER" : "match"}`)
		} catch (e) {
			console.log(`  live: server at ${base} not reachable (${e.message}); skipped`)
			return
		}
		// the starter through the running server's /api/simulate, its own track and summary
		const s = readScene("rube-goldberg.json")
		const r = await fetch(`${base}/api/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene: s }) })
		const sim = await r.json()
		const { scene: cs, doc, resolved } = prepare(s)
		const out = { doc, resolved, warnings: items.overlaps(cs, doc), summary: items.summarize(cs, doc, with_statics(sim.track)) }
		const ref = { doc: sim.doc, resolved: sim.resolved, warnings: sim.warnings, summary: sim.summary }
		const ds = diff(out, ref)
		note("live starter (running server)", ds.length === 0, "rube-goldberg /api/simulate", ds)
		// core scenes through the running server's /api/layout (it has the whole catalog loaded: steel meets steel and the woods as catalog_items.py says)
		{
			const fixed = [
				sceneOf([{ id: "t", type: "table", x: 1.3, y: 0, angle: 0, props: { material: "steel" } }, { id: "b", type: "superball", x: 1, y: 0.3, angle: 0 }, { id: "d", type: "domino", x: 1.5, y: 0, angle: 0 }]),
				sceneOf([{ id: "t", type: "table", x: 1.3, y: 0, angle: 0 }, { id: "b", type: "plastic-ball", x: 1, y: 0.3, angle: 0 }, { id: "p", type: "plank", x: 1.5, y: 0.5, angle: 20, props: { material: "steel" } }])
			]
			const mats = materialRequests().map((r) => r.scene)
			const list = [...fixed, mats[0], ...Array.from({ length: 80 }, () => pick(mats)), ...Array.from({ length: 80 }, () => randomScene(ri(3, 8)))]
			let n = 0
			for (const sc of list) {
				const res = await fetch(`${base}/api/layout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene: sc }) })
				const sv = await res.json()
				let mine
				try {
					mine = layout(sc)
				} catch (e) {
					mine = { error: e.message }
				}
				const d = diff(mine, sv)
				note("live /api/layout (running server)", d.length === 0, `layout ${++n}`, d, JSON.stringify(sc).slice(0, 300))
			}
			console.log(`  live: ${list.length} core scenes (steel and the other material combinations among them) through POST /api/layout: ${report["live /api/layout (running server)"].bad} differ`)
		}
		fs.mkdirSync(path.join(HERE, "fixtures"), { recursive: true })
		fs.writeFileSync(path.join(HERE, "fixtures", "rube-goldberg.sim.json"), JSON.stringify({ doc: sim.doc, resolved: sim.resolved, warnings: sim.warnings, summary: sim.summary, track: sim.track }))
		console.log(`  live: starter via the running server: doc, resolved, warnings, summary ${ds.length ? "DIFFER: " + ds[0] : "match"}; saved tools/parity/fixtures/rube-goldberg.sim.json`)
	}
}

// ---------------------------------------------------------------- the everyday catalog (--mode everyday): web/sim/catalog-everyday.js
let EV = [] // the keys the module registered, in order
let EV_PRE = null // py_dump.py's snapshot of the tables just before catalog_everyday.py registered (what the module starts from)
let EV_MODULE = null
let EV_CATALOG = null // (with --export: Python's catalog for the everyday types, written beside the cases)

/** Loads what items.py and catalog_items.py leave (the catalog_items port's job, later) into web/sim, then registers web/sim/catalog-everyday.js on it
 *  the way index.js does (use_catalog_module). The core entries web/sim already holds are checked against Python's on the way (group "tables"). */
const INTEGRATED = args.includes("--integrated")
async function loadEveryday() {
	EV_PRE = askPython([{ id: "tables-before", op: "tables", at: "before" }])[0].res
	if (INTEGRATED) {
		await import(`${SIM}/index.js`) // registers catalog-items.js, catalog-everyday.js, catalog-mechanisms.js, in items.py's order
		EV_MODULE = await import(`${SIM}/catalog-everyday.js`)
		EV = [...EV_MODULE.KEYS]
		console.log(`  integrated: web/sim/index.js registered ${Object.keys(items.TYPES).length - 1} types (${EV.length} of them from catalog-everyday.js); the tables are the ports' own`)
		return
	}
	const checked = checkTables(EV_PRE, false)
	let added = 0
	for (const [name, d] of Object.entries(EV_PRE.materials)) {
		const { _ints, ...vals } = d
		if (!hasOwn(MATERIALS, name)) {
			items.define_material(name, vals, _ints)
			added++
		}
	}
	for (const [pair, kw] of EV_PRE.measured) items.measured(pair[0], pair[pair.length - 1], kw)
	for (const [k, v] of Object.entries(EV_PRE.looks)) if (!hasOwn(items.LOOKS, k)) items.add_look(k, v)
	for (const c of EV_PRE.categories) if (!items.CATEGORIES.includes(c)) items.CATEGORIES.push(c)
	EV_MODULE = await import(`${SIM}/catalog-everyday.js`)
	items.use_catalog_module("catalog_everyday", EV_MODULE.register_all)
	EV = [...EV_MODULE.KEYS]
	console.log(`  tables before catalog_everyday.py (items.py + catalog_items.py): ${added} materials added, ${EV_PRE.measured.length} measured pairs, ${Object.keys(EV_PRE.looks).length} looks; the ${checked} entries web/sim held already are Python's`)
	console.log(`  web/sim/catalog-everyday.js registered ${EV.length} types: ${EV.join(", ")}${EV_MODULE.CLASHES.length ? `; CLASHES: ${EV_MODULE.CLASHES.join(", ")}` : ""}`)
}

const EV_BALLS = ["apple", "orange", ...BALLS]
const EV_CONTAINERS = ["box", "plastic-cup", "glass-jar"]

/** A random scene of everyday items (and core ones), like randomScene() but with the everyday types most of the list. */
function evScene(n) {
	const pool = [...EV, ...EV, ...CORE]
	const list = []
	const cluster = chance(0.5)
	const cx = U(0.2, 2.8)
	const cy = U(0.05, 0.9)
	if (chance(0.6)) list.push({ id: "table", type: "table", x: 1.3, y: 0, props: chance(0.5) ? {} : propValues("table", "random") })
	while (list.length < n) {
		const type = pick(pool)
		const id = chance(0.1) ? pick(["Ball 1", "x", "a b", "é", "10", "2", "constructor", "__proto__"]) + list.length : `i${list.length}`
		const o = itemOf(id, type, propValues(type, "random"), chance(0.2) ? { held: chance(0.7) } : chance(0.1) ? { fixed: true } : {})
		if (cluster) {
			o.x = dp(cx + U(-0.4, 0.4), ri(2, 6))
			o.y = dp(cy + U(-0.1, 0.4), ri(2, 6))
		}
		if (chance(0.3)) o.name = pick(["Ball", "Dominoes", "the thing", "", "ss", "boss", "Bats", "Pencils", "Glass"])
		list.push(o)
	}
	const goals = []
	const ball = list.find((i) => EV_BALLS.includes(i.type))
	const box = list.find((i) => EV_CONTAINERS.includes(i.type))
	if (ball && box) goals.push({ kind: "in", item: ball.id, container: box.id, label: chance(0.5) ? "Land it" : "" })
	if (chance(0.3)) goals.push({ kind: pick(["in", "in", "on"]), item: pick(list).id, container: pick(list).id, label: pick(["", "L", undefined]) })
	return sceneOf(list, { goals, stage: randomStage(), seconds: pick([4.5, 2, 6, 10]), release: pick([0.5, 0, 1.25]) })
}

/** Every everyday type on its own on a table (as machines/test_everyday.py drops them): dropped flat, and (the dynamic ones) on a 5 degree slope; an open
 *  container gets an orange dropped above it. 2.5 s each. */
function evDropScenes() {
	const out = []
	const tbl = (angle = 0) => ({ id: "table", type: "table", x: 1.3, y: 0, angle, props: { width: 3.7, thickness: 0.15 } })
	for (const key of EV) {
		const t = items.TYPES[key]
		if (!t.dynamic) {
			out.push({ id: `drop-${key}`, scene: sceneOf([tbl(), { id: "thing", type: key, x: 1.3, y: 0, angle: 0 }, { id: "orange", type: "orange", x: 1.3, y: 0.45, angle: 0 }], { seconds: 2.5, goals: [{ kind: "in", item: "orange", container: "thing" }] }) })
			continue
		}
		out.push({ id: `drop-${key}`, scene: sceneOf([tbl(), { id: "thing", type: key, x: 1.3, y: 0.12, angle: 0 }], { seconds: 2.5 }) })
		out.push({ id: `slope-${key}`, scene: sceneOf([tbl(-5), { id: "thing", type: key, x: 0.8, y: 0.12, angle: -5 }], { seconds: 2.5 }) })
		if (key === "coffee-mug") out.push({ id: "mug-and-orange", scene: sceneOf([tbl(), { id: "thing", type: key, x: 1.3, y: 0.06, angle: 0 }, { id: "ball", type: "orange", x: 1.3, y: 0.4, angle: 0 }], { seconds: 2.5 }) })
	}
	return out
}

/** The scene files of web/scenarios and web/saved with the items this side has a type for (the others come with the other catalog ports). */
function evSceneFiles() {
	const known = (t) => typeof t === "string" && t in items.TYPES && t !== "probe"
	const out = []
	// (PARITY_SCENES=<dir>[:<dir>...] adds scene files from elsewhere: to try the scenario path before a scenario that uses everyday items is saved in web/)
	for (const dir of ["web/scenarios", "web/saved", ...(process.env.PARITY_SCENES ? process.env.PARITY_SCENES.split(":") : [])]) {
		const d = path.resolve(PG, dir)
		if (!fs.existsSync(d)) continue
		for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json")).sort()) {
			let s
			try {
				s = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))
			} catch {
				continue
			}
			if (!s || !Array.isArray(s.items)) continue
			const all = s.items.length
			const kept = s.items.filter((i) => known(i.type))
			const usesEv = kept.some((i) => EV.includes(i.type))
			out.push({ name: path.relative(PG, path.join(d, f)).startsWith("..") ? path.join(d, f) : path.relative(PG, path.join(d, f)), scene: { ...s, items: kept }, all, kept: kept.length, usesEv })
		}
	}
	return out
}

Object.assign(groups, {
	async "ev-tables"() {
		const post = askPython([{ id: "tables-after", op: "tables", ...(INTEGRATED ? {} : { at: "after" }) }])[0].res // (integrated: the whole server's)
		const n = checkTables(post, true, "ev-tables") // every material, measured pair and look: the same set, values and key order as Python's, nothing missing or extra
		const order = (what, a, b) => note("ev-tables", isDeepStrictEqual(a, b), `${what} order`, diff(a, b, what))
		order("materials", Object.keys(MATERIALS), Object.keys(post.materials))
		order("looks", Object.keys(items.LOOKS), Object.keys(post.looks))
		order("categories", items.CATEGORIES, post.categories)
		if (INTEGRATED) order("types registered", Object.keys(items.TYPES).filter((k) => k !== "probe"), post.types.filter((k) => k !== "probe"))
		else order("types registered", EV, post.types.filter((k) => !EV_PRE.types.includes(k)))
		note("ev-tables", EV_MODULE.CLASHES.length === 0, "no clashes with other modules' types", [`CLASHES ${EV_MODULE.CLASHES.join(", ")}`])
		const own = INTEGRATED ? askPython([{ id: "tables-after", op: "tables", at: "after" }])[0].res : post // (what catalog_everyday.py itself added)
		const mine = Object.keys(own.materials).filter((k) => !hasOwn(EV_PRE.materials, k))
		console.log(`  ev-tables: ${n} materials, measured pairs and looks (${mine.length} materials and ${Object.keys(own.looks).length - Object.keys(EV_PRE.looks).length} looks are catalog_everyday.py's own), ${EV.length} types, ${post.categories.length} categories: same set, same order`)
	},

	async "ev-catalog"() {
		const py = askPython([{ id: "catalog", op: "catalog" }])[0].res
		if (EXPORT) EV_CATALOG = { ...py, types: py.types.filter((t) => EV.includes(t.key)) } // (tools/parity/browser-everyday.mjs compares the page's catalog() with these)
		const js = items.catalog()
		let ds = diff(js.categories, py.categories.slice(0, js.categories.length), "categories") // (catalog_mechanisms.py adds its own after)
		const jsKeys = js.types.map((t) => t.key).filter((k) => k !== "probe")
		const pyKeys = py.types.map((t) => t.key).filter((k) => jsKeys.includes(k))
		ds = ds.concat(diff(jsKeys, pyKeys, "type order"))
		ds = ds.concat(diff(js.materials, Object.fromEntries(Object.keys(js.materials).map((k) => [k, py.materials[k]])), "materials"))
		ds = ds.concat(diff(js.looks, Object.fromEntries(Object.keys(js.looks).map((k) => [k, py.looks[k]])), "looks"))
		note("ev-catalog", ds.length === 0, "catalog() categories, order, materials, looks", ds)
		let withPreview = 0
		let solids = 0
		for (const t of js.types.filter((x) => x.key !== "probe")) {
			const pt = py.types.find((x) => x.key === t.key)
			const d = pt ? diff(t, pt, `types[${t.key}]`) : [`types[${t.key}]: missing from python`]
			note("ev-catalog", d.length === 0, t.key, d)
			if (EV.includes(t.key) && t.preview?.solids?.length) {
				withPreview++
				solids += t.preview.solids.length
			}
		}
		console.log(`  ev-catalog: ${js.types.length - 1} types compared with items.catalog() (the ${EV.length} everyday ones with their previews: ${withPreview} with solids, ${solids} solids in all); ${Object.keys(js.materials).length} materials, ${Object.keys(js.looks).length} looks`)
	},

	async "ev-types"() {
		const reqs = typeCases(EV)
		const res = compare("ev-types", reqs)
		const errors = res.filter((r) => r.py.error !== undefined).length
		const warns = res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0)
		const solids = res.reduce((a, r) => a + (r.py.doc?.solids.length ?? 0), 0)
		console.log(`  ev-types: ${reqs.length} scenes of ${EV.length} everyday types alone (default, min, max, below, above, 20 random prop sets, held/fixed, material and bounce/friction/rolling/side edits); ${solids} solids built, ${errors} refused as a BadScene (same message), ${warns} overlap warnings`)
	},

	async "ev-random"() {
		const N = QUICK ? 300 : 3000
		const reqs = []
		for (let i = 0; i < N; i++) reqs.push({ id: cid("ev-random"), op: "layout", scene: evScene(ri(2, 8)) })
		const res = compare("ev-random", reqs)
		const w = res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0)
		const errors = res.filter((r) => r.py.error !== undefined).length
		console.log(`  ev-random: ${N} scenes of 2-8 items (everyday and core types mixed), ${w} overlap warnings, ${errors} refused as a BadScene`)
	},

	async "ev-scenarios"() {
		const files = evSceneFiles()
		const reqs = []
		for (const f of files) {
			if (!f.kept) continue
			reqs.push({ id: `scenario ${f.name}${f.kept < f.all ? ` (${f.kept} of ${f.all} items: the types web/sim has)` : ""}`, op: "layout", scene: f.scene })
			reqs.push({ id: `scenario ${f.name} clean`, op: "clean", scene: f.scene })
		}
		compare("ev-scenarios", reqs)
		const using = files.filter((f) => f.usesEv)
		console.log(`  ev-scenarios: ${files.length} scene files (web/scenarios, web/saved) compared with the items web/sim has a type for; ${using.length} of them use everyday types${using.length ? `: ${using.map((f) => f.name).join(", ")}` : " (none yet: the drop and random scenes of ev-types, ev-random and ev-summary stand in)"}`)
	},

	async "ev-summary"() {
		const scenes = [...evDropScenes()]
		for (const f of evSceneFiles()) if (f.usesEv) scenes.push({ id: `scenario ${f.name}`, scene: f.scene })
		const N = QUICK ? 12 : 150
		for (let i = 0; i < N; i++) {
			const s = evScene(ri(2, 6))
			s.seconds = pick([1.5, 2.5, 3])
			s.release = pick([0.2, 0.5])
			scenes.push({ id: `summary-ev-random-${i}`, scene: s })
		}
		const tracks = await tracksFor(scenes.map((x) => x.scene), "ev-summary")
		const reqs = []
		scenes.forEach((x, i) => {
			if (tracks[i]) reqs.push({ id: x.id, op: "layout", scene: x.scene, track: tracks[i] })
		})
		const res = compare("ev-summary", reqs)
		const sum = (f) => res.reduce((a, r) => a + f(r.py.summary), 0)
		console.log(`  ev-summary: ${reqs.length} of ${scenes.length} scenes run on the engine (${evDropScenes().length} drops and slopes among them); ${sum((s) => s?.stories.length ?? 0)} stories, ${sum((s) => s?.events.length ?? 0)} events, ${sum((s) => s?.goals.length ?? 0)} goals (${sum((s) => s?.goals.filter((g) => g.ok).length ?? 0)} met) compared`)
	},

	async "ev-live"() {
		const base = "http://localhost:8790"
		let cat
		try {
			cat = await (await fetch(`${base}/api/catalog`)).json()
		} catch (e) {
			console.log(`  ev-live: server at ${base} not reachable (${e.message}); skipped`)
			return
		}
		const js = items.catalog()
		let bad = 0
		for (const t of js.types.filter((x) => EV.includes(x.key))) {
			const pt = cat.types.find((x) => x.key === t.key)
			const d = pt ? diff(t, pt, `types[${t.key}]`) : ["missing from the server"]
			note("ev-live catalog (running server)", d.length === 0, t.key, d)
			bad += d.length ? 1 : 0
		}
		console.log(`  ev-live: GET /api/catalog lists ${cat.types.length} types; the ${EV.length} everyday ones ${bad ? `DIFFER in ${bad} (the server may not have re-read machines/catalog_everyday.py: GET /api/catalog?reload=1)` : "match, previews included"}`)
		const post = async (url, scene) => {
			const r = await fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene }) })
			return r.json()
		}
		// /api/layout: random everyday scenes
		let nLayout = 0
		for (let i = 0; i < (QUICK ? 30 : 120); i++) {
			const sc = evScene(ri(2, 6))
			const sv = await post("/api/layout", sc)
			let mine
			try {
				mine = layout(sc)
			} catch (e) {
				mine = { error: e.message }
			}
			const d = diff(mine, sv)
			note("ev-live /api/layout (running server)", d.length === 0, `layout ${++nLayout}`, d, JSON.stringify(sc).slice(0, 300))
		}
		// /api/simulate: the scene files that use everyday types, and a few drops: the server's own track and summary
		const sims = [...evSceneFiles().filter((f) => f.usesEv).map((f) => ({ id: f.name, scene: f.scene })), ...evDropScenes().filter((_, i) => i % 3 === 0)]
		let nSim = 0
		for (const x of sims) {
			const sim = await post("/api/simulate", x.scene)
			if (sim.error !== undefined || sim.doc === undefined) {
				note("ev-live /api/simulate (running server)", false, x.id, [`server answered ${JSON.stringify(sim).slice(0, 150)}`])
				continue
			}
			const { scene: cs, doc, resolved } = prepare(wire(x.scene))
			const out = { doc, resolved, warnings: items.overlaps(cs, doc), summary: items.summarize(cs, doc, with_statics(sim.track)) }
			const ref = { doc: sim.doc, resolved: sim.resolved, warnings: sim.warnings, summary: sim.summary }
			note("ev-live /api/simulate (running server)", diff(out, ref).length === 0, x.id, diff(out, ref))
			nSim++
		}
		console.log(`  ev-live: ${nLayout} scenes through POST /api/layout and ${nSim} through POST /api/simulate (doc, resolved, warnings, and the summary made here from the server's own track)`)
	}
})

Object.assign(groups, {
	async "ev-angles"() {
		// (as the core "angles" group: round angles, where sin and cos are exactly 0, 1/2 or 1 and a position can land on a rounding tie, with round positions)
		const angles = [0, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120, 135, 150, -150, 180, -180, 210, 240, 270, 300, 315, 330, 360, -360, 540, 720, -720, 12.452, -13.999994540903613, 1e-9, 5.729e-11, 89.999999, 179.9999999, 0.25, 0.5, 359.75, 100.5, 37, -111]
		const xs = [0, 1.3, 0.5, -0.52, 3.12, 0.00001, 0.123455, 2.5, 0.015625, 0.000005, 0.1, 0.2]
		const ys = [0, 0.5, 0.7, 0.00001, 1.0, 0.015625, 0.000015, 0.25]
		const reqs = []
		for (const type of EV) {
			for (const a of angles) {
				for (let rep = 0; rep < (QUICK ? 1 : 2); rep++) {
					reqs.push({ id: cid(`ev-angle-${type}`), op: "layout", scene: sceneOf([{ id: "p", type, x: pick(xs), y: pick(ys), angle: a, ...(chance(0.3) ? { props: propValues(type, "random") } : {}) }]) })
				}
			}
		}
		compare("ev-angles", reqs)
		console.log(`  ev-angles: ${reqs.length} scenes of everyday types at round angles and round positions`)
	},

	async "ev-materials"() {
		// scenes in which many materials meet: the mixing rule, the measured pairs of catalog_items.py (steel, the woods), an item's own bounce, friction... scaling a pair
		const reqs = []
		const all = [...CORE.filter((t) => t !== "table"), ...EV].map((type, k) => ({ id: `i${k}`, type, x: (0.15 * k) % 3, y: 0.05 * (k % 11), angle: 0 }))
		reqs.push({ id: cid("ev-materials-all"), op: "layout", scene: sceneOf(all) })
		reqs.push({ id: cid("ev-materials-all-tilted"), op: "layout", scene: sceneOf(all.map((i, k) => ({ ...i, angle: (k * 37) % 360, props: propValues(i.type, "random") }))) })
		for (let n = 0; n < (QUICK ? 20 : 150); n++) {
			const list = []
			const count = ri(8, 30)
			for (let k = 0; k < count; k++) {
				const type = pick([...EV, ...EV, ...CORE.filter((t) => t !== "table")])
				list.push(itemOf(`i${k}`, type, propValues(type, "random")))
			}
			reqs.push({ id: cid("ev-materials-random"), op: "layout", scene: sceneOf(list) })
		}
		const res = compare("ev-materials", reqs)
		const contacts = res.reduce((a, r) => a + (r.py.doc?.contacts.length ?? 0), 0)
		console.log(`  ev-materials: ${reqs.length} scenes of 8-${all.length} items; ${contacts} contacts (pairs of materials) compared`)
	},

	async "ev-clean"() {
		// clean() on every everyday type's props: out of range, wrong kind, strings that are numbers, the choices; the messages name the prop by its label
		const garbage = () => pick([undefined, null, true, false, 0, 1, -1, 2.5, 1e30, -1e30, "7", "x", "", [], {}, [1], { a: 1 }, "1e3", "-0", " 4 ", "0.05", "yes", "no", 1e-9, 0.0001, { "@@float": "nan" }, { "@@float": "inf" }])
		const cases = []
		for (const type of EV) {
			const specs = items.TYPES[type].schema().props
			for (let i = 0; i < (QUICK ? 10 : 40); i++) {
				const props = {}
				for (const p of specs) {
					if (!chance(0.5)) continue
					if (p.kind === "number" || p.kind === "int") props[p.key] = pick([garbage(), p.min - 1, p.max + 1, String(U(p.min, p.max)), p.min, p.max, U(p.min, p.max), p.min - 1e-9, p.max + 1e-9, `${p.max}`, ` ${p.min} `])
					else if (p.kind === "bool") props[p.key] = pick([true, false, "yes", "no", 0, 1, "TRUE", " 1 ", 2, "maybe", garbage()])
					else props[p.key] = pick([p.choices[0], "gold", 5, ["x"], garbage()])
				}
				cases.push({ items: [{ id: "g", type, x: chance(0.7) ? U(0, 2) : garbage(), y: chance(0.7) ? U(0, 1) : garbage(), angle: chance(0.7) ? U(-180, 180) : garbage(), held: chance(0.7) ? undefined : garbage(), fixed: chance(0.7) ? undefined : garbage(), name: chance(0.8) ? undefined : garbage(), props }], seconds: chance(0.8) ? undefined : garbage(), release: chance(0.8) ? undefined : garbage() })
			}
		}
		const reqs = cases.map((scene) => ({ id: cid("ev-clean"), op: "clean", scene }))
		compare("ev-clean", reqs, { loose500: false })
		compare("ev-clean via layout", reqs.map((r) => ({ ...r, id: `${r.id}-layout`, op: "layout" })))
		console.log(`  ev-clean: ${cases.length} scenes with garbage in the props, x, y, angle, held, fixed, name, seconds and release of everyday items, through clean() and through layout()`)
	}
})

Object.assign(groups, {
	async "ev-corners"() {
		// every corner of the size sliders (each of a type's own numbers at its min or max), and each slider swept from its min to its max with the others at their defaults
		const MATERIAL_PROPS = ["bounce", "friction", "rolling", "side"]
		const reqs = []
		for (const type of EV) {
			const own = items.TYPES[type].schema().props.filter((p) => (p.kind === "number" || p.kind === "int") && !MATERIAL_PROPS.includes(p.key))
			const k = Math.min(own.length, 6)
			for (let mask = 0; mask < 1 << k; mask++) {
				const props = {}
				own.slice(0, k).forEach((p, i) => (props[p.key] = mask & (1 << i) ? p.max : p.min))
				reqs.push({ id: cid(`ev-corner-${type}-${mask}`), op: "layout", scene: sceneOf([itemOf("a", type, props)]) })
			}
			for (const p of own) {
				const steps = QUICK ? 12 : 40
				for (let i = 0; i <= steps; i++) {
					const v = i === 0 ? p.min : i === steps ? p.max : p.kind === "int" ? Math.round(p.min + ((p.max - p.min) * i) / steps) : dp(p.min + ((p.max - p.min) * i) / steps, 6)
					reqs.push({ id: cid(`ev-sweep-${type}-${p.key}-${i}`), op: "layout", scene: sceneOf([itemOf("a", type, { [p.key]: v })]) })
				}
				// a hair above the min and a hair below the max: the engine's 0.5 mm limit on a polygon's side is met just inside the range
				for (const v of [p.min * (1 + 1e-9), p.min + (p.max - p.min) * 1e-4, p.max - (p.max - p.min) * 1e-4, p.max * (1 - 1e-9)]) {
					reqs.push({ id: cid(`ev-edge-${type}-${p.key}`), op: "layout", scene: sceneOf([itemOf("a", type, { [p.key]: v })]) })
				}
			}
		}
		const res = compare("ev-corners", reqs)
		const errors = res.filter((r) => r.py.error !== undefined)
		console.log(`  ev-corners: ${reqs.length} scenes (every min/max corner of each type's own sliders, and each slider swept along its range); ${errors.length} refused as a BadScene on both sides${errors.length ? `, e.g. ${errors[0].py.error.slice(0, 160)}` : ""}`)
	}
})

Object.assign(groups, {
	async "ev-raw"() {
		// what clean() would clamp: sizes and weights no slider reaches, straight into items.build() (op "raw": the scene is not cleaned). A polygon the engine refuses is a
		// ValueError whose text names the solid and the side (and prints its numbers); a division by zero is a ZeroDivisionError; the same text on both sides
		const MATERIAL_PROPS = ["bounce", "friction", "rolling", "side"]
		const reqs = []
		for (const type of EV) {
			const own = items.TYPES[type].schema().props.filter((p) => (p.kind === "number" || p.kind === "int") && !MATERIAL_PROPS.includes(p.key))
			if (!own.length) continue // (the bowling pin has no sliders of its own)
			const weird = (p) => pick([0, 1e-7, 1e-5, 1e-4, p.min * 0.1, p.min * 0.5, p.min * 0.9, p.min * 0.99, p.min * 0.999, -p.min, -1, p.max * 10, 1e3, 1e6, p.default * 1e-3, p.default * 0.01, p.default * 0.1, p.default * 3, 5e-4, 6e-4])
			for (let i = 0; i < (QUICK ? 15 : 60); i++) {
				const props = {}
				for (const p of own) if (chance(i < 20 ? 0.34 : 0.7)) props[p.key] = weird(p)
				if (!Object.keys(props).length) props[pick(own).key] = weird(pick(own))
				reqs.push({ id: cid(`ev-raw-${type}`), op: "raw", scene: sceneOf([itemOf("a", type, props)]), probe: {} })
			}
			// one prop at a time at the sizes where a side passes 0.5 mm (bisect-ish: every 5 % of the min up to 3 times it)
			for (const p of own) for (let f = 0; f <= 3; f += 0.05) reqs.push({ id: cid(`ev-raw-${type}-${p.key}`), op: "raw", scene: sceneOf([itemOf("a", type, { [p.key]: p.min * f })]), probe: {} })
		}
		const res = compare("ev-raw", reqs)
		const kinds = {}
		for (const r of res) if (r.py.exc) kinds[r.py.exc] = (kinds[r.py.exc] ?? 0) + 1
		console.log(`  ev-raw: ${reqs.length} scenes built without clean(); python raises ${JSON.stringify(kinds)} (the same exception and message here)`)
	}
})

Object.assign(groups, {
	async sprites() {
		// A ball type's sprite is one picture of one body: the engine refuses a document where two solids share a sprite but differ in body or words.
		// Balls of the three sprite types that differ only in what changes the body (hollow, wall, a hair of diameter) or not (weight, colour, held),
		// side by side: Python's document and this one must be the same, the engine must admit it (each scene is run), and a ball with no props of its
		// own keeps the type's sprite (so the default scenes' documents do not change).
		const SPRITE = { superball: "rubber", "plastic-ball": "plastic", "clay-ball": "clay" }
		const hair = [1e-10, -1e-10, 5e-10, -5e-10, 9e-10, 1e-9, -1e-9, 2e-9]
		const variants = (type) => {
			const v = [{}, { mass: 0.01 }, { color: "#123456" }, { diameter: 0.07 }, ...hair.map((h) => ({ diameter: 0.06 + h }))]
			if (type === "plastic-ball") {
				const spec = items.TYPES[type].schema().props.find((p) => p.key === "wall")
				v.push({ hollow: false }, { hollow: true }, { wall: 0.0006 }, { wall: 0.0005 }, { wall: 0.001 }, { wall: spec.min }, { wall: spec.max }, { hollow: false, wall: 0.001 },
					{ hollow: false, diameter: 0.06 + 1e-10 }, { wall: 0.0006, diameter: 0.06 + 1e-10 }, { hollow: false, mass: 0.02 }, { wall: 0.0006, mass: 0.004 })
			} else {
				// (a solid type lists neither prop; clean() keeps an unlisted bool, number or short string, and the builder reads both)
				v.push({ hollow: true }, { hollow: true, wall: 0.001 }, { hollow: "yes", wall: 0.002 }, { hollow: false, wall: 0.001 }, { wall: 0.001 }, { hollow: 1, wall: 0 }, { hollow: true, wall: 0.0015, mass: 0.05 })
			}
			return v
		}
		const reqs = []
		const ball = (id, type, props, x) => ({ id, type, x, y: 0.4, angle: 0, ...(Object.keys(props).length ? { props } : {}) })
		for (const type of BALLS) {
			const v = variants(type)
			for (let i = 0; i < v.length; i++) {
				for (let k = i; k < v.length; k++) {
					// the default ball first, last and between, so the engine's first holder of the sprite is each kind of ball in turn
					const list = [ball("a", type, v[i], 0.3), ball("b", type, v[k], 0.6)]
					if (chance(0.5)) list.push(ball("c", type, {}, 0.9))
					if (chance(0.3)) list.reverse()
					reqs.push({ id: cid(`sprites-${type}`), op: "layout", scene: sceneOf([{ id: "table", type: "table", x: 1.3, y: 0, angle: 0 }, ...list], { seconds: 0.5 }) })
				}
			}
		}
		// all three types at once, each a default ball beside a random variant of its own type
		for (let n = 0; n < (QUICK ? 30 : 120); n++) {
			const list = []
			for (const type of BALLS) list.push(ball(`${type}-0`, type, {}, 0.2 + list.length * 0.25), ball(`${type}-1`, type, pick(variants(type)), 0.2 + (list.length + 1) * 0.25))
			reqs.push({ id: cid("sprites-mixed"), op: "layout", scene: sceneOf([{ id: "table", type: "table", x: 1.3, y: 0, angle: 0 }, ...list.sort(() => rng() - 0.5)], { seconds: 0.5 }) })
		}
		const res = compare("sprites", reqs)
		// every default ball keeps its type's sprite; every other ball has it only when its body is the default one's
		let kept = 0
		let dropped = 0
		for (const r of res) {
			if (!r.js.doc) continue
			const byItem = new Map(r.req.scene.items.map((i) => [i.id, i]))
			const d = []
			for (const sld of r.js.doc.solids) {
				const it = byItem.get(sld.item)
				if (!it || !(it.type in SPRITE)) continue
				if (sld.sprite !== undefined) kept++
				else dropped++
				if (!it.props && sld.sprite !== SPRITE[it.type]) d.push(`${sld.id}: a default ${it.type} has sprite ${sld.sprite}, not ${SPRITE[it.type]}`)
			}
			note("sprites (default keeps it)", d.length === 0, r.req.id, d)
		}
		// the engine admits every one (its admission is where "shares sprite" is refused)
		const tracks = await tracksFor(reqs.map((r) => r.scene), "sprites")
		reqs.forEach((r, i) => note("sprites (engine admits)", tracks[i] !== null, r.id, tracks[i] !== null ? [] : ["the engine refused it (run with --verbose for why)"], JSON.stringify(r.scene).slice(0, 300)))
		console.log(`  sprites: ${reqs.length} scenes of sprite balls side by side; ${kept} balls drawn with the type's sprite, ${dropped} without; the engine ran ${tracks.filter((t) => t !== null).length} of ${reqs.length}`)
	},

	async overlapties() {
		// A 3 mm plank through a domino, a wall or a box wall (and a 3 mm domino or box wall through a plank): the overlap depth is the 3 mm tolerance
		// itself, give or take the last bit of the sin and cos of a non-round angle, where V8 and CPython's libm differ for a few percent of angles.
		// overlaps() compares round(depth, 9) on both sides, so the warnings must be the same.
		const reqs = []
		const N = QUICK ? 400 : 3000
		for (let i = 0; i < N; i++) {
			const angle = dp(U(-50, 50), ri(1, 7))
			const x = dp(U(0.3, 2.7), 3)
			const y = dp(U(0.25, 1.4), 3)
			const k = i % 5
			let list
			if (k === 0) list = [{ id: "p", type: "plank", x, y, angle, props: { thickness: 0.003, length: 0.4, legs: false } }, { id: "d", type: "domino", x, y: y - 0.025, angle: 0 }]
			else if (k === 1) list = [{ id: "p", type: "plank", x, y, angle, props: { thickness: 0.003, length: 0.4, legs: false } }, { id: "w", type: "wall", x, y: y - 0.3, angle: 0, props: { height: 0.6, thickness: pick([0.05, 0.02, 0.1]) } }]
			else if (k === 2) list = [{ id: "p", type: "plank", x, y, angle, props: { thickness: 0.003, length: 0.4, legs: false } }, { id: "b", type: "box", x, y: y - 0.06, angle: 0, props: { thickness: 0.02, wall: 0.12, width: 0.3, hung: false } }]
			else if (k === 3) list = [{ id: "d", type: "domino", x, y: y - 0.1, angle, props: { thickness: 0.003, height: 0.25 } }, { id: "p", type: "plank", x, y, angle: 0, props: { thickness: 0.02, length: 0.4, legs: false } }]
			// (a box's 3 mm floor, turned about its middle, through a wall standing under that middle; the box's own walls stay clear of it)
			else list = [{ id: "b", type: "box", x, y, angle, props: { thickness: 0.003, wall: 0.12, width: 0.3, hung: false } }, { id: "w", type: "wall", x, y: y - 0.3, angle: 0, props: { height: 0.6, thickness: 0.05 } }]
			reqs.push({ id: cid("overlapties"), op: "layout", scene: sceneOf(list, { stage: { ...STAGE } }) })
		}
		const res = compare("overlapties", reqs)
		let onTol = 0
		let noisy = 0
		for (const r of res) {
			if (!r.js.doc) continue
			const world = items._world_poses(r.js.doc)
			const S = r.js.doc.solids
			let tie = false
			let off = false
			for (let a = 0; a < S.length; a++) {
				for (let b = a + 1; b < S.length; b++) {
					if (S[a].item === S[b].item) continue
					const d = items._overlap_depth(S[a], world.get(S[a].id), S[b], world.get(S[b].id))
					if (Math.abs(d - OVERLAP_TOL) < 1e-9) {
						tie = true
						if (d !== OVERLAP_TOL) off = true
					}
				}
			}
			if (tie) onTol++
			if (off) noisy++
		}
		const w = res.reduce((a, r) => a + (r.py.warnings?.length ?? 0), 0)
		console.log(`  overlapties: ${reqs.length} scenes; ${onTol} have a pair within 1e-9 m of the 3 mm tolerance (${noisy} of them off it in the last bits); ${w} warnings`)
		note("overlapties (the cases are ties)", onTol >= reqs.length * 0.9, "count", [`only ${onTol} of ${reqs.length} scenes put a pair on the tolerance`])
	}
})

// ---------------------------------------------------------------- run
async function main() {
	const t0 = Date.now()
	const v = askPython([{ id: "v", op: "version" }], MODE)[0].res
	console.log(`python ${v.python.split("|")[0].trim()} (${v.platform}); node ${process.version}; mode ${MODE}; seed ${SEED}${QUICK ? "; quick" : ""}`)
	for (const f of ["machines/items.py", "machines/catalog_items.py", "machines/catalog_everyday.py", "machines/catalog_mechanisms.py", "web/server.py"]) {
		const st = fs.statSync(path.join(PG, f))
		console.log(`  ${f.padEnd(34)} ${st.size} bytes, modified ${st.mtime.toISOString().slice(0, 19)}`)
	}
	if (MODE === "server") loadTables()
	if (MODE === "everyday") await loadEveryday()
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
		if (EXPORT) {
			// (JSON would turn -0 into 0: keep the sign of zero the way browser.mjs reads it back)
			fs.writeFileSync(EXPORT, JSON.stringify({ mode: MODE, cases: exported, tables: EV_PRE, catalog: EV_CATALOG }, (_k, v) => (typeof v === "number" && Object.is(v, -0) ? { "@@float": "-0" } : v)))
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
	console.log(`${"total".padEnd(35)}${String(total).padStart(8)}${String(bad).padStart(12)}   (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
	process.exit(bad ? 1 : 0)
}
main().catch((e) => {
	console.error(e)
	process.exit(2)
})
