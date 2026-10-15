// Copies the three.js the app loads out of node_modules/three into web/vendor/three/, so the deployed site needs no CDN.
//   node tools/vendor-three.mjs            (npm run vendor:three; `npm ci` first)  rebuilds web/vendor/three/
//   node tools/vendor-three.mjs --check    (npm run vendor:three:check)            writes nothing; exits 1 if web/vendor/three lacks a file
//                                           the app needs, holds a file it does not, or differs from node_modules/three
// What is copied: build/three.module.js, plus ONLY the addons the app imports (every "three/addons/..." in web/*.js, web/models/**, web/sim/**,
// then each one's relative imports, transitively), under the same relative paths (build/..., examples/jsm/...), so web/index.html's importmap is
//   "three": "./vendor/three/build/three.module.js", "three/addons/": "./vendor/three/examples/jsm/"
// web/dev/ pages keep the CDN. The folder is wiped and rebuilt each run, so an addon nobody imports any more disappears.
// WHY --check: an addon import that is not vendored 404s in the browser, the whole model group that imports it fails to load, and the page only
// shows bare shapes ("Ran in 0.2 s"). Run `npm run vendor:three` after adding any `three/addons/...` import; run --check before deploying.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkgDir = path.join(root, "node_modules", "three")
const out = path.join(root, "web", "vendor", "three")
const fail = (m) => { console.error(`vendor-three: ${m}`); process.exit(1) }

const args = process.argv.slice(2)
const check = args.includes("--check")
const unknown = args.find((a) => a !== "--check")
if (unknown) fail(`unknown argument ${unknown} (the only one is --check)`)

if (!existsSync(path.join(pkgDir, "package.json"))) fail("three is not installed (run `npm ci` in the project root).")
const version = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")).version
const wanted = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).dependencies?.three
if (wanted && wanted !== version) fail(`node_modules has three ${version} but package.json wants ${wanted} (run \`npm ci\`).`)

// The app's own source: web/*.js, web/models/**, web/sim/**. (Not web/dev, web/vendor or web/out.)
const sources = []
const walk = (dir, deep) => {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name)
		if (e.isDirectory()) { if (deep) walk(p, true) } else if (/\.m?js$/.test(e.name)) sources.push(p)
	}
}
walk(path.join(root, "web"), false)
walk(path.join(root, "web", "models"), true)
walk(path.join(root, "web", "sim"), true)

const jsm = path.join(pkgDir, "examples", "jsm")
const addons = new Map()                                   // path under examples/jsm -> the first app file that imports it
for (const f of sources) {
	for (const m of readFileSync(f, "utf8").matchAll(/["'`]three\/addons\/([^"'`\s]*)["'`]/g)) {
		const a = m[1]
		if (!a) continue                                       // the importmap's own "three/addons/" key
		if (!a.endsWith(".js") || a.includes("${")) fail(`${path.relative(root, f)} imports "three/addons/${a}": write the whole file name, ending in .js, as a plain string (the importmap does no extension search, and this script cannot follow a computed name).`)
		if (!addons.has(a)) addons.set(a, path.relative(root, f))
	}
}
if (!addons.size) fail("no three/addons imports found in web/ (is the scan wrong?)")

// Follow each file's imports: relative ones stay inside examples/jsm (or climb to build/), bare "three" is the main file
// (which, in versions that split it, imports build/three.core.js: followed too).
const files = new Set()
const why = new Map()                                      // file -> what imports it (only for the messages)
const queue = [[path.join(pkgDir, "build", "three.module.js"), "the web/index.html importmap"], ...[...addons].map(([a, from]) => [path.join(jsm, a), from])]
while (queue.length) {
	const [f, from] = queue.pop()
	if (files.has(f)) continue
	if (!existsSync(f)) fail(`${from} imports ${path.relative(pkgDir, f)}, which is not in three ${version}`)
	files.add(f)
	why.set(f, from)
	const here = path.relative(pkgDir, f)
	const text = readFileSync(f, "utf8")
	const specs = [...text.matchAll(/^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/gm), ...text.matchAll(/^[ \t]*import\s*["']([^"']+)["']/gm)]
	for (const m of specs) {                               // statements at the start of a line (not text inside a string or comment)
		const s = m[1]
		if (s === "three") continue
		if (s.startsWith("three/addons/")) queue.push([path.join(jsm, s.slice("three/addons/".length)), here])
		else if (s.startsWith(".")) queue.push([path.resolve(path.dirname(f), s), here])
		else fail(`${here} imports "${s}", which this script does not know how to vendor`)
	}
}

if (check) {
	const have = new Map()                                   // path under web/vendor/three -> file, for what is there now
	const list = (dir) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name)
			if (e.isDirectory()) list(p); else have.set(path.relative(out, p), p)
		}
	}
	if (existsSync(out)) list(out)
	const want = new Map([...files].map((f) => [path.relative(pkgDir, f), f]))
	want.set("LICENSE", path.join(pkgDir, "LICENSE"))
	const problems = []
	for (const [rel, src] of want) {
		if (!have.has(rel)) problems.push(`missing   ${rel}   (${why.has(src) ? `imported by ${why.get(src)}` : "the licence ships with the files"})`)
		else if (!readFileSync(src).equals(readFileSync(have.get(rel)))) problems.push(`differs   ${rel}   (not the bytes of node_modules/three ${version})`)
	}
	for (const rel of have.keys()) if (!want.has(rel)) problems.push(`extra     ${rel}   (nothing imports it)`)
	if (problems.length) {
		console.error(`vendor-three --check: web/vendor/three is out of date (${problems.length} problem${problems.length > 1 ? "s" : ""}):\n  ${problems.sort().join("\n  ")}\nRun \`npm run vendor:three\` and commit/deploy web/vendor/three.`)
		process.exit(1)
	}
	console.log(`vendor-three --check: web/vendor/three is up to date (three ${version}, ${want.size} files)`)
	process.exit(0)
}

rmSync(out, { recursive: true, force: true })
let raw = 0, gz = 0
const rows = []
for (const f of [...files].sort()) {
	const rel = path.relative(pkgDir, f)
	const to = path.join(out, rel)
	mkdirSync(path.dirname(to), { recursive: true })
	copyFileSync(f, to)
	const b = readFileSync(to)
	const z = gzipSync(b, { level: 9 }).length
	raw += b.length; gz += z
	rows.push(`  ${rel.padEnd(52)} ${String(b.length).padStart(8)}  gzip ${String(z).padStart(7)}`)
}
copyFileSync(path.join(pkgDir, "LICENSE"), path.join(out, "LICENSE"))
console.log(`vendor-three: three ${version} -> web/vendor/three/ (${files.size} files)`)
console.log(rows.join("\n"))
console.log(`  total ${raw} bytes, ${gz} gzipped`)
