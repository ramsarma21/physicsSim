// Replays the mechanisms cases in a real browser (headless Chromium, never a visible window): web/sim as the page loads it (ES modules over HTTP from a
// throwaway static server on 127.0.0.1), with web/sim/catalog-mechanisms.js registered on the tables python holds just before catalog_mechanisms.py, the answers
// compared with Python's.
//   node tools/parity/browser-mechanisms.mjs [--keep file.json]
// It first has mechanisms.mjs write the cases (every type alone, sweeps, corners, ties, angles, random and dense scenes, garbage, the scenario files) and Python's answers
// and catalog entries, then runs clean()/layout() on each in the page and catalog() for the mechanisms types, and diffs the answers number by number, the sign of
// zero included. Also times the page's catalog(). Then (unless --no-engine, or the server at localhost:8790 is not up) the whole pipeline the app runs with
// ?engine=browser: web/sim/api.js's local API in a fresh page (index.js: all three catalog ports registered; the engine in a Web Worker) simulates the scenario files
// that use mechanisms types and each mechanisms type dropped on a table, and doc, resolved, warnings, summary and the TRACK are compared (by digest) with what the
// running server's POST /api/simulate answers for the same scene (read only): the same physics in the browser as in the server. Uses the playwright-core in ~/.bun/install/cache (the same Chromium the other agents drive) with `headless: true` only.
import { execFileSync } from "../child-sync.mjs" // (node's, with the input given to the child as a file: a macOS hang, tools/child-sync.mjs)
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = path.resolve(HERE, "../..")
const args = process.argv.slice(2)
const noEngine = args.includes("--no-engine")
const keep = args.includes("--keep") ? args[args.indexOf("--keep") + 1] : null
const casesFile = keep ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "browser-mech-")), "cases.json")
execFileSync("node", [path.join(HERE, "mechanisms.mjs"), "--quick", "--groups", "registration,tables,catalog,types,sweeps,corners,ties,angles,random,dense,clean,scenarios", "--export", casesFile], { cwd: PG, stdio: "inherit", maxBuffer: 1 << 28 })
const reviveFile = (v) => {
	if (Array.isArray(v)) return v.map(reviveFile)
	if (v && typeof v === "object") {
		const ks = Object.keys(v)
		if (ks.length === 1 && ks[0] === "@@float" && v["@@float"] === "-0") return -0
		return Object.fromEntries(ks.map((k) => [k, reviveFile(v[k])]))
	}
	return v
}
const data = JSON.parse(fs.readFileSync(casesFile, "utf8"))
const cases = data.cases.map((c) => ({ ...c, py: reviveFile(c.py) }))
// python's catalog entries of the mechanisms types, for the page's catalog() to be compared with
// (no physics module, machines/mod_*.py, as in mechanisms.mjs: a module's common props, e.g. mechanics' start speed and paint, are not the port's)
const pyCatalog = JSON.parse(execFileSync("python3", ["-I", path.join(HERE, "py_dump.py"), "--mode", "server"], { input: JSON.stringify({ id: "c", op: "catalog" }) + "\n", cwd: PG, encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, PLAYGROUND_MODULES: "" } }).trim()).res

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")

const TYPES = { ".js": "text/javascript", ".json": "application/json", ".html": "text/html" }
const server = http.createServer((req, res) => {
	const u = decodeURIComponent(new URL(req.url, "http://x").pathname)
	if (u === "/") {
		res.writeHead(200, { "content-type": "text/html" })
		return res.end("<!doctype html><meta charset=utf-8><title>parity</title>")
	}
	const f = path.join(PG, "web", u)
	if (!f.startsWith(path.join(PG, "web", "sim")) || !fs.existsSync(f)) {
		res.writeHead(404)
		return res.end()
	}
	res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", "cache-control": "no-store" })
	res.end(fs.readFileSync(f))
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const base = `http://127.0.0.1:${server.address().port}`

// The playwright-core in the cache looks for chromium_headless_shell-1223; what is installed is revision 1248, so name its executable.
const shell = path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell")
const browser = await chromium.launch({ headless: true, ...(fs.existsSync(shell) ? { executablePath: shell } : {}) })
let bad = 0
try {
	const page = await browser.newPage()
	if (process.env.PLAYGROUND_MODULES !== undefined) await page.addInitScript((v) => { globalThis.PLAYGROUND_MODULES = v }, process.env.PLAYGROUND_MODULES) // (the physics modules the page loads: as node's)
	const errors = []
	page.on("pageerror", (e) => errors.push(e.message))
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
	await page.goto(base)
	const out = await page.evaluate(async (json) => {
		const { cases: cs, pre, types } = JSON.parse(json) // (as text: page.evaluate's own argument encoding would turn an own "__proto__" key into a prototype)
		const { clean, BadScene } = await import("/sim/clean.js")
		const { layout } = await import("/sim/layout.js")
		const items = await import("/sim/items.js")
		const { MATERIALS } = await import("/sim/materials.js")
		// the tables python holds just before catalog_mechanisms.py registers (the other catalog ports are other work), then the module, as index.js does
		const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
		for (const [name, d] of Object.entries(pre.materials)) {
			const { _ints, ...vals } = d
			if (!has(MATERIALS, name)) items.define_material(name, vals, _ints)
		}
		for (const [pair, kw] of pre.measured) items.measured(pair[0], pair[pair.length - 1], kw)
		for (const [k, v] of Object.entries(pre.looks)) if (!has(items.LOOKS, k)) items.add_look(k, v)
		for (const c of pre.categories) if (!items.CATEGORIES.includes(c)) items.CATEGORIES.push(c)
		const before = new Set(Object.keys(items.TYPES))
		const mod = await import("/sim/catalog-mechanisms.js")
		items.use_catalog_module("catalog_mechanisms", mod.register_all)
		const registered = Object.keys(items.TYPES).filter((k) => !before.has(k))
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
			const scene = c.req.scene === undefined ? undefined : revive(JSON.parse(JSON.stringify(c.req.scene)))
			let a
			try {
				a = c.req.op === "clean" ? { ok: clean(scene) } : layout(scene)
			} catch (e) {
				a = e instanceof BadScene ? { error: e.message } : { error500: `${e.name}: ${e.message}` }
			}
			answers.push(JSON.stringify(a, enc))
		}
		const ms = performance.now() - t0
		const t1 = performance.now()
		const cat = items.catalog()
		const catalogMs = performance.now() - t1
		return { answers, ms, catalogMs, registered, catalog: JSON.stringify(cat.types.filter((t) => types.includes(t.key)), enc), userAgent: navigator.userAgent }
	}, JSON.stringify({ cases: cases.map((c) => ({ req: c.req })), pre: data.pre, types: data.types }))
	console.log(`browser: ${out.userAgent.match(/(Headless)?Chrome\/[\d.]+/)?.[0]}; ${cases.length} cases in ${out.ms.toFixed(0)} ms in the page; catalog() ${out.catalogMs.toFixed(0)} ms; ${out.registered.length} types registered`)
	if (errors.length) console.log("page errors:", errors.slice(0, 5))
	const revive = (v) => {
		if (Array.isArray(v)) return v.map(revive)
		if (v && typeof v === "object") {
			const ks = Object.keys(v)
			if (ks.length === 1 && ks[0] === "@@float") return { "-0": -0, nan: NaN, inf: Infinity, "-inf": -Infinity }[v["@@float"]]
			return Object.fromEntries(ks.map((k) => [k, revive(v[k])]))
		}
		return v
	}
	const isObj = (v) => v !== null && typeof v === "object"
	const diff = (a, b, p = "", o = []) => {
		if (o.length > 5) return o
		if (typeof a === "number" && typeof b === "number") {
			if (!Object.is(a, b)) o.push(`${p}: ${a} vs ${b}`)
		} else if (Array.isArray(a) && Array.isArray(b)) {
			if (a.length !== b.length) o.push(`${p}: length`)
			for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${p}[${i}]`, o)
		} else if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
			const ka = Object.keys(a)
			const kb = Object.keys(b)
			if (ka.join("\0") !== kb.join("\0")) o.push(`${p}: keys ${ka.slice(0, 5)} vs ${kb.slice(0, 5)}`)
			for (const k of ka) if (kb.includes(k)) diff(a[k], b[k], `${p}.${k}`, o)
		} else if (a !== b) o.push(`${p}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`)
		return o
	}
	const per = {}
	const tally = (g, d, id) => {
		const r = (per[g] ??= { n: 0, bad: 0 })
		r.n++
		if (d.length) {
			r.bad++
			bad++
			if (bad <= 8) console.log(`  MISMATCH ${id}: ${d.slice(0, 3).join(" | ")}`)
		}
	}
	cases.forEach((c, i) => {
		const js = revive(JSON.parse(out.answers[i]))
		const py = c.py
		tally(c.group, py.error500 !== undefined && js.error500 !== undefined ? [] : diff(js, py), c.req.id)
	})
	tally("registration", diff(out.registered, data.types), "types registered")
	const jsCatalog = revive(JSON.parse(out.catalog))
	for (const t of jsCatalog) tally("catalog (incl. previews)", diff(t, pyCatalog.types.find((x) => x.key === t.key)), t.key)
	for (const [g, r] of Object.entries(per)) console.log(`  ${g.padEnd(24)} ${String(r.n).padStart(5)} cases, ${r.bad} mismatches`)
	// ---- the whole pipeline of ?engine=browser against the running server
	if (!noEngine) {
		const base8790 = process.env.PARITY_SERVER ?? "http://localhost:8790"
		let up = true
		try {
			await fetch(`${base8790}/api/catalog`)
		} catch {
			up = false
			console.log(`engine: the server at ${base8790} is not reachable; skipped`)
		}
		if (up) {
			const keys = data.types
			const known = (t) => typeof t === "string" // (index.js has every catalog port; a scene file's items all stay)
			const scenes = []
			for (const f of fs.readdirSync(path.join(PG, "web/scenarios")).filter((x) => x.endsWith(".json")).sort()) {
				const sc = JSON.parse(fs.readFileSync(path.join(PG, "web/scenarios", f), "utf8"))
				if (sc.items.some((i) => keys.includes(i.type)) && sc.items.every((i) => known(i.type))) scenes.push({ name: `scenarios/${f}`, scene: sc })
			}
			const stage = { x0: -0.55908203125, x1: 3.19091796875, y0: -0.15625, y1: 2.34375 }
			for (const type of keys) {
				const dyn = type !== "conveyor-belt"
				scenes.push({ name: `drop ${type}`, scene: { version: 2, id: "t", name: "t", seconds: 2.5, release: 0.5, stage, goals: [], items: [{ id: "table", type: "table", x: 1.3, y: 0, angle: 0 }, { id: "thing", type, x: 1.3, y: dyn ? 0.9 : 0, angle: 0 }, { id: "ball", type: "superball", x: 1.25, y: 1.6, angle: 0 }] } })
			}
			const canon = (v) => (v === null || typeof v !== "object" ? (Object.is(v, -0) ? "-0" : JSON.stringify(v)) : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`)
			const digestOf = async (x) => Buffer.from(await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode(canon(x)))).toString("hex")
			const parts = ["doc", "resolved", "warnings", "summary", "track"]
			const want = []
			for (const { scene } of scenes) {
				const r = await fetch(`${base8790}/api/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scene }) })
				const sim = await r.json()
				want.push(r.status === 200 ? Object.fromEntries(await Promise.all(parts.map(async (k) => [k, await digestOf(sim[k])]))) : { error: sim.error })
			}
			const page2 = await browser.newPage()
			if (process.env.PLAYGROUND_MODULES !== undefined) await page2.addInitScript((v) => { globalThis.PLAYGROUND_MODULES = v }, process.env.PLAYGROUND_MODULES) // (the physics modules the page loads: as node's)
			const errors2 = []
			page2.on("pageerror", (e) => errors2.push(e.message))
			page2.on("console", (m) => m.type() === "error" && errors2.push(m.text()))
			await page2.goto(base)
			const got = await page2.evaluate(async ({ list, partsList }) => {
				const { createLocalApi } = await import("/sim/api.js")
				const { createEngine } = await import("/sim/engine.js")
				const engine = createEngine()
				const api = createLocalApi({ engine })
				const canon = (v) => (v === null || typeof v !== "object" ? (Object.is(v, -0) ? "-0" : JSON.stringify(v)) : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`)
				const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
				const out = []
				const t0 = performance.now()
				for (const { scene } of list) {
					try {
						const sim = await api("/api/simulate", { scene })
						const d = {}
						for (const k of partsList) d[k] = hex(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(canon(sim[k]))))
						out.push({ d, mode: engine.mode, frames: sim.track.frames.length })
					} catch (e) {
						out.push({ error: e.message })
					}
				}
				engine.terminate()
				return { out, ms: performance.now() - t0 }
			}, { list: scenes.map((x) => ({ scene: x.scene })), partsList: parts })
			let mism = 0
			scenes.forEach((x, i) => {
				const g = got.out[i]
				const w = want[i]
				const bad2 = g.error || w.error ? g.error !== w.error : parts.filter((k) => g.d[k] !== w[k])
				const isBad = g.error || w.error ? bad2 : bad2.length > 0
				if (isBad) {
					mism++
					bad++
					console.log(`  ENGINE MISMATCH ${x.name}: ${g.error || w.error ? `page: ${g.error}, server: ${w.error}` : `differs in ${bad2.join(", ")}`}`)
				}
			})
			const frames = got.out.reduce((a, g) => a + (g.frames ?? 0), 0)
			console.log(`engine: ${scenes.length} scenes (${frames} frames) through the page's local API (${got.out[0]?.mode} engine, ${got.ms.toFixed(0)} ms) against the running server's /api/simulate: doc, resolved, warnings, summary and track digests: ${mism ? `${mism} DIFFER` : "all identical"}`)
			if (errors2.length) console.log("page errors:", errors2.slice(0, 5))
		}
	}
} finally {
	await browser.close()
	server.close()
	if (!keep) fs.rmSync(path.dirname(casesFile), { recursive: true, force: true })
}
console.log(bad ? `${bad} mismatches` : "the browser answers every case exactly as Python does")
process.exit(bad ? 1 : 0)
