// Parity of the browser engine (web/sim/engine-worker.js) with the server's: for every scene the running server (web/server.py) answers
// with a doc and a track, the bundled engine must give the SAME track, byte for byte as JSON text, in node and in headless Chromium
// (web/dev/engine-parity.html -> web/sim/engine.js -> the Web Worker). Also: other frame rates, error messages, cancellation, the
// no-Workers fallback. Rebuilds the bundle first. The server is only asked questions (GET/POST /api/...); a second copy of its worker
// (research/poc/worker.ts) is started here as a reference for what the server's POST can't do (other rates), and stopped at the end.
// The scenes include ones whose balls are sized to a micrometre-ish value (the starter with another wall or ball, ball-drop with another
// ball): their masses come out of x ** 3 and x ** 4, which both engines take from tools/crpow.ts (correctly rounded): the same bits.
// The server's worker runs the engine with the bundle's math (tools/engine-math-node.mjs), so this holds on any machine.
//   node tools/parity-engine.mjs [--server http://localhost:8790] [--catalog] [--saved] [--runs 3] [--rates 24,60,240,480]
//     --catalog  also one scene per catalog item (the item dropped on the table), --saved  also web/saved/*.json
//     --rates    extra rates for the starter scene, against the reference worker (default 24,60,240,480)
import { execFileSync, spawn } from "node:child_process"
import { createServer } from "node:http"
import { createInterface } from "node:readline"
import { createRequire } from "node:module"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { gzipSync, brotliCompressSync } from "node:zlib"
import { isDeepStrictEqual } from "node:util"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const opt = (name, dflt) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt)
const SERVER = opt("--server", "http://localhost:8790")
const RUNS = Number(opt("--runs", 3))
const RATES = opt("--rates", "24,60,240,480").split(",").map(Number)
const STARTER = "rube-goldberg"

const problems = []
const bad = (what) => {
	problems.push(what)
	console.log(`  MISMATCH: ${what}`)
}
// A page.evaluate that must come back: a client that hangs shows up as a failure, not as a harness that never ends.
const within = (what, p, limit = 60000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer in ${limit / 1000} s (the engine client is stuck)`)), limit))])
const ms = (v) => (v == null ? "-" : v >= 100 ? String(Math.round(v)) : v.toFixed(1))
const min = (xs) => Math.min(...xs)

// ---------------------------------------------------------------- the bundle
execFileSync("node", [path.join(root, "tools", "build-engine.mjs")], { stdio: "inherit", cwd: root })
const bundlePath = path.join(root, "web", "sim", "engine-worker.js")
const bundle = readFileSync(bundlePath)
const sizes = { raw: bundle.length, gzip: gzipSync(bundle, { level: 9 }).length, brotli: brotliCompressSync(bundle).length }
const kib = (n) => (n / 1024).toFixed(1) + " KiB"
console.log(`bundle web/sim/engine-worker.js: raw ${kib(sizes.raw)}, gzip ${kib(sizes.gzip)}, brotli ${kib(sizes.brotli)}`)
const tNode0 = performance.now()
const { run: bundleRun, handle: bundleHandle } = await import(pathToFileURL(bundlePath).href + "?t=" + Date.now())
console.log(`bundle imported in node: ${ms(performance.now() - tNode0)} ms`)

// ---------------------------------------------------------------- the server (read-only use)
const api = async (route, body) => {
	const r = await fetch(SERVER + route, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
	return { status: r.status, text: await r.text() }
}
try {
	await api("/api/scenarios")
} catch {
	console.error(`The server at ${SERVER} is not answering; this test compares against it.`)
	process.exit(2)
}

// ---------------------------------------------------------------- a second copy of the server's worker, as the reference for other rates
class Reference {
	constructor() {
		this.proc = spawn("node", ["--no-warnings", path.join(root, "research", "poc", "worker.ts")], { cwd: root, stdio: ["pipe", "pipe", "ignore"] })
		this.n = 0
		this.pending = new Map()
		createInterface({ input: this.proc.stdout }).on("line", (line) => {
			const t1 = line.indexOf("\t")
			const t2 = line.indexOf("\t", t1 + 1)
			const [id, what, raw] = [line.slice(0, t1), line.slice(t1 + 1, t2), line.slice(t2 + 1)]
			this.pending.get(Number(id))?.(what === "error" ? { error: JSON.parse(raw) } : { ms: Number(what), text: raw })
		})
	}
	// docText is the document's JSON text, passed through untouched (as server.py does).
	run(docText, rate) {
		const id = ++this.n
		return new Promise((resolve) => {
			this.pending.set(id, resolve)
			this.proc.stdin.write(`{"id":${id},"doc":${docText},"rate":${rate}}\n`)
		})
	}
	stop() {
		this.proc.kill()
	}
}
const ref = new Reference()

// ---------------------------------------------------------------- headless Chromium on a tiny static server for web/
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".map": "application/json", ".css": "text/css" }
const web = path.join(root, "web")
const files = createServer((req, res) => {
	const p = path.normalize(path.join(web, decodeURIComponent(new URL(req.url, "http://x").pathname)))
	if (!p.startsWith(web + path.sep) || !existsSync(p) || !statSync(p).isFile()) {
		res.writeHead(404).end()
		return
	}
	res.writeHead(200, { "content-type": MIME[path.extname(p)] ?? "application/octet-stream", "cache-control": "no-store" }).end(readFileSync(p))
})
await new Promise((r) => files.listen(0, "127.0.0.1", r))
const base = `http://127.0.0.1:${files.address().port}`

const require = createRequire(import.meta.url)
let playwright
for (const p of [process.env.PLAYWRIGHT_CORE, "/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1", "playwright-core"]) {
	if (!p) continue
	try {
		playwright = require(p)
		break
	} catch {}
}
if (!playwright) {
	console.error("playwright-core not found (set PLAYWRIGHT_CORE to its folder)")
	process.exit(2)
}
// Always headless (never a visible window). If this playwright-core's own browser revision isn't installed, use the newest one in the cache.
const cache = path.join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright")
const shells = existsSync(cache)
	? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse().map((d) => path.join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"))
	: []
const executablePath = [process.env.CHROMIUM_PATH, ...shells].find((p) => p && existsSync(p))
const browser = await playwright.chromium.launch({ headless: true }).catch((e) => {
	if (!executablePath) throw e
	return playwright.chromium.launch({ headless: true, executablePath })
})
console.log(`chromium ${browser.version()}, node ${process.version}`)
const consoleErrors = []
const openPage = async (query = "") => {
	const page = await browser.newPage()
	if (process.env.PLAYGROUND_MODULES !== undefined) await page.addInitScript((v) => { globalThis.PLAYGROUND_MODULES = v }, process.env.PLAYGROUND_MODULES) // (the physics modules the page loads: as node's)
	page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()))
	page.on("pageerror", (e) => consoleErrors.push(String(e)))
	await page.goto(`${base}/dev/engine-parity.html${query}`)
	await page.waitForFunction(() => window.parityReady === true)
	return page
}

// ---------------------------------------------------------------- comparing
function firstDiff(mineText, theirsText) {
	const a = JSON.parse(mineText)
	const b = JSON.parse(theirsText)
	if (a.fps !== b.fps) return `fps ${a.fps} vs ${b.fps}`
	if (a.frames.length !== b.frames.length) return `${a.frames.length} frames vs ${b.frames.length}`
	for (let k = 0; k < a.frames.length; k++) {
		const fa = a.frames[k]
		const fb = b.frames[k]
		if (JSON.stringify(fa) === JSON.stringify(fb)) continue
		if (fa.t !== fb.t) return `frame ${k}: t ${fa.t} vs ${fb.t}`
		for (const id of new Set([...Object.keys(fa.placements), ...Object.keys(fb.placements)])) {
			const pa = fa.placements[id]
			const pb = fb.placements[id]
			if (!pa || !pb) return `frame ${k} (t=${fa.t}): solid ${id} listed in ${pa ? "the browser engine" : "the server"} only`
			for (const f of ["x", "y", "angle", "squash"]) if (pa[f] !== pb[f]) return `frame ${k} (t=${fa.t}): ${id}.${f} ${pa[f]} (browser engine) vs ${pb[f]} (server)`
		}
		return `frame ${k}: same values, different order`
	}
	for (let k = 0; k < Math.max(a.impacts.length, b.impacts.length); k++) {
		if (JSON.stringify(a.impacts[k]) !== JSON.stringify(b.impacts[k])) return `impact ${k}: ${JSON.stringify(a.impacts[k])} vs ${JSON.stringify(b.impacts[k])}`
	}
	return "texts differ but their frames and impacts match (key order or spacing)"
}
const verdict = (label, mine, theirs) => {
	if (mine === theirs) return true
	bad(`${label}: ${firstDiff(mine, theirs)}`)
	return false
}

// ---------------------------------------------------------------- the scenes
const readScenes = (dir) =>
	readdirSync(path.join(web, dir))
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => ({ name: f.slice(0, -5), scene: JSON.parse(readFileSync(path.join(web, dir, f), "utf8")) }))
const cases = readScenes("scenarios")
if (argv.includes("--saved")) cases.push(...readScenes("saved").map((c) => ({ ...c, name: "saved/" + c.name })))
if (argv.includes("--catalog")) {
	const catalog = JSON.parse((await api("/api/catalog")).text)
	const table = cases.find((c) => c.name === "empty").scene.items[0]
	for (const t of catalog.types) {
		if (t.key === "table") continue
		cases.push({
			name: "item:" + t.key,
			scene: { version: 2, id: "parity", name: "parity " + t.key, seconds: 4.5, release: 0.5, stage: cases[0].scene.stage, items: [table, { id: "a", type: t.key, x: 1.3, y: 0.4, angle: 0, props: {} }], goals: [] }
		})
	}
}

// Edited sizes: x ** 3 / x ** 4 on diameters and walls typed by a person. (The server refusing one of these, say because the catalog changed, skips it.)
{
	const variant = (base, name, edit) => {
		const scene = structuredClone(cases.find((c) => c.name === base).scene)
		const item = (id) => scene.items.find((i) => i.id === id)
		edit(item)
		return { name: "edit:" + name, scene }
	}
	const swap = (it, type, diameter, y) => {
		it.type = type
		it.props = { diameter }
		if (y !== undefined) it.y = y
	}
	cases.push(
		variant("rube-goldberg", "starter, ball2 wall 0.001571", (item) => (item("ball2").props = { wall: 0.001571 })),
		variant("rube-goldberg", "starter, ball2 wall 0.001401", (item) => (item("ball2").props = { wall: 0.001401 })),
		variant("rube-goldberg", "starter, ball1 a basketball 0.522", (item) => swap(item("ball1"), "basketball", 0.522, 1.01)),
		variant("rube-goldberg", "starter, ball1 a basketball 0.261", (item) => swap(item("ball1"), "basketball", 0.261)),
		variant("rube-goldberg", "starter, ball1 a soccer ball 0.565", (item) => swap(item("ball1"), "soccer-ball", 0.565)),
		variant("ball-drop", "ball-drop, a soccer ball 0.989", (item) => swap(item("basketball"), "soccer-ball", 0.989)),
		variant("rube-goldberg", "starter, ball2 plastic 0.06 wall 0.00022", (item) => (item("ball2").props = { diameter: 0.06, wall: 0.00022 }))
	)
}

const pageMain = await openPage()
const rows = []
let firstChromium = null
let starterDoc = null
for (const c of cases) {
	const r = await api("/api/simulate", { scene: c.scene })
	if (r.status !== 200) {
		if (c.name.startsWith("item:") || c.name.startsWith("edit:")) {
			console.log(`${c.name}: the server refused (${r.status}) ${r.text.slice(0, 100)}; skipped`)
			continue
		}
		bad(`${c.name}: the server answered ${r.status} ${r.text.slice(0, 200)}`)
		continue
	}
	const text = r.text
	const dStart = text.indexOf(',"doc":') + 7
	const docText = text.slice(dStart, text.indexOf(',"summary":', dStart))
	const serverTrack = text.slice(text.lastIndexOf(',"track":') + 9, -1)
	// The server's own time for a first, uncached run (its answers are cached by scene, so ask again with the stage nudged: camera only).
	const nudged = JSON.parse(JSON.stringify(c.scene))
	nudged.stage = { ...(nudged.stage ?? { x0: -0.559, x1: 3.191, y0: -0.156, y1: 2.344 }) }
	nudged.stage.x0 -= 0.001 * (1 + Math.floor(Math.random() * 1000))
	const t0s = performance.now()
	const fresh = (await api("/api/simulate", { scene: nudged })).text
	const serverWall = performance.now() - t0s
	const freshAt = fresh.lastIndexOf(',"track":')
	const serverMs = fresh.startsWith('{"cached":false') ? Number(fresh.slice(fresh.lastIndexOf(',"ms":', freshAt) + 6, freshAt)) : null
	if (serverMs === null) console.log(`  (${c.name}: the nudged scene was answered from the server's cache; no server time)`)
	if (c.name === STARTER) starterDoc = docText
	const row = { name: c.name, kb: Math.round(serverTrack.length / 1024), frames: JSON.parse(serverTrack).frames.length, serverApiMs: serverMs, serverWallMs: serverWall }
	let ok = true

	// the reference worker (what the server runs), several times: the same text every time, and the same as the server answered
	const refMs = []
	for (let i = 0; i < RUNS; i++) {
		const o = await ref.run(docText, 120)
		if (o.error) {
			bad(`${c.name}: the reference worker failed: ${o.error}`)
			ok = false
			break
		}
		refMs.push(o.ms)
		ok = verdict(`${c.name}: reference worker run ${i + 1} vs server`, o.text, serverTrack) && ok
	}
	row.refMs = refMs.length ? min(refMs) : null

	// the bundle in node
	const nodeMs = []
	for (let i = 0; i < RUNS; i++) {
		const t0 = performance.now()
		const track = bundleRun(JSON.parse(docText), 120)
		nodeMs.push(performance.now() - t0)
		ok = verdict(`${c.name}: bundle in node run ${i + 1} vs server`, JSON.stringify(track), serverTrack) && ok
		if (i === 0 && !isDeepStrictEqual(track, JSON.parse(serverTrack))) {
			bad(`${c.name}: the bundle's track in node is not strictly equal to the server's parsed track (-0, undefined or number type)`)
			ok = false
		}
	}
	row.nodeMs = min(nodeMs)

	// the bundle in a Web Worker in Chromium
	const wall = []
	const inEngine = []
	for (let i = 0; i < RUNS; i++) {
		const o = await pageMain.evaluate(([d, rate]) => window.parity.run(d, rate), [docText, 120])
		if (firstChromium === null) firstChromium = o.wallMs
		wall.push(o.wallMs)
		inEngine.push(o.workerMs)
		if (o.mode !== "worker") bad(`${c.name}: Chromium ran on the ${o.mode} thread`)
		if (!o.jsonClean) bad(`${c.name}: the track from the worker has -0, NaN, Infinity or undefined in it`)
		ok = verdict(`${c.name}: Chromium worker run ${i + 1} vs server`, o.trackText, serverTrack) && ok
	}
	row.chromiumMs = min(inEngine)
	row.chromiumWallMs = min(wall)
	row.ok = ok
	rows.push(row)
	console.log(`${ok ? "ok  " : "DIFF"} ${c.name} (${row.frames} frames, ${row.kb} KiB of track)`)
}

// ---------------------------------------------------------------- other frame rates (against the reference worker)
const sweep = []
if (starterDoc) {
	for (const rate of RATES) {
		const o = await ref.run(starterDoc, rate)
		const n = bundleRun(JSON.parse(starterDoc), rate)
		const c = await pageMain.evaluate(([d, r]) => window.parity.run(d, r), [starterDoc, rate])
		const okNode = o.text !== undefined && verdict(`${STARTER} at ${rate} Hz: bundle in node vs reference`, JSON.stringify(n), o.text)
		const okChr = o.text !== undefined && verdict(`${STARTER} at ${rate} Hz: Chromium vs reference`, c.trackText, o.text)
		sweep.push({ rate, ok: okNode && okChr, refMs: o.ms, chromiumMs: c.workerMs })
		console.log(`${okNode && okChr ? "ok  " : "DIFF"} ${STARTER} at ${rate} Hz`)
	}
}

// ---------------------------------------------------------------- errors: the same message from the reference worker, node and Chromium
const errors = []
if (starterDoc) {
	const good = JSON.parse(starterDoc)
	const clockwise = structuredClone(good)
	const solid = clockwise.solids.find((s) => s.kind === "dynamic")
	solid.body = { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 0, y: 0.1 }, { x: 0.1, y: 0 }], depth: 0.1 }
	const noSolids = structuredClone(good)
	delete noSolids.solids
	const bads = { "empty object": {}, "clockwise polygon": clockwise, "no solids": noSolids, "a string": "x" }
	for (const [what, d] of Object.entries(bads)) {
		const text = JSON.stringify(d)
		const o = await ref.run(text, 120)
		const n = bundleHandle({ id: 1, doc: JSON.parse(text), rate: 120 })
		const c = await pageMain.evaluate(([t, r]) => window.parity.error(t, r), [text, 120])
		const same = o.error !== undefined && o.error === n.error && o.error === c
		if (!same) bad(`error for "${what}": reference ${JSON.stringify(o.error ?? "(ran)")}, node ${JSON.stringify(n.error ?? "(ran)")}, Chromium ${JSON.stringify(c ?? "(ran)")}`)
		errors.push({ what, same, message: o.error })
		console.log(`${same ? "ok  " : "DIFF"} error for ${what}: ${JSON.stringify(o.error)}`)
	}
}

// ---------------------------------------------------------------- the client: cancellation, order, termination, and the fallback
let behaviour = null
let fallback = null
if (starterDoc) {
	behaviour = await within("client behaviour", pageMain.evaluate(([d, rate]) => window.parity.behaviour(d, rate), [starterDoc, 120]))
	console.log("client behaviour:", JSON.stringify(behaviour))
	const want = { abortedBusyRejectedAs: "AbortError", afterAbortSame: true, preAbortedRejectedAs: "AbortError", order: "d-aborted,A,E,C,B", terminated: "AbortError,AbortError" }
	for (const [k, v] of Object.entries(want)) if (behaviour[k] !== v) bad(`client behaviour ${k}: ${JSON.stringify(behaviour[k])}, expected ${JSON.stringify(v)}`)
	// a document that can't be sent to the worker fails that run only: the engine must not stay stuck
	const clone = await within("dataClone", pageMain.evaluate(([d, rate]) => window.parity.dataClone(d, rate), [starterDoc, 120]))
	console.log("document the worker can't be sent:", JSON.stringify(clone))
	if (clone.firstRejectedAs !== "DataCloneError" || clone.next !== "ran" || clone.second !== "ran") bad(`after a DataCloneError the engine did not go on: ${JSON.stringify(clone)}`)
}
{
	const f = await pageMain.evaluate(() => window.parity.fallsBack())
	console.log("worker that fails to load:", JSON.stringify(f))
	if (f.echo !== 77 || f.echoAgain !== 78 || f.mode !== "main") bad(`a worker that fails to load did not hand over to the main thread: ${JSON.stringify(f)}`)
}
if (starterDoc) {
	const page = await openPage("?noworker=1")
	const serverTrack = (await ref.run(starterDoc, 120)).text
	const o = await page.evaluate(([d, r]) => window.parity.run(d, r), [starterDoc, 120])
	const ok = o.mode === "main" && verdict("no-Workers fallback (main thread) vs reference", o.trackText, serverTrack)
	if (o.mode !== "main") bad(`the no-Workers page used the ${o.mode} thread`)
	fallback = { ok, workerMs: o.workerMs, wallMs: o.wallMs }
	console.log(`${ok ? "ok  " : "DIFF"} fallback on the main thread: ${ms(o.workerMs)} ms in the engine, ${ms(o.wallMs)} ms round trip`)
	// quick edits, each aborting the one before: one run, not 25; and a run still waiting out its pause lets a newer one go first
	const burst = await within("main-thread burst", page.evaluate(() => window.parity.mainBurst()))
	console.log("main-thread burst of 25 aborting runs:", JSON.stringify(burst))
	if (burst.mode !== "main" || burst.burstRuns !== 1 || burst.burstLast !== 25 || burst.burstAborted !== 24 || burst.order !== "102,101")
		bad(`main-thread fallback: a burst of aborting runs, or the order of waiting runs, is wrong: ${JSON.stringify(burst)}`)
	await page.close()
}

// ---------------------------------------------------------------- engine-math.js: its cube in Chromium equals node's on the micrometre grid of diameters
{
	const xs = []
	for (let um = 5000; um <= 1000000; um += 5) xs.push(um / 1e6, um / 2e6)
	const { cube } = await import(pathToFileURL(path.join(root, "web", "sim", "engine-math.js")).href)
	const got = await pageMain.evaluate((a) => window.parity.cubes(a), xs)
	let diff = 0
	let first = null
	xs.forEach((x, i) => {
		if (!Object.is(got[i], cube(x))) {
			diff++
			first ??= `${x}: Chromium ${got[i]}, node ${cube(x)}`
		}
	})
	if (diff) bad(`engine-math.js cube in Chromium differs from node's on ${diff} of ${xs.length} sizes; first ${first}`)
	console.log(`${diff ? "DIFF" : "ok  "} engine-math.js cube in Chromium equals node's on ${xs.length} sizes`)
}

// ---------------------------------------------------------------- report
const ref0 = rows.map((r) => r.refMs).filter((v) => v != null)
const sum = (xs) => xs.reduce((a, b) => a + b, 0)
console.log("\nscene".padEnd(34) + "frames".padStart(7) + "ref worker".padStart(12) + "node".padStart(9) + "chromium".padStart(10) + "(+round trip)".padStart(15) + "  server API (1st run)")
for (const r of rows) {
	console.log(
		r.name.padEnd(33) + String(r.frames).padStart(7) + ms(r.refMs).padStart(12) + ms(r.nodeMs).padStart(9) + ms(r.chromiumMs).padStart(10) + ms(r.chromiumWallMs).padStart(15) + "  " + ms(r.serverApiMs) + " / " + ms(r.serverWallMs) + (r.ok ? "" : "   DIFF")
	)
}
console.log("(ms; best of " + RUNS + "; ref worker = research/poc/worker.ts, the server's engine process, as it times itself; server API = build + engine of its first, uncached run)")
console.log(`sum over scenes: ref worker ${ms(sum(ref0))} ms, node ${ms(sum(rows.map((r) => r.nodeMs)))} ms, chromium ${ms(sum(rows.map((r) => r.chromiumMs)))} ms`)
console.log(`first Chromium run in a fresh page (worker start + first scene): ${ms(firstChromium)} ms round trip`)
console.log(`bundle: raw ${kib(sizes.raw)}, gzip ${kib(sizes.gzip)}, brotli ${kib(sizes.brotli)}`)
if (consoleErrors.length) console.log("console errors in the page:", [...new Set(consoleErrors)].slice(0, 5))
console.log(problems.length ? `\n${problems.length} MISMATCH(ES)` : `\nALL IDENTICAL: ${rows.length} scenes x ${RUNS} runs in node and Chromium, ${sweep.length} extra rates, ${errors.length} error messages`)

ref.stop()
await browser.close()
files.close()
process.exit(problems.length || consoleErrors.length ? 1 : 0)
