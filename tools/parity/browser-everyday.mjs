// Replays the everyday-catalog cases in a real browser (headless Chromium, never a visible window): web/sim/catalog-everyday.js loaded as the page would
// load it (ES modules over HTTP from a throwaway static server on 127.0.0.1), the answers compared with Python's.
//   node tools/parity/browser-everyday.mjs [--keep file.json]
// core.mjs --mode everyday writes the cases (each everyday type alone: default, min, max, below, above, random props; at round angles; mixed scenes of
// everyday and core items with many materials; clean() on garbage props; random mixed scenes), Python's answers, py_dump.py's tables "before" catalog_everyday.py
// and Python's catalog for the everyday types. Two pages then run them:
//   page 1  web/sim/items.js with those tables defined on it, and catalog-everyday.js registered on top (what the module alone does)
//   page 2  web/sim/index.js as the app imports it (catalog-items.js, catalog-everyday.js and catalog-mechanisms.js: the ports' own tables)
// Each page answers clean()/layout() for every case and catalog() once; they are diffed number by number, the sign of zero included.
// Uses the playwright-core in ~/.bun/install/cache (the same Chromium the other agents drive) with `headless: true` only.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PG = path.resolve(HERE, "../..")
const args = process.argv.slice(2)
const keep = args.includes("--keep") ? args[args.indexOf("--keep") + 1] : null
const casesFile = keep ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "browser-ev-")), "cases.json")
execFileSync("node", [path.join(HERE, "core.mjs"), "--mode", "everyday", "--groups", "ev-catalog,ev-types,ev-corners,ev-angles,ev-materials,ev-clean,ev-random,ev-scenarios", "--export", casesFile], {
	cwd: PG, stdio: ["ignore", "ignore", "inherit"], maxBuffer: 1 << 28
})
const reviveFile = (v) => {
	if (Array.isArray(v)) return v.map(reviveFile)
	if (v && typeof v === "object") {
		const ks = Object.keys(v)
		if (ks.length === 1 && ks[0] === "@@float" && v["@@float"] === "-0") return -0
		return Object.fromEntries(ks.map((k) => [k, reviveFile(v[k])]))
	}
	return v
}
const exported = JSON.parse(fs.readFileSync(casesFile, "utf8"))
const cases = exported.cases.map((c) => ({ ...c, py: reviveFile(c.py) }))
const pyCatalog = reviveFile(exported.catalog)

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
		if (a.length !== b.length) o.push(`${p}: length ${a.length} vs ${b.length}`)
		for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${p}[${i}]`, o)
	} else if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
		const ka = Object.keys(a)
		const kb = Object.keys(b)
		if (ka.join("\0") !== kb.join("\0")) o.push(`${p}: keys ${ka.slice(0, 5)} vs ${kb.slice(0, 5)}`)
		for (const k of ka) if (kb.includes(k)) diff(a[k], b[k], `${p}.${k}`, o)
	} else if (a !== b) o.push(`${p}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`)
	return o
}

// the physics modules whose catalog-wide props core.mjs registered on the port here (their JS file's register_catalog_wide; core.mjs loadCatalogWide)
const simDir = path.join(PG, "web/sim/modules")
const onlyMods = process.env.PLAYGROUND_MODULES === undefined ? null : process.env.PLAYGROUND_MODULES.split(",").map((s) => s.trim()).filter(Boolean)
const wide = (fs.existsSync(simDir) ? fs.readdirSync(simDir).filter((f) => f.endsWith(".js")).sort() : [])
	.map((f) => f.slice(0, -3))
	.filter((n) => (onlyMods === null || onlyMods.includes(n)) && /export function register_catalog_wide\b/.test(fs.readFileSync(path.join(simDir, `${n}.js`), "utf8")))

let bad = 0
try {
	for (const config of ["items.js + tables + catalog-everyday.js", "index.js (all three ports)"]) {
		const integrated = config.startsWith("index.js")
		const page = await browser.newPage()
		if (process.env.PLAYGROUND_MODULES !== undefined) await page.addInitScript((v) => { globalThis.PLAYGROUND_MODULES = v }, process.env.PLAYGROUND_MODULES) // (the physics modules the page loads: as node's)
		const errors = []
		page.on("pageerror", (e) => errors.push(e.message))
		page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
		await page.goto(base)
		const out = await page.evaluate(async ({ casesJson, tablesJson, integrated, wide }) => {
			const rev = (v) => {
				if (Array.isArray(v)) return v.map(rev)
				if (v && typeof v === "object") {
					const ks = Object.keys(v)
					if (ks.length === 1 && ks[0] === "@@float") return { nan: NaN, inf: Infinity, "-inf": -Infinity }[v["@@float"]]
					const o = {}
					for (const k of ks) Object.defineProperty(o, k, { value: rev(v[k]), enumerable: true, writable: true, configurable: true })
					return o
				}
				return v
			}
			const items = await import("/sim/items.js")
			let keys
			if (integrated) {
				await import("/sim/index.js")
				keys = (await import("/sim/catalog-everyday.js")).KEYS
			} else {
				const pre = JSON.parse(tablesJson)
				for (const [name, d] of Object.entries(pre.materials)) {
					const { _ints, ...vals } = d
					if (!Object.prototype.hasOwnProperty.call(items.MATERIALS, name)) items.define_material(name, vals, _ints)
				}
				for (const [pair, kw] of pre.measured) items.measured(pair[0], pair[pair.length - 1], kw)
				for (const [k, v] of Object.entries(pre.looks)) if (!Object.prototype.hasOwnProperty.call(items.LOOKS, k)) items.add_look(k, v)
				for (const c of pre.categories) if (!items.CATEGORIES.includes(c)) items.CATEGORIES.push(c)
				const mod = await import("/sim/catalog-everyday.js")
				items.use_catalog_module("catalog_everyday", mod.register_all)
				for (const name of wide) (await import(`/sim/modules/${name}.js`)).register_catalog_wide(items.FRAMEWORK)
				keys = mod.KEYS
			}
			const { clean, BadScene } = await import("/sim/clean.js")
			const { layout } = await import("/sim/layout.js")
			const cs = JSON.parse(casesJson)
			const enc = (_k, v) => (typeof v === "number" && Object.is(v, -0) ? { "@@float": "-0" } : v)
			const answers = []
			const t0 = performance.now()
			for (const c of cs) {
				const scene = c.req.scene === undefined ? undefined : rev(JSON.parse(JSON.stringify(c.req.scene)))
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
			return { answers, ms, catalog: JSON.stringify({ categories: cat.categories, materials: cat.materials, looks: cat.looks, types: cat.types.filter((t) => keys.includes(t.key)) }, enc), catalogMs, catalogTypes: cat.types.length, userAgent: navigator.userAgent }
		}, { casesJson: JSON.stringify(cases.map((c) => ({ req: c.req }))), tablesJson: JSON.stringify(exported.tables), integrated, wide })
		console.log(`${config}: ${out.userAgent.match(/(Headless)?Chrome\/[\d.]+/)?.[0]}; ${cases.length} cases in ${out.ms.toFixed(0)} ms in the page; catalog() ${out.catalogMs.toFixed(0)} ms (${out.catalogTypes} types)`)
		if (errors.length) console.log("  page errors:", errors.slice(0, 5))
		const per = {}
		cases.forEach((c, i) => {
			const js = revive(JSON.parse(out.answers[i]))
			const py = c.py
			const d = py.error500 !== undefined && js.error500 !== undefined ? [] : diff(js, py)
			const r = (per[c.group] ??= { n: 0, bad: 0, warningsOnly: 0 })
			r.n++
			// (an overlap warning at exactly the 3 mm tolerance once differed by the last bit of sin/cos; overlaps() now compares round(depth, 9) on both
			// sides, so a difference only in the warnings is counted like any other, and named so it is easy to recognise)
			if (d.length && d.every((x) => x.startsWith(".warnings"))) {
				r.warningsOnly++
				console.log(`  (only the overlap warnings differ, ${c.req.id}: ${d[0]})`)
			}
			if (d.length) {
				r.bad++
				bad++
				if (bad <= 8) console.log(`  MISMATCH ${c.req.id}: ${d.slice(0, 3).join(" | ")}`)
			}
		})
		for (const [g, r] of Object.entries(per)) console.log(`  ${g.padEnd(18)} ${String(r.n).padStart(5)} cases, ${r.bad} mismatches${r.warningsOnly ? ` (${r.warningsOnly} of them only in the overlap warnings)` : ""}`)
		// catalog(): every everyday type with its preview, the categories, the materials and looks
		const js = revive(JSON.parse(out.catalog))
		// (Python lists every physics module's catalog-wide props ("common": true) on these types; a page without those modules (page 1: only the ones
		// core.mjs registered) lists fewer: each entry is compared without the common props the page's own entry does not list)
		const pyTypes = pyCatalog.types.map((pt) => {
			const own = new Set((js.types.find((t) => t.key === pt.key)?.props ?? []).map((p) => p.key))
			const drop = new Set((pt.props ?? []).filter((p) => p.common && !own.has(p.key)).map((p) => p.key))
			if (!drop.size) return pt
			return { ...pt, props: pt.props.filter((p) => !drop.has(p.key)), ...(pt.defaults ? { defaults: Object.fromEntries(Object.entries(pt.defaults).filter(([k]) => !drop.has(k))) } : {}) }
		})
		const ds = diff(js.types, pyTypes, "types")
			.concat(diff(js.categories, pyCatalog.categories.slice(0, js.categories.length), "categories"))
			.concat(diff(js.materials, Object.fromEntries(Object.keys(js.materials).map((k) => [k, pyCatalog.materials[k]])), "materials"))
			.concat(diff(js.looks, Object.fromEntries(Object.keys(js.looks).map((k) => [k, pyCatalog.looks[k]])), "looks"))
		console.log(`  catalog()          ${js.types.length} everyday types with previews, ${Object.keys(js.materials).length} materials, ${Object.keys(js.looks).length} looks: ${ds.length ? "DIFFERENT: " + ds.slice(0, 3).join(" | ") : "same as Python's"}`)
		bad += ds.length
		await page.close()
	}
} finally {
	await browser.close()
	server.close()
	if (!keep) fs.rmSync(path.dirname(casesFile), { recursive: true, force: true })
}
console.log(bad ? `${bad} mismatches` : "the browser answers every case exactly as Python does")
process.exit(bad ? 1 : 0)
