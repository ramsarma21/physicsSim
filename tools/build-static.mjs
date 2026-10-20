// Builds the static site a host serves (Vercel: vercel.json "outputDirectory": "dist"): ONLY what the app loads at run time, copied out of web/,
// then checked so that a deploy cannot ship a page that 404s on its own imports, calls another origin, or carries a secret.
//   node tools/build-static.mjs --regen     (npm run build:static; Vercel's buildCommand) first regenerates the generated files in web/
//                                            (npm run build:engine, vendor:three, vendor:media, vendor:clerk, gen:scenarios: `npm ci` first), then builds dist/.
//                                            An engine bundle (web/sim/engine-worker.js, engine-math.js) that comes out different from the copy that
//                                            was uploaded FAILS the build: the uploaded one is the one the parity tools checked (--allow-engine-drift
//                                            ships the fresh build anyway). Other generated files that differ are a warning.
//   node tools/build-static.mjs             (npm run build:static:nogen) builds dist/ from web/ as it is; the generated files must be up to date
//                                            (vendor:three:check, vendor:media:check, vendor:clerk:check, gen:scenarios:check, and the engine bundle rebuilt from its
//                                            current sources in a scratch folder must be byte-identical to web/sim's). Writes nothing in the project
//                                            outside dist/ (and its marker file, .dist.build-static beside it).
//   node tools/build-static.mjs --serve-only [port]   (npm run preview:static) serves an existing dist/ at http://127.0.0.1:<port>/ with vercel.json's
//                                            headers and cleanUrls, until Ctrl-C (--serve [port] builds first). The page is on this machine, so the app
//                                            would use the local server: open it with ?engine=browser, as a deploy runs. /api/ai/* answers 503 there
//                                            (on Vercel the function api/ai/[step].mjs serves it).
//   node tools/build-static.mjs --vercel-check [--keep]   (npm run check:vercel) does what a deploy does, without deploying: copies the files
//                                            `vercel deploy` would upload (.vercelignore) to a scratch folder, runs `vercel build` there (npm ci, then
//                                            this script with --regen) with a throwaway local project id, then lays the built AI function out as a
//                                            deploy does (read-only) and calls it against a mock gateway on 127.0.0.1 with a fake key (GET 405, an
//                                            unknown step 404, an `edit` of the starter 200, an `imagine` 200 with its picture), and runs the starter
//                                            in its engine. Needs git and the Vercel CLI; touches nothing in the project. --keep leaves the scratch
//                                            folder (it is kept on a failure).
// Options: --out <dir> (default dist; must be inside the project), --map-budget <bytes> (default 1048576: a source map larger than this is left out,
// and the sourceMappingURL comment of its file with it).
//
// What ships (dist/ mirrors web/, index.html at its root):
//   web/*.html, *.js, *.css, scenario-list.json and top-level images/fonts; web/{account,ai,export,models,scenarios,sim,ui,vendor}/ (code, styles, data,
//   images, fonts, licences); never a test/, dev/, __pycache__ or dot folder, a .py/.md/.log/.ts file, a source map over the budget, or a
//   development-only file (DEV_ONLY below: web/ai/dev-mock.js, which ?aimock=1 loads; the code may name it only in a dynamic import()).
//   Not web/dev (dev pages: CDN three, GBs of shots), web/out, web/sample, web/saved, web/presets, nor anything outside web/ (research/, machines/,
//   snapshots/, tooling/, ai/: the server side). A NEW folder in web/ fails the build until it is added to SHIP_DIRS or SKIP_DIRS below.
//   web/vendor/<pkg>/ is published as vendor/<pkg>-<12 hex of its content>/ and dist/index.html's importmap is rewritten to match, so vercel.json
//   can cache /vendor/* for a year (immutable): a new three.js or a new addon set is a new folder name.
// What is checked (any failure exits 1 and names the file):
//   every static and dynamic import, `new URL("…", import.meta.url)`, CSS @import/url() and HTML src/href resolves to a shipped file, exactly as the
//   browser asks for it (no extension guessing; bare names only through the importmap: "three", "three/addons/…", "mediabunny"; module workers
//   have no importmap, so no bare names in a worker); template imports (`./models/${g}.js`) match files, and every name of a string list in the
//   same file that fits the template does; no import or link to another origin; the scenario list matches web/scenarios; nothing from outside web/;
//   no .env/key files, and (when TRUEFOUNDRY_API_KEY is set in this process, as it may be in Vercel's build) no shipped file containing its value;
//   the same for the accounts' server secrets (CLERK_SECRET_KEY, DATABASE_URL, ...: docs/ACCOUNTS.md), and no Clerk secret key or database URL
//   with a password in any shipped text file. --vercel-check also checks the scenes function (api/scenes/index.mjs: its rewrites, its files, the
//   Neon driver in it) and calls it with no keys (/api/scenes/me -> {accounts: null, storage: false}), and the video functions (api/videos/upload,
//   publish, gallery: their rewrites and files, called with no key 401, a wrong key 403, the right key but no gallery set up 503 not_configured).
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const web = path.join(root, "web")
const rel = (p) => path.relative(root, p).split(path.sep).join("/")
const errors = []
const warnings = []
const fail = (m) => {
	console.error(`build-static: ${m}`)
	process.exit(1)
}

// ------------------------------------------------------------------ options
const opt = { regen: false, out: "dist", mapBudget: 1 << 20, serve: null, build: true, allowEngineDrift: false, vercelCheck: false, keep: false }
{
	const argv = process.argv.slice(2)
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === "--regen") opt.regen = true
		else if (a === "--allow-engine-drift") opt.allowEngineDrift = true
		else if (a === "--vercel-check") opt.vercelCheck = true
		else if (a === "--keep") opt.keep = true
		else if (a === "--out") opt.out = argv[++i] ?? fail("--out needs a folder")
		else if (a === "--map-budget") {
			opt.mapBudget = Number(argv[++i])
			if (!Number.isFinite(opt.mapBudget) || opt.mapBudget < 0) fail("--map-budget needs a number of bytes")
		} else if (a === "--serve" || a === "--serve-only") {
			opt.serve = /^\d+$/.test(argv[i + 1] ?? "") ? Number(argv[++i]) : 4173 // taken: any free port
			if (a === "--serve-only") opt.build = false
		} else fail(`unknown argument ${a} (see the top of tools/build-static.mjs)`)
	}
	if (opt.regen && !opt.build) fail("--regen builds; it does not go with --serve-only")
	if (opt.allowEngineDrift && !opt.regen) fail("--allow-engine-drift goes with --regen")
	if (opt.vercelCheck && argv.some((a) => a !== "--vercel-check" && a !== "--keep")) fail("--vercel-check goes alone (or with --keep)")
	if (opt.keep && !opt.vercelCheck) fail("--keep goes with --vercel-check")
}
const out = path.resolve(root, opt.out)
if (out === root || !out.startsWith(root + path.sep)) fail(`--out must be a folder inside the project (${opt.out})`)
for (const src of ["web", "ai", "api", "tools", "tooling", "machines", "research", "snapshots", "docs", "node_modules"])
	if (out === path.join(root, src) || out.startsWith(path.join(root, src) + path.sep)) fail(`--out may not be ${src}/ or inside it`)
// a rebuild only ever wipes a folder this script made: it writes a marker file BESIDE the output (dist/ -> .dist.build-static), not in it, so
// the marker is not published with the site (an older build's marker inside the output, .build-static, is still accepted)
const MARKER = ".build-static"
const markerOf = (dir) => path.join(path.dirname(dir), `.${path.basename(dir)}${MARKER}`)

// ------------------------------------------------------------------ what ships
const SHIP_DIRS = new Set(["account", "ai", "export", "gallery", "models", "scenarios", "sim", "ui", "vendor"])
const SKIP_DIRS = new Set(["dev", "out", "sample", "saved", "presets", "__pycache__", "node_modules"]) // dev pages and shots, renders, test data, the server's saves
const ASSET_EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico",
	".woff", ".woff2", ".ttf", ".otf", ".wav", ".mp3", ".ogg", ".m4a", ".mp4", ".webm", ".wasm", ".txt"])
const LICENCE = /^(licen[cs]e|notice|copying)(\.(txt|md))?$/i
const NEVER_DIR = (name) => name.startsWith(".") || ["test", "tests", "__pycache__", "node_modules", "dev"].includes(name)
const NEVER_FILE = (name) => name.startsWith(".") || /\.(test|spec)\.m?js$/.test(name) || /\.(py|pyc|log|ts|tsx|md|sh|command|env|pem|key|p12)$/i.test(name) && !LICENCE.test(name)
const TOP_JSON = new Set(["scenario-list.json"]) // the only top-level JSON the page reads (web/sim/api.js); others there are dev data
// development-only files (paths under web/) that never ship. The app may name one only in a dynamic import() that development URLs trigger
// (panel.js: ?aimock=1 -> import("./dev-mock.js")); on a deploy that import fails and nothing fake answers. A static import of one fails the build.
const DEV_ONLY = new Set(["ai/dev-mock.js", "account/dev-mock.js"]) // (account/dev-mock.js: ?accountmock, a pretend sign-in and /api/scenes)
const webRel = (p) => path.relative(web, p).split(path.sep).join("/")

function shippable(name, top) {
	if (NEVER_FILE(name)) return false
	if (LICENCE.test(name)) return !top
	const ext = path.extname(name).toLowerCase()
	if (!ASSET_EXT.has(ext)) return false
	if (top && ext === ".json") return TOP_JSON.has(name)
	return true
}

function listFiles(dir) {
	const found = []
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name)
			if (e.isDirectory()) walk(p)
			else found.push(p)
		}
	}
	if (fs.existsSync(dir)) walk(dir)
	return found.sort()
}

// ------------------------------------------------------------------ 1. the generated files
function npmRun(script) {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
	if (!pkg.scripts?.[script]) fail(`package.json has no "${script}" script`)
	const npm = process.platform === "win32" ? "npm.cmd" : "npm"
	console.log(`build-static: npm run ${script}`)
	const r = spawnSync(npm, ["run", "--silent", script], { cwd: root, stdio: "inherit", env: process.env })
	return r.status === 0
}

const ENGINE = ["web/sim/engine-worker.js", "web/sim/engine-math.js"] // what the parity tools check (web/CONTRACT.md, "Browser port, parity and builds")
const GENERATED = [...ENGINE, "web/vendor", "web/scenario-list.json"]
function fingerprint() {
	const m = new Map()
	for (const g of GENERATED) {
		const p = path.join(root, g)
		const files = fs.existsSync(p) && fs.statSync(p).isDirectory() ? listFiles(p) : fs.existsSync(p) ? [p] : []
		const h = createHash("sha256")
		for (const f of files) h.update(rel(f) + "\0").update(fs.readFileSync(f)).update("\0")
		m.set(g, files.length ? h.digest("hex") : null)
	}
	return m
}

/**
 * The engine bundle as `npm run build:engine` would make it now: tools/build-engine.mjs run on a scratch copy of its inputs (tools/*.ts, the
 * build script, package.json, tooling/package.json + tooling/src; node_modules linked), so web/sim is not touched. -> {diff: [paths]} | {error}
 */
function engineAsBuiltNow() {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "build-static-engine-"))
	const link = path.join(tmp, "node_modules")
	try {
		fs.mkdirSync(path.join(tmp, "tools"))
		for (const f of fs.readdirSync(path.join(root, "tools"))) if (f === "build-engine.mjs" || f.endsWith(".ts")) fs.copyFileSync(path.join(root, "tools", f), path.join(tmp, "tools", f))
		fs.copyFileSync(path.join(root, "package.json"), path.join(tmp, "package.json"))
		fs.mkdirSync(path.join(tmp, "tooling"))
		fs.copyFileSync(path.join(root, "tooling", "package.json"), path.join(tmp, "tooling", "package.json"))
		fs.cpSync(path.join(root, "tooling", "src"), path.join(tmp, "tooling", "src"), { recursive: true })
		fs.symlinkSync(path.join(root, "node_modules"), link, "dir")
		fs.mkdirSync(path.join(tmp, "web", "sim"), { recursive: true })
		const r = spawnSync(process.execPath, [path.join(tmp, "tools", "build-engine.mjs")], { cwd: tmp, encoding: "utf8" })
		if (r.status !== 0) return { error: `${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" / ") || `exit ${r.status}`}` }
		const diff = []
		for (const g of ENGINE) {
			const mine = path.join(root, g)
			if (!fs.existsSync(mine)) diff.push(`${g} (missing)`)
			else if (!fs.readFileSync(mine).equals(fs.readFileSync(path.join(tmp, g)))) diff.push(g)
		}
		return { diff }
	} catch (e) {
		return { error: e.message }
	} finally {
		try {
			fs.unlinkSync(link) // the link first, so nothing below can reach the real node_modules
		} catch {}
		fs.rmSync(tmp, { recursive: true, force: true })
	}
}

// ------------------------------------------------------------------ --vercel-check: what a deploy does, without deploying
// The function is called by this script (written to the scratch folder and run with only PATH, HOME and a fake key in its environment), the
// way Vercel's Node runtime calls it: (req, res), req.query.step, a JSON body. The mock gateway is the AI core's test one (ai/test).
const CALL_FUNCTION = `import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"
const [fn, gwFile, starterFile] = process.argv.slice(2)
const KEY = process.env.TRUEFOUNDRY_API_KEY
const { startMockGateway } = await import(pathToFileURL(gwFile).href)
const gw = await startMockGateway()
process.env.AI_GATEWAY_URL = gw.url
// (the imagine step's pre-pass gets a cast and a layout from the catalog; every other chat call the edit's "nothing to change"; the picture
// is the mock's 1536x1024 JPEG)
const PREPASS = JSON.stringify({ cast: [{ type: "steel-ball", count: 1, role: "rolls down the ramp" }, { type: "plank", count: 1, role: "the ramp" }], missing: [], layout: "On the left of the table a plank ramp slopes down to the right; the steel ball rests at its top.", story: ["The ball rolls down the ramp."] })
gw.fallback = (rec) => ({ content: /concept picture/.test(JSON.stringify(rec.body?.messages?.[0] ?? "")) ? PREPASS : JSON.stringify({ kind: "answer", targets: [], mode: "patch", reply: "Nothing to change.", patches: [] }) })
gw.imageFallback = () => ({})
const handler = (await import(pathToFileURL(join(fn, "api", "ai", "[step].mjs")).href)).default
function call(step, { method = "POST", body } = {}) {
	const raw = body === undefined ? "" : JSON.stringify(body)
	const req = Readable.from(raw ? [Buffer.from(raw)] : [])
	Object.assign(req, { method, url: "/api/ai/" + step, query: { step }, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(raw)) } })
	return new Promise((resolve, reject) => {
		const res = {
			statusCode: 200, headers: {}, writableEnded: false, destroyed: false,
			setHeader(k, v) { this.headers[k.toLowerCase()] = v },
			end(text) {
				this.writableEnded = true
				const t = String(text ?? "")
				let json = null
				try { json = JSON.parse(t) } catch {}
				resolve({ status: this.statusCode, json, text: t, headers: this.headers })
			}
		}
		Promise.resolve(handler(req, res)).catch(reject)
	})
}
const out = {}
const get = await call("plan", { method: "GET" })
out.get = get.status
const unknown = await call("dance", { body: { payload: {} } })
out.unknown = unknown.status
const scene = JSON.parse(readFileSync(starterFile, "utf8"))
const t0 = Date.now()
const ed = await call("edit", { body: { payload: { text: "Change nothing.", scene }, client: { requestId: "vercel-check" } } })
out.edit = { status: ed.status, ok: ed.json?.ok ?? null, model: ed.json?.model ?? null, error: ed.json?.error ?? null, requestId: ed.json?.requestId ?? null, cacheControl: ed.headers["cache-control"] ?? null, ms: Date.now() - t0 }
// the imagine step: every module it loads (the picture's HTTP/1.1 fetch among them) must be in the function, and a picture comes back
const t1 = Date.now()
const im = await call("imagine", { body: { payload: { text: "a steel ball rolls down a ramp" }, client: { requestId: "vercel-check-imagine" } } })
const concept = im.json?.result?.concepts?.[0]
out.imagine = { status: im.status, ok: im.json?.ok ?? null, model: im.json?.model ?? null, error: im.json?.error ?? null, mime: concept?.mime ?? null, width: concept?.width ?? null, costInUSD: im.json?.usage?.costInUSD ?? null, ms: Date.now() - t1 }
out.keyInAnswers = [get, unknown, ed, im].some((r) => r.text.includes(KEY))
out.gateway = { requests: gw.requests.length, withKey: gw.requests.every((q) => q.auth) }
const steps = await import(pathToFileURL(join(fn, "ai", "steps.mjs")).href)
const run = await steps.runScene(scene)
out.run = { frames: run.track?.frames?.length ?? null, goal: run.summary?.goals?.[0]?.ok ?? null }
await gw.close()
console.log("RESULT " + JSON.stringify(out))
`

// The scenes function (docs/ACCOUNTS.md), called as deployed with no keys at all: GET /api/scenes/me answers {accounts: null, storage: false},
// GET /api/scenes 503 not_configured, and with a DATABASE_URL that leads nowhere the Neon driver loads from the function's own node_modules
// (the request then fails as "unavailable", with no host or connection string in the answer).
const CALL_SCENES = `import { Readable } from "node:stream"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
const [fn] = process.argv.slice(2)
const { handle } = await import(pathToFileURL(join(fn, "api", "scenes", "index.mjs")).href)
const { getDb } = await import(pathToFileURL(join(fn, "api", "_lib", "db.mjs")).href)
function call(url, env) {
	const req = Readable.from([])
	const u = new URL(url, "http://x")
	Object.assign(req, { method: "GET", url: u.pathname + u.search, query: Object.fromEntries(u.searchParams), headers: {} })
	return new Promise((resolve) => {
		const res = { statusCode: 200, headers: {}, writableEnded: false, setHeader(k, v) { this.headers[k.toLowerCase()] = v }, end(t) { this.writableEnded = true; let json = null; try { json = JSON.parse(String(t)) } catch {} resolve({ status: this.statusCode, json, text: String(t ?? "") }) } }
		handle(req, res, { env })
	})
}
const out = {}
const me = await call("/api/scenes/me", {})
out.me = { status: me.status, json: me.json }
const list = await call("/api/scenes", {})
out.list = { status: list.status, code: list.json?.code ?? null }
const logs = []
const log = console.log
console.log = (...a) => logs.push(a.join(" "))
const url = "postgres://check:not-a-password@127.0.0.1:9/none"
let dbAnswer = null
try { await getDb({ DATABASE_URL: url }) } catch (e) { dbAnswer = { status: e.status, code: e.code, message: e.message } }
console.log = log
out.db = { answer: dbAnswer, driverLoaded: logs.some((l) => l.includes('"db_schema"')), driverMissing: logs.some((l) => l.includes('"db_client"')), leaked: JSON.stringify(dbAnswer).includes("not-a-password") || logs.some((l) => l.includes("not-a-password")) }
console.log("RESULT " + JSON.stringify(out))
`
async function scenesCheck({ output, cfg, up, files, tmp, problems, say, run, posix, chmodTree }) {
	const fnRoot = path.join(output, "functions")
	const made = listFiles(fnRoot).filter((f) => path.basename(f) === ".vc-config.json").map((f) => posix(path.relative(fnRoot, path.dirname(f))))
	const extra = made.filter((f) => !["api/ai/[step].func", "api/scenes/index.func", ...VIDEO_FUNCTIONS.map((n) => `api/videos/${n}.func`)].includes(f))
	if (extra.length) problems.push(`vercel build made functions that should not exist: ${extra.join(", ")} (only api/ai/[step], api/scenes/index and api/videos/${VIDEO_FUNCTIONS.join("|")}; api/_lib/ holds modules, not functions)`)
	const rewrites = (cfg.routes ?? []).filter((r) => typeof r.src === "string" && r.src.startsWith("^/api/scenes(") && /^\/api\/scenes\?id=\$1(&part=\$2)?$/.test(String(r.dest ?? "")))
	if (rewrites.length < 2) problems.push(".vercel/output/config.json lacks the rewrites of /api/scenes/:id and /api/scenes/:id/:part to the scenes function (vercel.json rewrites)")
	const funcDir = path.join(fnRoot, "api", "scenes", "index.func")
	if (!fs.existsSync(path.join(funcDir, ".vc-config.json"))) return void problems.push("there is no function at .vercel/output/functions/api/scenes/index.func")
	const vc = JSON.parse(fs.readFileSync(path.join(funcDir, ".vc-config.json"), "utf8"))
	const want = JSON.parse(fs.readFileSync(path.join(up, "vercel.json"), "utf8")).functions?.["api/scenes/*.mjs"] ?? {}
	if (!/^nodejs\d+\.x$/.test(vc.runtime ?? "")) problems.push(`the scenes function's runtime is ${vc.runtime}`)
	if (vc.handler !== "api/scenes/index.mjs") problems.push(`the scenes function's handler is ${vc.handler}`)
	if (want.maxDuration !== undefined && vc.maxDuration !== want.maxDuration) problems.push(`the scenes function's maxDuration is ${vc.maxDuration}; vercel.json says ${want.maxDuration}`)
	const fn = path.join(tmp, "scenes-function")
	fs.cpSync(funcDir, fn, { recursive: true, filter: (s) => path.basename(s) !== ".vc-config.json" })
	for (const [dest, src] of Object.entries(vc.filePathMap ?? {})) {
		const from = path.resolve(up, src)
		if (!from.startsWith(up + path.sep) || !fs.existsSync(from)) {
			problems.push(`the scenes function's filePathMap names ${src}, which is not in the upload`)
			continue
		}
		fs.mkdirSync(path.dirname(path.join(fn, dest)), { recursive: true })
		fs.copyFileSync(from, path.join(fn, dest))
	}
	const fnFiles = listFiles(fn).map((f) => posix(path.relative(fn, f)))
	const inFn = new Set(fnFiles)
	for (const f of files) if (f.startsWith("web/sim/") && /\.(m?js|json)$/.test(f) && !inFn.has(f)) problems.push(`the scenes function lacks ${f} (vercel.json functions["api/scenes/*.mjs"].includeFiles)`)
	for (const need of ["api/_lib/auth.mjs", "api/_lib/db.mjs", "node_modules/@neondatabase/serverless/index.mjs"]) if (!inFn.has(need)) problems.push(`the scenes function lacks ${need}`)
	const unwanted = fnFiles.filter((f) => /\.map$/.test(f) || /(^|\/)\.env/.test(f) || /\.(pem|key|p12)$/i.test(f) || f.startsWith("web/account/"))
	if (unwanted.length) problems.push(`the scenes function holds files it must not: ${unwanted.slice(0, 6).join(", ")}`)
	const bytes = fnFiles.reduce((n, f) => n + fs.statSync(path.join(fn, f)).size, 0)
	say(`scenes function: ${vc.runtime}, maxDuration ${vc.maxDuration} s, ${fnFiles.length} files, ${(bytes / 1048576).toFixed(1)} MB; rewrites: ${rewrites.length}; functions built: ${made.join(", ")}`)
	chmodTree(fn, true)
	try {
		const script = path.join(tmp, "call-scenes.mjs")
		fs.writeFileSync(script, CALL_SCENES)
		const r = run(process.execPath, [script, fn], { cwd: fn, env: { PATH: process.env.PATH ?? "", HOME: tmp, TMPDIR: tmp, NODE_ENV: "production" }, timeout: 60000 })
		const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("RESULT "))
		if (r.status !== 0 || !line) return void problems.push(`calling the built scenes function failed (exit ${r.status ?? r.signal}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-4).join(" / ") || "no output"}`)
		const got = JSON.parse(line.slice("RESULT ".length))
		if (got.me.status !== 200 || got.me.json?.accounts !== null || got.me.json?.storage !== false) problems.push(`GET /api/scenes/me with no keys answered ${got.me.status} ${JSON.stringify(got.me.json)}, not {accounts: null, storage: false}`)
		if (got.list.status !== 503 || got.list.code !== "not_configured") problems.push(`GET /api/scenes with no keys answered ${got.list.status} ${got.list.code}, not 503 not_configured`)
		if (!got.db.driverLoaded || got.db.driverMissing) problems.push("the scenes function could not load the Neon driver (@neondatabase/serverless) from its own files")
		if (got.db.answer?.code !== "unavailable") problems.push(`a database that can't be reached answered ${JSON.stringify(got.db.answer)}, not 503 unavailable`)
		if (got.db.leaked) problems.push("a database error leaked the connection string")
		say(`scenes function called with no keys: /api/scenes/me ${got.me.status} ${JSON.stringify(got.me.json)}, /api/scenes ${got.list.status} ${got.list.code}; the Neon driver loads from the function, and an unreachable database answers "${got.db.answer?.code}" with nothing of its address`)
	} finally {
		chmodTree(fn, false)
	}
}

// The video functions (docs/DEPLOY.md "Video gallery"), called as deployed with no gallery set up: no x-agent-key 401, a wrong key 403 (no
// master key and no database: nothing can match), the master key but no VIDEO_GALLERY_ID / Blob store / database 503 not_configured, and the
// gallery page and a job's report page 404 for any id. The built routes must send the gallery, batch and job-file addresses to the gallery
// function, also /videos/<id>/index.html and .../report.html (a report's own links) through cleanUrls' 308s. Each module they load (api/_lib/videos.mjs, blob.mjs, agent-keys.mjs, gallery.mjs) must be in the function.
const VIDEO_FUNCTIONS = ["upload", "publish", "gallery"]
const CALL_VIDEOS = `import { Readable } from "node:stream"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
const [dirs] = process.argv.slice(2)
const fns = JSON.parse(dirs)
const KEY = "fake-master-key-of-the-vercel-check-0123456789abcdef"
function call(name, { method = "POST", url, body, headers = {} }) {
	const raw = body === undefined ? "" : JSON.stringify(body)
	const req = Readable.from(raw ? [Buffer.from(raw)] : [])
	const u = new URL(url, "http://x")
	Object.assign(req, { method, url: u.pathname + u.search, query: Object.fromEntries(u.searchParams), headers: { ...(raw ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(raw)) } : {}), ...headers } })
	return new Promise(async (resolve, reject) => {
		const res = { statusCode: 200, headers: {}, writableEnded: false, setHeader(k, v) { this.headers[k.toLowerCase()] = v }, end(t) { this.writableEnded = true; let json = null; try { json = JSON.parse(String(t)) } catch {} resolve({ status: this.statusCode, json, text: String(t ?? ""), ctype: this.headers["content-type"] ?? null }) } }
		try {
			const h = (await import(pathToFileURL(join(fns[name], "api", "videos", name + ".mjs")).href)).default
			await h(req, res)
		} catch (e) { reject(e) }
	})
}
const job = { job: "check-1", files: [{ name: "video.mp4", type: "video/mp4", size: 1000 }] }
const out = {}
out.noKey = (await call("upload", { url: "/api/videos/upload", body: job })).status
out.wrongKey = (await call("upload", { url: "/api/videos/upload", body: job, headers: { "x-agent-key": "not-a-key" } })).status
process.env.AI_AGENT_KEY = KEY
const up = await call("upload", { url: "/api/videos/upload", body: job, headers: { "x-agent-key": KEY } })
out.upload = { status: up.status, code: up.json?.code ?? null }
const pub = await call("publish", { url: "/api/videos/publish", body: { job: "check-1" }, headers: { "x-agent-key": KEY } })
out.publish = { status: pub.status, code: pub.json?.code ?? null }
const gal = await call("gallery", { method: "GET", url: "/api/videos/gallery?gallery=0123456789abcdef0123" })
out.gallery = { status: gal.status, ctype: gal.ctype }
const rep = await call("gallery", { method: "GET", url: "/api/videos/gallery?gallery=0123456789abcdef0123&job=job-1&file=report" })
out.report = { status: rep.status, ctype: rep.ctype }
out.keyInAnswers = [up, pub, gal, rep].some((r) => r.text.includes(KEY))
console.log("RESULT " + JSON.stringify(out))
`
/**
 * Where the built routes send a GET of `p` (redirects followed, at most 3): {path (the last address), dest (the rewrite it reached) | null}.
 * Enough of Vercel's routing for the video pages: routes in order, "continue" header routes skipped, a 3xx with Location restarts.
 */
function resolveRoute(routes, p) {
	const fill = (t, m) => String(t).replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "")
	for (let hops = 0; hops < 4; hops++) {
		let next = null
		for (const r of routes) {
			if (typeof r.src !== "string" || r.continue) continue
			const m = new RegExp(r.src, "i").exec(p)
			if (!m) continue
			if (r.status >= 300 && r.status < 400 && r.headers?.Location) next = fill(r.headers.Location, m)
			else if (r.dest) return { path: p, dest: fill(r.dest, m) }
			else return { path: p, dest: null }
			break
		}
		if (!next) return { path: p, dest: null }
		p = next
	}
	return { path: p, dest: null }
}

async function videosCheck({ output, cfg, up, tmp, problems, say, run, posix, chmodTree }) {
	const routes = (cfg.routes ?? []).filter((r) => typeof r.src === "string" && r.src.startsWith("^/videos(") && /^\/api\/videos\/gallery\?gallery=\$1(&batch=\$2|&job=\$2&file=\$3)?$/.test(String(r.dest ?? "")))
	if (routes.length < 3) problems.push(".vercel/output/config.json lacks the rewrites of /videos/:gallery, /videos/:gallery/batches/:batch and /videos/:gallery/jobs/:job/:file to the gallery function (vercel.json rewrites)")
	// a video's report page and its relative links, through the built routes (cleanUrls' 308s first): ../../index.html must reach the gallery
	const G = "0123456789abcdef0123"
	const want2 = {
		[`/videos/${G}`]: `/api/videos/gallery?gallery=${G}`,
		[`/videos/${G}/index.html`]: `/api/videos/gallery?gallery=${G}`,
		[`/videos/${G}/batches/unit-6`]: `/api/videos/gallery?gallery=${G}&batch=unit-6`,
		[`/videos/${G}/jobs/job-1/report`]: `/api/videos/gallery?gallery=${G}&job=job-1&file=report`,
		[`/videos/${G}/jobs/job-1/report.html`]: `/api/videos/gallery?gallery=${G}&job=job-1&file=report`,
		[`/videos/${G}/jobs/job-1/video.mp4`]: `/api/videos/gallery?gallery=${G}&job=job-1&file=video.mp4`,
		[`/videos/${G}/jobs/job-1/audit.json`]: `/api/videos/gallery?gallery=${G}&job=job-1&file=audit.json`,
	}
	const resolved = Object.entries(want2).map(([p, dest]) => [p, dest, resolveRoute(cfg.routes ?? [], p)])
	for (const [p, dest, got] of resolved) if (got.dest !== dest) problems.push(`the built routes send ${p} to ${got.dest ?? "nothing"} (via ${got.path}), not ${dest}`)
	const want = JSON.parse(fs.readFileSync(path.join(up, "vercel.json"), "utf8")).functions?.["api/videos/*.mjs"] ?? {}
	const laid = {}
	for (const name of VIDEO_FUNCTIONS) {
		const funcDir = path.join(output, "functions", "api", "videos", `${name}.func`)
		if (!fs.existsSync(path.join(funcDir, ".vc-config.json"))) {
			problems.push(`there is no function at .vercel/output/functions/api/videos/${name}.func`)
			continue
		}
		const vc = JSON.parse(fs.readFileSync(path.join(funcDir, ".vc-config.json"), "utf8"))
		if (!/^nodejs\d+\.x$/.test(vc.runtime ?? "")) problems.push(`the video ${name} function's runtime is ${vc.runtime}`)
		if (vc.handler !== `api/videos/${name}.mjs`) problems.push(`the video ${name} function's handler is ${vc.handler}`)
		if (want.maxDuration !== undefined && vc.maxDuration !== want.maxDuration) problems.push(`the video ${name} function's maxDuration is ${vc.maxDuration}; vercel.json says ${want.maxDuration}`)
		const fn = path.join(tmp, `videos-${name}`)
		fs.cpSync(funcDir, fn, { recursive: true, filter: (s) => path.basename(s) !== ".vc-config.json" })
		for (const [dest, src] of Object.entries(vc.filePathMap ?? {})) {
			const from = path.resolve(up, src)
			if (!from.startsWith(up + path.sep) || !fs.existsSync(from)) {
				problems.push(`the video ${name} function's filePathMap names ${src}, which is not in the upload`)
				continue
			}
			fs.mkdirSync(path.dirname(path.join(fn, dest)), { recursive: true })
			fs.copyFileSync(from, path.join(fn, dest))
		}
		const fnFiles = listFiles(fn).map((f) => posix(path.relative(fn, f)))
		const inFn = new Set(fnFiles)
		for (const need of ["api/_lib/videos.mjs", "api/_lib/blob.mjs", "api/_lib/agent-keys.mjs", "api/_lib/gallery.mjs", "api/_lib/db.mjs", "node_modules/@neondatabase/serverless/index.mjs"]) if (!inFn.has(need)) problems.push(`the video ${name} function lacks ${need}`)
		const unwanted = fnFiles.filter((f) => /\.map$/.test(f) || /(^|\/)\.env/.test(f) || /\.(pem|key|p12)$/i.test(f) || f.startsWith("web/") || f.startsWith("ai/"))
		if (unwanted.length) problems.push(`the video ${name} function holds files it must not: ${unwanted.slice(0, 6).join(", ")}`)
		const bytes = fnFiles.reduce((n, f) => n + fs.statSync(path.join(fn, f)).size, 0)
		say(`video ${name} function: ${vc.runtime}, maxDuration ${vc.maxDuration} s, ${fnFiles.length} files, ${(bytes / 1048576).toFixed(1)} MB`)
		chmodTree(fn, true)
		laid[name] = fn
	}
	if (Object.keys(laid).length !== VIDEO_FUNCTIONS.length) return
	try {
		const script = path.join(tmp, "call-videos.mjs")
		fs.writeFileSync(script, CALL_VIDEOS)
		const r = run(process.execPath, [script, JSON.stringify(laid)], { cwd: tmp, env: { PATH: process.env.PATH ?? "", HOME: tmp, TMPDIR: tmp, NODE_ENV: "production", VERCEL: "1" }, timeout: 60000 })
		const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("RESULT "))
		if (r.status !== 0 || !line) return void problems.push(`calling the built video functions failed (exit ${r.status ?? r.signal}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-4).join(" / ") || "no output"}`)
		const got = JSON.parse(line.slice("RESULT ".length))
		if (got.noKey !== 401) problems.push(`the upload function with no agent key answered ${got.noKey}, not 401`)
		if (got.wrongKey !== 403) problems.push(`the upload function with a wrong agent key answered ${got.wrongKey}, not 403`)
		if (got.upload.status !== 503 || got.upload.code !== "not_configured") problems.push(`the upload function with the key but no gallery answered ${got.upload.status} ${got.upload.code}, not 503 not_configured`)
		if (got.publish.status !== 503 || got.publish.code !== "not_configured") problems.push(`the publish function with the key but no gallery answered ${got.publish.status} ${got.publish.code}, not 503 not_configured`)
		if (got.gallery.status !== 404 || !/^text\/html/.test(got.gallery.ctype ?? "")) problems.push(`the gallery page with no gallery set up answered ${got.gallery.status} ${got.gallery.ctype}, not a 404 page`)
		if (got.report.status !== 404 || !/^text\/html/.test(got.report.ctype ?? "")) problems.push(`a job's report page with no gallery set up answered ${got.report.status} ${got.report.ctype}, not a 404 page`)
		if (got.keyInAnswers) problems.push("an answer of the video functions holds the agent key")
		say(`video functions called: no key ${got.noKey}, a wrong key ${got.wrongKey}, the key with no gallery set up: upload ${got.upload.status} ${got.upload.code}, publish ${got.publish.status} ${got.publish.code}; gallery page ${got.gallery.status}, a job's report ${got.report.status}; rewrites: ${routes.length}; ${resolved.length} gallery and report addresses reach the function (index.html and report.html through cleanUrls' 308)`)
	} finally {
		for (const fn of Object.values(laid)) chmodTree(fn, false)
	}
}

/** 0 when the upload builds with `vercel build` and its AI function answers as it should, else 1 (each problem printed). */
async function vercelCheck() {
	const say = (m) => console.log(`build-static: ${m}`)
	const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 << 20, ...o })
	for (const c of ["git", "vercel"]) {
		const r = run(c, ["--version"])
		if (r.error || r.status !== 0) fail(`--vercel-check needs ${c} on the PATH${c === "vercel" ? " (npm i -g vercel)" : ""}`)
	}
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "build-static-vercel-"))
	const up = path.join(tmp, "upload")
	const fn = path.join(tmp, "function")
	const problems = []
	const chmodTree = (dir, locked) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name)
			if (e.isDirectory()) chmodTree(p, locked)
			else if (e.isFile()) fs.chmodSync(p, locked ? 0o444 : 0o644)
		}
		fs.chmodSync(dir, locked ? 0o555 : 0o755)
	}
	const posix = (p) => p.split(path.sep).join("/")
	try {
		// 1. the upload: .vercelignore applied with git's ignore rules (the same gitignore syntax Vercel's CLI reads), through a throwaway git dir
		const gitDir = path.join(tmp, "ignore.git")
		const init = run("git", ["init", "-q", "--bare", gitDir])
		const ls = init.status === 0 ? run("git", ["--git-dir", gitDir, "--work-tree", root, "ls-files", "-z", "--others", "--exclude-from", path.join(root, ".vercelignore")]) : init
		if (ls.status !== 0) {
			problems.push(`listing the upload with git failed: ${(ls.stderr || "").trim()}`)
			return 1
		}
		const files = ls.stdout.split("\0").filter(Boolean).sort()
		let bytes = 0
		for (const f of files) {
			const src = path.join(root, f)
			const base = path.posix.basename(f)
			if (/^\.env(\.|$)/.test(base) || /\.(pem|key|p12)$/i.test(base) || f.split("/").includes(".vercel")) problems.push(`the upload would include ${f}`)
			if (fs.lstatSync(src).isSymbolicLink()) problems.push(`${f} is a symbolic link (the upload would carry the link, not the file)`)
			bytes += fs.statSync(src).size
			fs.mkdirSync(path.join(up, path.dirname(f)), { recursive: true })
			fs.copyFileSync(src, path.join(up, f))
		}
		say(`upload (.vercelignore): ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`)
		for (const need of ["package.json", "package-lock.json", "vercel.json", "api/ai/[step].mjs", "api/scenes/index.mjs", ...VIDEO_FUNCTIONS.map((n) => `api/videos/${n}.mjs`), "tools/build-static.mjs", "web/index.html"]) if (!files.includes(need)) problems.push(`the upload has no ${need}`)
		if (files.some((f) => f.startsWith("tools/video-agent/"))) problems.push("the upload would include tools/video-agent/ (the owner's local tools)")
		if (problems.length) return 1

		// 2. vercel build in the copy, with a throwaway local project id (nothing is linked or created on Vercel), without the AI key in its environment
		fs.mkdirSync(path.join(up, ".vercel"))
		fs.writeFileSync(path.join(up, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_buildstaticvercelcheck", orgId: "team_buildstaticvercelcheck", settings: { framework: null } }))
		const env = { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" }
		for (const k of Object.keys(env)) if (/^(TRUEFOUNDRY_|AI_|CLERK_|NEXT_PUBLIC_CLERK_|DATABASE_|POSTGRES_|PG[A-Z]+$|BLOB_|VIDEO_)/.test(k)) delete env[k]
		say(`vercel build in ${up} (npm ci, then npm run build:static):`)
		const vb = spawnSync("vercel", ["build", "--yes"], { cwd: up, stdio: "inherit", env })
		if (vb.status !== 0) {
			problems.push(`vercel build failed (exit ${vb.status ?? vb.signal}): see its log above`)
			return 1
		}

		// 3. what it made: the routes, the static site, the function's config
		const output = path.join(up, ".vercel", "output")
		const cfg = JSON.parse(fs.readFileSync(path.join(output, "config.json"), "utf8"))
		if (!(cfg.routes ?? []).some((r) => typeof r.src === "string" && r.src.includes("/api/ai/") && String(r.dest ?? "").startsWith("/api/ai/")))
			problems.push(".vercel/output/config.json has no route from /api/ai/<step> to the function")
		const staticDir = path.join(output, "static")
		const staticFiles = listFiles(staticDir).map((f) => posix(path.relative(staticDir, f)))
		if (!staticFiles.includes("index.html")) problems.push("the static output has no index.html")
		const strays = staticFiles.filter((f) => f.split("/").some((p) => p.startsWith(".")) || DEV_ONLY.has(f) || (/\.(ts|py|md|log|env|pem|key)$/i.test(f) && !LICENCE.test(path.posix.basename(f))))
		if (strays.length) problems.push(`the static output has files that must not be published: ${strays.slice(0, 8).join(", ")}`)
		say(`static output: ${staticFiles.length} files`)
		const funcDir = path.join(output, "functions", "api", "ai", "[step].func")
		if (!fs.existsSync(path.join(funcDir, ".vc-config.json"))) {
			problems.push("there is no function at .vercel/output/functions/api/ai/[step].func")
			return 1
		}
		const vc = JSON.parse(fs.readFileSync(path.join(funcDir, ".vc-config.json"), "utf8"))
		const want = JSON.parse(fs.readFileSync(path.join(up, "vercel.json"), "utf8")).functions?.["api/ai/*.mjs"] ?? {}
		if (!/^nodejs\d+\.x$/.test(vc.runtime ?? "")) problems.push(`the function's runtime is ${vc.runtime}`)
		if (vc.handler !== "api/ai/[step].mjs") problems.push(`the function's handler is ${vc.handler}`)
		if (want.maxDuration !== undefined && vc.maxDuration !== want.maxDuration) problems.push(`the function's maxDuration is ${vc.maxDuration}; vercel.json says ${want.maxDuration}`)
		if (want.supportsCancellation && vc.supportsCancellation !== true) problems.push("the function does not have supportsCancellation")

		// 4. the function laid out as a deploy has it: its traced files plus filePathMap (the includeFiles, taken from the upload), read-only
		fs.cpSync(funcDir, fn, { recursive: true, filter: (s) => path.basename(s) !== ".vc-config.json" })
		for (const [dest, src] of Object.entries(vc.filePathMap ?? {})) {
			const from = path.resolve(up, src)
			if (!from.startsWith(up + path.sep) || !fs.existsSync(from)) {
				problems.push(`the function's filePathMap names ${src}, which is not in the upload`)
				continue
			}
			fs.mkdirSync(path.dirname(path.join(fn, dest)), { recursive: true })
			fs.copyFileSync(from, path.join(fn, dest))
		}
		const fnFiles = listFiles(fn).map((f) => posix(path.relative(fn, f)))
		const inFn = new Set(fnFiles)
		// the AI core loads web/sim and its prompts and routing by computed paths, which no tracer follows: all of ai/ and web/sim's code and data must be there
		for (const f of files) if ((f.startsWith("ai/") || (f.startsWith("web/sim/") && /\.(m?js|json)$/.test(f))) && !inFn.has(f)) problems.push(`the function lacks ${f} (vercel.json functions["api/ai/*.mjs"].includeFiles)`)
		const unwanted = fnFiles.filter((f) => /\.map$/.test(f) || /(^|\/)\.env/.test(f) || /\.(pem|key|p12)$/i.test(f))
		if (unwanted.length) problems.push(`the function holds files it must not: ${unwanted.join(", ")}`)
		for (const need of ["api/_lib/ai-gate.mjs", "node_modules/@neondatabase/serverless/index.mjs"]) if (!inFn.has(need)) problems.push(`the function lacks ${need} (the accounts' AI limits: docs/ACCOUNTS.md §6)`)
		const fnBytes = fnFiles.reduce((n, f) => n + fs.statSync(path.join(fn, f)).size, 0)
		say(`function: ${vc.runtime}, maxDuration ${vc.maxDuration} s, supportsCancellation ${!!vc.supportsCancellation}, ${fnFiles.length} files, ${(fnBytes / 1048576).toFixed(1)} MB`)
		chmodTree(fn, true)

		// 5. call it: a mock gateway on 127.0.0.1 and a fake key, nothing else from this environment
		const gwFile = path.join(root, "ai", "test", "mock-gateway.mjs")
		if (!fs.existsSync(gwFile)) {
			problems.push("ai/test/mock-gateway.mjs is missing, so the function could not be called")
			return 1
		}
		const script = path.join(tmp, "call-function.mjs")
		fs.writeFileSync(script, CALL_FUNCTION)
		const fake = "fake-key-of-the-vercel-check-0123456789"
		const r = run(process.execPath, [script, fn, gwFile, path.join(up, "web", "scenarios", "rube-goldberg.json")], {
			cwd: fn,
			env: { PATH: process.env.PATH ?? "", HOME: tmp, TMPDIR: tmp, TRUEFOUNDRY_API_KEY: fake, NODE_ENV: "production" },
			timeout: 180000
		})
		const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("RESULT "))
		if (r.status !== 0 || !line) {
			problems.push(`calling the built function failed (exit ${r.status ?? r.signal}): ${((r.stderr || r.stdout || "").trim().split("\n").slice(-4).join(" / ") || "no output").replaceAll(fake, "[fake key]")}`)
			return 1
		}
		const got = JSON.parse(line.slice("RESULT ".length))
		if (got.get !== 405) problems.push(`GET answered ${got.get}, not 405`)
		if (got.unknown !== 404) problems.push(`an unknown step answered ${got.unknown}, not 404`)
		if (got.edit.status !== 200 || got.edit.ok !== true) problems.push(`the edit of the starter answered ${got.edit.status}: ${got.edit.error ?? "not ok"}`)
		if (got.edit.requestId !== "vercel-check") problems.push("the edit's answer did not carry its requestId back")
		if (got.edit.cacheControl !== "no-store") problems.push(`the edit's answer has Cache-Control ${got.edit.cacheControl}, not no-store`)
		if (got.imagine.status !== 200 || got.imagine.ok !== true || got.imagine.mime !== "image/jpeg") problems.push(`the imagine step answered ${got.imagine.status}: ${got.imagine.error ?? `a concept of type ${got.imagine.mime}`}`)
		if (got.keyInAnswers) problems.push("an answer of the function holds the key")
		if (got.gateway.requests < 1 || !got.gateway.withKey) problems.push(`the gateway got ${got.gateway.requests} requests${got.gateway.withKey ? "" : ", not all with the key"}`)
		if (!(got.run.frames > 0) || got.run.goal !== true) problems.push(`the function's engine ran the starter to ${got.run.frames} frames, goal ${got.run.goal}`)
		say(`function called: GET ${got.get}, unknown step ${got.unknown}, edit of the starter ${got.edit.status} through ${got.edit.model} in ${got.edit.ms} ms, imagine ${got.imagine.status} (a ${got.imagine.mime} ${got.imagine.width} wide through ${got.imagine.model}) in ${got.imagine.ms} ms (gateway: ${got.gateway.requests} request${got.gateway.requests === 1 ? "" : "s"}), no key in any answer; its engine ran the starter: ${got.run.frames} frames, goal ${got.run.goal ? "met" : "NOT met"}`)
		await scenesCheck({ output, cfg, up, files, tmp, problems, say, run, posix, chmodTree })
		await videosCheck({ output, cfg, up, tmp, problems, say, run, posix, chmodTree })
		return problems.length ? 1 : 0
	} catch (e) {
		problems.push(`the check itself failed: ${e?.stack ?? e}`)
		return 1
	} finally {
		for (const p of problems) console.error(`build-static: vercel-check: ${p}`)
		if (fs.existsSync(fn)) chmodTree(fn, false)
		if (opt.keep || problems.length) say(`the scratch folder is kept: ${tmp}`)
		else fs.rmSync(tmp, { recursive: true, force: true })
		console.log(problems.length ? `build-static: vercel-check FAILED (${problems.length} problem${problems.length > 1 ? "s" : ""})` : "build-static: vercel-check passed: the upload builds as Vercel builds it, and its AI function works as deployed (nothing was deployed)")
	}
}
if (opt.vercelCheck) process.exit(await vercelCheck())

if (opt.build && opt.regen) {
	const before = fingerprint()
	for (const s of ["build:engine", "vendor:three", "vendor:media", "vendor:clerk", "gen:scenarios"]) if (!npmRun(s)) fail(`npm run ${s} failed`)
	const after = fingerprint()
	for (const g of GENERATED) {
		const engine = ENGINE.includes(g)
		if (before.get(g) === after.get(g)) continue
		if (engine && !opt.allowEngineDrift)
			errors.push(`${g} ${before.get(g) === null ? "was not in the upload" : "came out different from the copy that was uploaded"}, so this deploy would ship engine code the parity tools never checked: run npm run build:engine and the parity tools (web/CONTRACT.md, "Browser port, parity and builds") locally, then deploy again (--allow-engine-drift ships the fresh build anyway)`)
		else if (before.get(g) === null) console.log(`build-static: ${g} generated (it was not in the upload)`)
		else warnings.push(`${g} came out different from the copy that was uploaded: the deploy has the fresh build; regenerate and check it locally (npm run ${engine ? "build:engine, then the parity tools" : g.includes("vendor") ? "vendor:three / vendor:media" : "gen:scenarios"})`)
	}
} else if (opt.build) {
	for (const s of ["vendor:three:check", "vendor:media:check", "vendor:clerk:check", "gen:scenarios:check"]) if (!npmRun(s)) errors.push(`npm run ${s} failed (its message is above): a generated file in web/ is out of date (run it without :check), or the script could not read what the app imports`)
	// the engine bundle has no --check of its own: rebuild it from the current sources in a scratch folder and compare the bytes
	const e = engineAsBuiltNow()
	if (e.error) errors.push(`the engine bundle could not be rebuilt for comparison (tools/build-engine.mjs: ${e.error})`)
	else if (e.diff.length) errors.push(`${e.diff.join(", ")} ${e.diff.length > 1 ? "are" : "is"} not what npm run build:engine makes from the current sources (tooling/src/sim, tools/*.ts): run npm run build:engine and the parity tools (web/CONTRACT.md, "Browser port, parity and builds"); a deploy would fail on it`)
	else console.log(`build-static: ${ENGINE.join(", ")}: byte-identical to a fresh build from the current sources`)
}

// ------------------------------------------------------------------ 2. copy what ships
const shipped = [] // [source, dest]
if (opt.build) {
	if (fs.existsSync(out)) {
		const entries = fs.readdirSync(out)
		if (entries.length && !fs.existsSync(markerOf(out)) && !entries.includes(MARKER))
			fail(`${rel(out)}/ exists and was not made by this script (no ${rel(markerOf(out))} beside it): move it away or pick another --out`)
		fs.rmSync(out, { recursive: true, force: true })
	}
	fs.writeFileSync(markerOf(out), `${rel(out)}/ is written by tools/build-static.mjs and wiped on every build (this file says so).\n`)
	for (const e of fs.readdirSync(web, { withFileTypes: true })) {
		const p = path.join(web, e.name)
		if (e.isSymbolicLink()) {
			errors.push(`web/${e.name} is a symbolic link: nothing linked in from outside web/ ships`)
			continue
		}
		if (e.isDirectory()) {
			if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue
			if (!SHIP_DIRS.has(e.name)) {
				errors.push(`web/${e.name}/ is neither shipped nor left out: add it to SHIP_DIRS or SKIP_DIRS in tools/build-static.mjs`)
				continue
			}
			const walk = (d) => {
				for (const f of fs.readdirSync(d, { withFileTypes: true })) {
					const q = path.join(d, f.name)
					if (f.isSymbolicLink()) errors.push(`${rel(q)} is a symbolic link: nothing linked in from outside web/ ships`)
					else if (f.isDirectory()) {
						if (!NEVER_DIR(f.name)) walk(q)
					} else if (DEV_ONLY.has(webRel(q))) console.log(`build-static: leaving out ${rel(q)} (development only)`)
					else if (shippable(f.name, false)) shipped.push([q, path.join(out, path.relative(web, q))])
				}
			}
			walk(p)
		} else if (!DEV_ONLY.has(e.name) && shippable(e.name, true)) shipped.push([p, path.join(out, e.name)])
	}
	if (!shipped.some(([s]) => s === path.join(web, "index.html"))) fail("web/index.html is missing")
	// source maps: only within the budget, and only beside the file they map
	const dests = new Set(shipped.map(([, d]) => d))
	for (let i = shipped.length - 1; i >= 0; i--) {
		const [src, dest] = shipped[i]
		if (!src.endsWith(".map")) continue
		const size = fs.statSync(src).size
		if (size > opt.mapBudget || !dests.has(dest.slice(0, -4))) {
			console.log(`build-static: leaving out ${rel(src)} (${(size / 1048576).toFixed(1)} MB${size > opt.mapBudget ? `, over the ${(opt.mapBudget / 1048576).toFixed(1)} MB map budget` : ", maps no shipped file"})`)
			shipped.splice(i, 1)
		}
	}
	for (const [src, dest] of shipped) {
		const real = fs.realpathSync(src)
		if (!real.startsWith(fs.realpathSync(web) + path.sep)) {
			errors.push(`${rel(src)} resolves outside web/ (${real})`)
			continue
		}
		fs.mkdirSync(path.dirname(dest), { recursive: true })
		fs.copyFileSync(real, dest)
	}
	// a //# sourceMappingURL= whose map did not ship goes too (the browser would ask for it when devtools open)
	const shippedSet = new Set(shipped.map(([, d]) => d))
	for (const [, dest] of shipped) {
		if (!/\.m?js$/.test(dest)) continue
		const text = fs.readFileSync(dest, "utf8")
		const m = text.match(/\n?\/\/# sourceMappingURL=([^\s]+)\s*$/)
		if (!m || m[1].startsWith("data:")) continue
		if (!shippedSet.has(path.resolve(path.dirname(dest), m[1]))) fs.writeFileSync(dest, text.slice(0, m.index) + "\n")
	}
}
if (!fs.existsSync(path.join(out, "index.html"))) fail(`${rel(out)}/index.html is missing: build first (npm run build:static)`)

// ------------------------------------------------------------------ 3. vendor/<pkg>/ -> vendor/<pkg>-<hash>/, importmap rewritten
const htmlFiles = () => listFiles(out).filter((f) => f.endsWith(".html"))
const IMPORTMAP = /(<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>)([\s\S]*?)(<\/script>)/gi
const vendorNames = new Map() // pkg -> hashed folder name
if (opt.build) {
	const vdir = path.join(out, "vendor")
	if (fs.existsSync(vdir)) {
		for (const e of fs.readdirSync(vdir, { withFileTypes: true })) {
			if (!e.isDirectory()) {
				errors.push(`web/vendor/${e.name}: vendored files go in a folder per package (web/vendor/<package>/)`)
				continue
			}
			const dir = path.join(vdir, e.name)
			const h = createHash("sha256")
			for (const f of listFiles(dir)) h.update(path.relative(dir, f).split(path.sep).join("/") + "\0").update(fs.readFileSync(f)).update("\0")
			const name = `${e.name}-${h.digest("hex").slice(0, 12)}`
			fs.renameSync(dir, path.join(vdir, name))
			vendorNames.set(e.name, name)
		}
	}
	for (const f of htmlFiles()) {
		const html = fs.readFileSync(f, "utf8")
		const next = html.replace(IMPORTMAP, (all, open, body, close) => {
			let map
			try {
				map = JSON.parse(body)
			} catch (e) {
				errors.push(`${rel(f)}: the importmap is not JSON (${e.message})`)
				return all
			}
			let text = body
			const values = [...Object.values(map.imports ?? {}), ...Object.values(map.scopes ?? {}).flatMap((s) => Object.values(s ?? {}))]
			for (const v of new Set(values)) {
				const m = typeof v === "string" && v.match(/^(\.\/|\/)?vendor\/([^/]+)\/(.*)$/)
				if (!m) continue
				const to = vendorNames.get(m[2])
				if (!to) {
					errors.push(`${rel(f)}: the importmap points at vendor/${m[2]}/, which is not in web/vendor/`)
					continue
				}
				text = text.split(JSON.stringify(v)).join(JSON.stringify(`${m[1] ?? ""}vendor/${to}/${m[3]}`))
			}
			return open + text + close
		})
		if (next !== html) fs.writeFileSync(f, next)
	}
}

// ------------------------------------------------------------------ 4. every reference resolves
const esbuild = (() => {
	const found = [path.join(root, "node_modules"), path.join(root, "tooling", "node_modules")].find((d) => fs.existsSync(path.join(d, "esbuild", "package.json")))
	if (!found) fail("esbuild is not installed (run `npm ci` in the project root)")
	return createRequire(path.join(found, "x.js"))("esbuild")
})()
const inOut = (abs) => abs === out || abs.startsWith(out + path.sep)
const isFile = (abs) => {
	try {
		return fs.statSync(abs).isFile()
	} catch {
		return false
	}
}
const isDir = (abs) => {
	try {
		return fs.statSync(abs).isDirectory()
	} catch {
		return false
	}
}
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const isBare = (s) => !s.startsWith("./") && !s.startsWith("../") && !s.startsWith("/") && !SCHEME.test(s)
/** A relative or root URL as a path under out/, or null for "#x" / "?x" (the same document). */
function local(spec, baseDir) {
	const clean = spec.split(/[?#]/)[0]
	if (!clean) return null
	let p = clean
	try {
		p = decodeURIComponent(clean)
	} catch {}
	return p.startsWith("/") ? path.join(out, p) : path.resolve(baseDir, p)
}

// the importmap (index.html's; every page here shares one)
const importmap = { imports: {} }
{
	const html = fs.readFileSync(path.join(out, "index.html"), "utf8")
	for (const m of html.matchAll(IMPORTMAP)) {
		try {
			Object.assign(importmap.imports, JSON.parse(m[2]).imports ?? {})
			if (JSON.parse(m[2]).scopes) warnings.push("index.html: importmap scopes are not checked")
		} catch {}
	}
	for (const [k, v] of Object.entries(importmap.imports)) {
		if (SCHEME.test(v) || v.startsWith("//")) {
			errors.push(`index.html: the importmap sends "${k}" to another origin (${v})`)
			continue
		}
		const abs = local(v, out)
		if (k.endsWith("/") ? !isDir(abs) : !isFile(abs)) errors.push(`index.html: the importmap's "${k}" -> ${v} is not in ${rel(out)}/`)
	}
}
function viaImportmap(spec) {
	if (importmap.imports[spec] !== undefined) return importmap.imports[spec]
	let best = null
	for (const k of Object.keys(importmap.imports)) if (k.endsWith("/") && spec.startsWith(k) && (!best || k.length > best.length)) best = k
	return best ? importmap.imports[best] + spec.slice(best.length) : null
}

/** null when the reference is fine, else why not. kind: import (a module specifier) | worker-import | url (new URL(x, import.meta.url)) | css | html */
function check(spec, fromFile, kind) {
	if (/^(data|blob):/i.test(spec)) return null
	if (/^(https?:)?\/\//i.test(spec)) return `"${spec}" is on another origin (the app must load everything from its own)`
	if (SCHEME.test(spec)) return kind === "html" ? null : `"${spec}" has a URL scheme the page cannot load`
	let abs
	if (kind !== "css" && kind !== "html" && kind !== "url" && isBare(spec)) {
		if (kind === "worker-import") return `"${spec}" is a bare name in a module worker, which has no importmap`
		const to = viaImportmap(spec)
		if (to === null) return `"${spec}" is not in the importmap (index.html)`
		if (SCHEME.test(to) || to.startsWith("//")) return `"${spec}" maps to another origin (${to})`
		abs = local(to, out)
	} else {
		if ((kind === "css" || kind === "url") && isBare(spec)) spec = "./" + spec // CSS url(x) and new URL(x, base) are relative
		abs = local(spec, path.dirname(fromFile))
		if (abs === null) return null
	}
	if (!inOut(abs)) return `"${spec}" points outside the site`
	if (!isFile(abs)) return `"${spec}" -> ${rel(abs)} is not in the build`
	return null
}

const jsFiles = listFiles(out).filter((f) => /\.m?js$/.test(f))
const cssFiles = listFiles(out).filter((f) => f.endsWith(".css"))
const refs = new Map() // file -> [{kind, spec}]

const real = (p) => {
	try {
		return fs.realpathSync(p)
	} catch {
		return path.resolve(p)
	}
}
async function scan(file) {
	const found = []
	const self = real(file)
	try {
		await esbuild.build({
			entryPoints: [file],
			bundle: true,
			write: false,
			format: "esm",
			platform: "browser",
			target: "esnext",
			logLevel: "silent",
			absWorkingDir: out,
			loader: { ".js": "js", ".mjs": "js", ".css": "css" },
			plugins: [{
				name: "collect",
				setup(b) {
					b.onResolve({ filter: /.*/ }, (a) => {
						if (a.kind === "entry-point") return undefined
						// only this file's own references (esbuild also parses the files a template import like `./models/${g}.js` matches; each is scanned itself)
						if (real(a.importer) === self) found.push({ kind: a.kind, spec: a.path })
						return { path: a.path, external: true }
					})
				}
			}]
		})
	} catch (e) {
		for (const x of e.errors ?? [{ text: String(e.message ?? e) }]) errors.push(`${rel(file)}${x.location ? `:${x.location.line}` : ""}: ${x.text}`)
	}
	refs.set(file, found)
}
for (const f of [...jsFiles, ...cssFiles]) await scan(f)
if (!(refs.get(path.join(out, "app.js"))?.length > 3)) errors.push("the import scan found (almost) nothing in app.js: the checker itself is broken, so nothing was verified")

// module workers: a file named by new URL("…", import.meta.url) in a file that makes a Worker
const workers = new Set()
const NEW_URL = /new\s+URL\(\s*(["'])([^"'`\n]+)\1\s*,\s*import\.meta\.url\s*\)/g
for (const f of jsFiles) {
	const text = fs.readFileSync(f, "utf8")
	for (const m of text.matchAll(NEW_URL)) {
		const why = check(m[2], f, "url")
		if (why) errors.push(`${rel(f)}: new URL(${m[2]}): ${why}`)
		else if (/new\s+Worker\s*\(/.test(text) && /\.m?js$/.test(m[2])) workers.add(local(isBare(m[2]) ? "./" + m[2] : m[2], path.dirname(f)))
	}
}
/** A relative reference to a development-only file (DEV_ONLY), which is not in the build by design. */
const devOnly = (spec, fromFile) => {
	if (isBare(spec) || SCHEME.test(spec)) return false
	const abs = local(spec, path.dirname(fromFile))
	return abs !== null && inOut(abs) && DEV_ONLY.has(path.relative(out, abs).split(path.sep).join("/"))
}
for (const f of jsFiles) {
	for (const r of refs.get(f) ?? []) {
		if (devOnly(r.spec, f)) {
			if (r.kind !== "dynamic-import") errors.push(`${rel(f)}: ${r.kind} "${r.spec}" names a development-only file (DEV_ONLY in tools/build-static.mjs), which is not in the build: only a dynamic import() may`)
			continue
		}
		const why = check(r.spec, f, workers.has(f) ? "worker-import" : r.kind === "import-rule" || r.kind === "url-token" ? "css" : "import")
		// require() in an ES module only runs where a bundler or node defines it (a guarded fallback in vendored code): reported, not fatal
		if (why) (r.kind.startsWith("require") ? warnings : errors).push(`${rel(f)}: ${r.kind} ${why}`)
	}
}
for (const f of cssFiles) {
	for (const r of refs.get(f) ?? []) {
		const why = check(r.spec, f, "css")
		if (why) errors.push(`${rel(f)}: ${r.kind} ${why}`)
	}
}

// template imports: import(`./models/${g}.js`)
const minified = (text) => text.length > 20000 && text.length / (text.split("\n").length || 1) > 400
for (const f of jsFiles) {
	const text = fs.readFileSync(f, "utf8")
	if (minified(text)) continue
	for (const m of text.matchAll(/\bimport\s*\(\s*`([^`]*)`\s*\)/g)) {
		const tpl = m[1]
		const parts = tpl.split(/\$\{[^}]*\}/)
		if (parts.length < 2) continue
		if (!parts[0].startsWith("./") && !parts[0].startsWith("../")) {
			warnings.push(`${rel(f)}: import(\`${tpl}\`) is not checked (not a relative path)`)
			continue
		}
		const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		const re = new RegExp("^" + parts.map(esc).join("([^/]*)") + "$")
		const base = path.dirname(f)
		const candidates = listFiles(path.resolve(base, parts[0].slice(0, parts[0].lastIndexOf("/") + 1)))
			.map((p) => { const r = path.relative(base, p).split(path.sep).join("/"); return r.startsWith("../") ? r : "./" + r })
		const hits = candidates.filter((c) => re.test(c))
		if (!hits.length) errors.push(`${rel(f)}: import(\`${tpl}\`) matches no file in the build`)
		if (parts.length === 2) {
			for (const arr of text.matchAll(/\[\s*("(?:[^"\\\n]|\\.)*"(?:\s*,\s*"(?:[^"\\\n]|\\.)*")*)\s*,?\s*\]/g)) {
				const names = [...arr[1].matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((x) => x[1])
				const paths = names.map((n) => parts[0] + n + parts[1])
				const ok = paths.map((p) => isFile(path.resolve(base, p)))
				if (ok.some(Boolean) && !ok.every(Boolean)) errors.push(`${rel(f)}: import(\`${tpl}\`) with the names [${names.join(", ")}]: ${paths.filter((_, i) => !ok[i]).join(", ")} not in the build`)
			}
		}
	}
	// lists of module paths (export-ui's ENCODER_MODULES): a warning, they may be fallbacks
	for (const s of text.matchAll(/[[,]\s*(["'])(\.{1,2}\/[\w@./-]+\.(?:m?js|css|json))\1\s*(?=[,\]])/g)) if (!isFile(path.resolve(path.dirname(f), s[2]))) warnings.push(`${rel(f)}: "${s[2]}" (in a list) is not in the build`)
}

// HTML: scripts, styles, icons, inline modules
for (const f of htmlFiles()) {
	const html = fs.readFileSync(f, "utf8")
	const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]))
	for (const m of html.matchAll(/<(script|link|img|source|video|audio|iframe|a)\b([^>]*)>/gi)) {
		const tag = m[1].toLowerCase()
		const a = attrs(m[2])
		const url = a.src ?? a.href
		if (url === undefined) continue
		const why = check(url, f, "html")
		if (why) (tag === "a" ? warnings : errors).push(`${rel(f)}: <${tag} ${a.src !== undefined ? "src" : "href"}="${url}">: ${why}`)
	}
	for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
		const a = attrs(m[1])
		if (a.src !== undefined || (a.type ?? "").toLowerCase() === "importmap" || !m[2].trim()) continue
		const found = []
		try {
			await esbuild.build({ stdin: { contents: m[2], resolveDir: path.dirname(f), sourcefile: rel(f) }, bundle: true, write: false, format: "esm", logLevel: "silent",
				plugins: [{ name: "c", setup(b) { b.onResolve({ filter: /.*/ }, (x) => (found.push(x.path), { path: x.path, external: true })) } }] })
		} catch (e) {
			errors.push(`${rel(f)}: an inline script does not parse (${e.errors?.[0]?.text ?? e.message})`)
		}
		for (const s of found) {
			const why = check(s, f, "import")
			if (why) errors.push(`${rel(f)}: inline script: ${why}`)
		}
	}
}

// the scenario list (a static host cannot list web/scenarios/)
{
	const listFile = path.join(out, "scenario-list.json")
	if (!isFile(listFile)) errors.push("scenario-list.json is missing (node tools/gen-scenarios.mjs)")
	else {
		let list = null
		try {
			list = JSON.parse(fs.readFileSync(listFile, "utf8"))
		} catch (e) {
			errors.push(`scenario-list.json is not JSON (${e.message})`)
		}
		if (list && !Array.isArray(list)) errors.push("scenario-list.json is not a list")
		const ids = new Set()
		for (const s of Array.isArray(list) ? list : []) {
			ids.add(s?.id)
			if (!isFile(path.join(out, "scenarios", `${s?.id}.json`))) errors.push(`scenario-list.json names "${s?.id}", which has no scenarios/${s?.id}.json`)
		}
		if (!ids.has("rube-goldberg")) errors.push("scenario-list.json has no rube-goldberg (the starter)")
		for (const f of listFiles(path.join(out, "scenarios"))) {
			try {
				JSON.parse(fs.readFileSync(f, "utf8"))
			} catch (e) {
				errors.push(`${rel(f)} is not JSON (${e.message})`)
			}
		}
	}
}

// ------------------------------------------------------------------ 5. nothing that must not ship
{
	const all = listFiles(out)
	const FORBIDDEN_PART = new Set(["research", "machines", "snapshots", "tooling", "dev", "node_modules", "__pycache__", "test", "tests", ".vercel", ".git", ".cache"])
	const key = process.env.TRUEFOUNDRY_API_KEY && process.env.TRUEFOUNDRY_API_KEY.length >= 8 ? Buffer.from(process.env.TRUEFOUNDRY_API_KEY) : null
	// (the accounts' server-side secrets too, when the build can see them: docs/ACCOUNTS.md; the publishable key is public by design)
	// (and the video pipeline's: the owner's robot key and the Blob store's read-write token, docs/DEPLOY.md "Video gallery")
	const serverSecrets = ["CLERK_SECRET_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL", "POSTGRES_PASSWORD", "PGPASSWORD", "AI_SESSION_SECRET", "AI_AGENT_KEY", "BLOB_READ_WRITE_TOKEN"].filter((k) => (process.env[k] ?? "").length >= 8).map((k) => [k, Buffer.from(process.env[k])])
	for (const f of all) {
		const r = path.relative(out, f).split(path.sep)
		const name = r.at(-1)
		if (r.slice(0, -1).some((p) => FORBIDDEN_PART.has(p))) errors.push(`${rel(f)}: ships from a folder that never ships`)
		if (name.startsWith(".") || /\.(env|pem|key|p12|py|pyc|ts|log|md)$/i.test(name) && !LICENCE.test(name)) errors.push(`${rel(f)}: this kind of file never ships`)
		const bytes = fs.readFileSync(f)
		if (key && bytes.includes(key)) errors.push(`${rel(f)} contains the value of TRUEFOUNDRY_API_KEY`)
		for (const [k, v] of serverSecrets) if (bytes.includes(v)) errors.push(`${rel(f)} contains the value of ${k}`)
		if (/\.(m?js|css|html|json|map|txt|svg)$/.test(name)) {
			const text = bytes.toString("utf8")
			if (/TRUEFOUNDRY_API_KEY\s*["']?\s*[=:]\s*["'][^"'\s]{12,}["']/.test(text)) errors.push(`${rel(f)} seems to hold an API key value (TRUEFOUNDRY_API_KEY = "...")`)
			if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) errors.push(`${rel(f)} holds a private key`)
			if (/\bsk_(?:live|test)_[A-Za-z0-9]{20,}/.test(text)) errors.push(`${rel(f)} seems to hold a Clerk secret key (sk_...)`)
			if (/\bvercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9]{16,}/.test(text)) errors.push(`${rel(f)} seems to hold a Blob read-write token (vercel_blob_rw_...)`)
			if (/\bpostgres(?:ql)?:\/\/[^\s"'`:@/]+:[^\s"'`@/]+@/.test(text)) errors.push(`${rel(f)} seems to hold a database connection string with a password`)
		}
	}
}

// ------------------------------------------------------------------ 6. report
for (const w of warnings) console.warn(`build-static: warning: ${w}`)
if (errors.length) {
	console.error(`build-static: FAILED, ${errors.length} problem${errors.length > 1 ? "s" : ""}:\n  ${errors.join("\n  ")}`)
	process.exit(1)
}
{
	const all = listFiles(out)
	let raw = 0, gz = 0
	const rows = []
	for (const f of all) {
		const b = fs.readFileSync(f)
		const z = /\.(m?js|css|html|json|svg|map|txt)$/.test(f) ? gzipSync(b, { level: 6 }).length : b.length
		raw += b.length
		gz += z
		rows.push([path.relative(out, f).split(path.sep).join("/"), b.length, z])
	}
	rows.sort((a, b) => b[1] - a[1])
	const kb = (n) => `${(n / 1024).toFixed(0)} KiB`
	console.log(`build-static: ${rel(out)}/ ready: ${all.length} files, ${kb(raw)} (${kb(gz)} gzipped); ${jsFiles.length} modules and ${cssFiles.length} stylesheets checked, every reference resolves`)
	if (vendorNames.size) console.log(`  vendor: ${[...vendorNames].map(([k, v]) => `${k} -> vendor/${v}/`).join(", ")}`)
	console.log(`  largest: ${rows.slice(0, 6).map(([n, s, z]) => `${n} ${kb(s)} (${kb(z)} gz)`).join(", ")}`)
}

// ------------------------------------------------------------------ 7. --serve: a local stand-in for Vercel's static hosting
if (opt.serve !== null) {
	let rules = []
	let cleanUrls = false
	try {
		const vc = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"))
		cleanUrls = !!vc.cleanUrls
		// Vercel's source patterns (path-to-regexp): the forms vercel.json uses here are plain regex groups, :name and :name*
		rules = (vc.headers ?? []).map((h) => ({
			re: new RegExp("^" + h.source.replace(/:(\w+)\*/g, "(.*)").replace(/:(\w+)(?=\()/g, "").replace(/:(\w+)/g, "([^/]+)") + "$"),
			headers: h.headers
		}))
	} catch (e) {
		console.warn(`build-static: vercel.json not read (${e.message}); serving without its headers`)
	}
	const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
		".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
		".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm",
		".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".txt": "text/plain; charset=utf-8" }
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, "http://x")
		let p = url.pathname
		const headers = {}
		for (const r of rules) if (r.re.test(p)) for (const h of r.headers) headers[h.key] = h.value
		if (p.startsWith("/api/")) {
			res.writeHead(503, { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" })
			return res.end(JSON.stringify({ ok: false, error: "the AI steps run in the Vercel function (api/ai/[step].mjs); this static preview has none", code: "unavailable", retryable: false }))
		}
		if (cleanUrls && p.endsWith(".html")) {
			res.writeHead(308, { ...headers, Location: (p === "/index.html" ? "/" : p.slice(0, -5)) + url.search })
			return res.end()
		}
		let file = local(p, out)
		if (file && isDir(file)) file = path.join(file, "index.html")
		else if (file && cleanUrls && !isFile(file) && isFile(file + ".html")) file += ".html"
		if (!file || !inOut(file) || !isFile(file)) {
			res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" })
			return res.end("404: not found\n")
		}
		const body = fs.readFileSync(file)
		const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 20)}"`
		if (req.headers["if-none-match"] === etag) {
			res.writeHead(304, { ETag: etag, ...headers })
			return res.end()
		}
		res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Content-Length": body.length, ETag: etag, ...headers })
		res.end(req.method === "HEAD" ? undefined : body)
	})
	server.on("error", (e) => {
		if (e.code === "EADDRINUSE" && opt.serve !== 0) {
			opt.serve = 0
			server.listen(0, "127.0.0.1")
		} else fail(`cannot serve: ${e.message}`)
	})
	server.listen(opt.serve, "127.0.0.1", () => {
		const port = server.address().port
		console.log(`build-static: serving ${rel(out)}/ at http://127.0.0.1:${port}/?engine=browser  (Ctrl-C stops it; /api/ai/* answers 503 here)`)
	})
}
