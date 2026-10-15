// Replays the core cases in a real browser (headless Chromium, never a visible window): web/sim loaded as the page would load it
// (ES modules over HTTP from a throwaway static server on 127.0.0.1), the answers compared with Python's.
//   node tools/parity/browser.mjs [--keep file.json]
// It first has core.mjs write the cases and Python's answers (starter, scenarios, types, random, clean edge inputs, clean via layout, dense overlaps,
// sprite balls side by side, pairs on the 3 mm overlap tolerance at non-round angles), then
// runs clean()/layout() on each in the page and diffs the answers number by number, the sign of zero included. Also times a few runs, and runs
// repr(str), str.lower() (and Final_Sigma) and float(str) at every code point in the page, to be compared by SHA-1 with CPython's (Chromium's
// Unicode is newer than Python 3.13's; web/sim/unicode.js makes them the same).
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
const casesFile = keep ?? path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "browser-")), "cases.json")
execFileSync("node", [path.join(HERE, "core.mjs"), "--mode", "core", "--groups", "starter,scenarios,types,materials,random,clean,overlaps,sprites,overlapties", "--export", casesFile], { cwd: PG, stdio: "inherit", maxBuffer: 1 << 28 })
// What CPython gives for text at every code point (repr, lower, float): digests, computed by Python here and by the page below.
const digestFile = path.join(path.dirname(casesFile), "unicode-digests.json")
execFileSync("python3", ["-I", path.join(HERE, "py_prims.py"), "digests", digestFile], { cwd: PG, maxBuffer: 1 << 28 })
const wantDigests = JSON.parse(fs.readFileSync(digestFile, "utf8"))
const reviveFile = (v) => {
	if (Array.isArray(v)) return v.map(reviveFile)
	if (v && typeof v === "object") {
		const ks = Object.keys(v)
		if (ks.length === 1 && ks[0] === "@@float" && v["@@float"] === "-0") return -0
		return Object.fromEntries(ks.map((k) => [k, reviveFile(v[k])]))
	}
	return v
}
const cases = JSON.parse(fs.readFileSync(casesFile, "utf8")).cases.map((c) => ({ ...c, py: reviveFile(c.py) }))

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
	const errors = []
	page.on("pageerror", (e) => errors.push(e.message))
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
	await page.goto(base)
	const out = await page.evaluate(async (json) => {
		const cs = JSON.parse(json) // (as text: page.evaluate's own argument encoding would turn an own "__proto__" key into a prototype)
		const { clean, BadScene } = await import("/sim/clean.js")
		const { layout } = await import("/sim/layout.js")
		const { catalog } = await import("/sim/items.js")
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
		const cat = catalog()
		const catalogMs = performance.now() - t1
		// the page's own answers for text at every code point, to be compared with CPython's (Chromium's Unicode is newer than Python's)
		const M = await import("/sim/pymath.js")
		const bitsOf = (x) => {
			const dv = new DataView(new ArrayBuffer(8))
			dv.setFloat64(0, x)
			return dv.getBigUint64(0).toString(16).padStart(16, "0")
		}
		const cps = []
		for (let cp = 0; cp < 0x110000; cp++) if (cp < 0xd800 || cp > 0xdfff) cps.push(cp)
		const sep = "\u{10ffff}"
		const dig = (parts) => M.sha1hex(parts.join(sep))
		const lowerT = [(c) => c, null, (c) => "a" + c + "\u03a3", (c) => "a\u03a3" + c, null, (c) => "a" + c + "\u03a3" + c + "a"]
		const floatT = [(c) => c, (c) => "1" + c]
		const digests = { repr: dig(cps.map((cp) => M.pyRepr(String.fromCodePoint(cp)))) }
		for (const k of [0, 2, 3, 5]) digests[`lower${k}`] = dig(cps.map((cp) => M.pyLower(lowerT[k](String.fromCodePoint(cp)))))
		Error.stackTraceLimit = 0
		for (const k of [0, 1]) {
			const ok = []
			for (const cp of cps) {
				try {
					ok.push(`${cp}:${bitsOf(M.pyFloat(floatT[k](String.fromCodePoint(cp))))}`)
				} catch (e) {
					if (e.name !== "ValueError") throw e
				}
			}
			digests[`float${k}`] = dig(ok)
		}
		return { answers, ms, catalogMs, catalogTypes: cat.types.length, userAgent: navigator.userAgent, digests }
	}, JSON.stringify(cases.map((c) => ({ req: c.req }))))
	for (const [k, want] of Object.entries(wantDigests)) {
		const ok = out.digests[k] === want
		if (!ok) bad++
		console.log(`  ${(k.startsWith("repr") ? "repr(str)" : k.startsWith("lower") ? "str.lower()" : "float(str)").padEnd(12)} at every code point (${k}): ${ok ? "same as CPython's" : "DIFFERENT from CPython's"}`)
	}
	console.log(`browser: ${out.userAgent.match(/(Headless)?Chrome\/[\d.]+/)?.[0]}; ${cases.length} cases in ${out.ms.toFixed(0)} ms in the page; catalog() ${out.catalogMs.toFixed(0)} ms (${out.catalogTypes} types)`)
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
	cases.forEach((c, i) => {
		const js = revive(JSON.parse(out.answers[i]))
		const py = c.py
		const d = py.error500 !== undefined && js.error500 !== undefined ? [] : diff(js, py)
		const r = (per[c.group] ??= { n: 0, bad: 0 })
		r.n++
		if (d.length) {
			r.bad++
			bad++
			if (bad <= 8) console.log(`  MISMATCH ${c.req.id}: ${d.slice(0, 3).join(" | ")}`)
		}
	})
	for (const [g, r] of Object.entries(per)) console.log(`  ${g.padEnd(18)} ${String(r.n).padStart(5)} cases, ${r.bad} mismatches`)
} finally {
	await browser.close()
	server.close()
	if (!keep) fs.rmSync(path.dirname(casesFile), { recursive: true, force: true })
}
console.log(bad ? `${bad} mismatches` : "the browser answers every case exactly as Python does")
process.exit(bad ? 1 : 0)
