// Bundles tools/engine-worker-entry.ts (the physics engine: tooling/src/sim on planck.js + effect) into web/sim/engine-worker.js:
// an ES module for `new Worker(url, {type: "module"})`, minified, target es2022, with web/sim/engine-worker.js.map beside it.
// Also tools/engine-math-entry.ts (x ** y correctly rounded, the same bits in every browser) into web/sim/engine-math.js.
//   node tools/build-engine.mjs            (npm run build:engine)
// esbuild comes from node_modules at the project root (a plain `npm ci` there, as on Vercel) or from tooling/node_modules.
import { createRequire } from "node:module"
import { existsSync, readFileSync, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import path from "node:path"
import { afterLower, DEFINE, INJECT, LOWER_POW, lowerOptions } from "./engine-math-transform.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const found = [path.join(root, "node_modules"), path.join(root, "tooling", "node_modules")].find((d) => existsSync(path.join(d, "esbuild", "package.json")))
if (!found) {
	console.error("build-engine: esbuild is not installed (run `npm ci` in the project root).")
	process.exit(1)
}
const esbuild = createRequire(path.join(found, "x.js"))("esbuild")

// Node built-ins must not sneak into the browser bundle: the plugin makes each one an empty module and reports it.
const stubbed = new Set()
const noNode = {
	name: "no-node-builtins",
	setup(b) {
		b.onResolve({ filter: /^(node:.*|fs|path|os|crypto|util|stream|events|buffer|assert|child_process|worker_threads|readline|url|zlib|http|https|net|tls|perf_hooks|process)$/ }, (a) => {
			stubbed.add(`${a.path} (from ${path.relative(root, a.importer)})`)
			return { path: a.path, namespace: "node-stub" }
		})
		b.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({ contents: "export default {}", loader: "js" }))
	}
}

// The same bits in every browser and on the server: Math.sin, cos, atan2, exp, hypot and pow are replaced, wherever the bundle names them
// (planck keeps `var sin = Math.sin` at load time, so a global patch would be too late), by tools/fdlibm.ts (see there for why). `a ** b` is
// first lowered to Math.pow(a, b) in the engine's own files, so that goes through the same substitution. The rules are in
// tools/engine-math-transform.ts, which tools/engine-math-node.mjs applies to the engine in node (the server's worker) the same way.
const lowerPow = {
	name: "lower-exponent-operator",
	setup(b) {
		b.onLoad({ filter: LOWER_POW }, async (a) => {
			const t = await esbuild.transform(await readFile(a.path, "utf8"), lowerOptions(a.path))
			return { contents: afterLower(t.code), loader: "js", resolveDir: path.dirname(a.path) }
		})
	}
}
const outfile = path.join(root, "web", "sim", "engine-worker.js")
const result = await esbuild.build({
	entryPoints: [path.join(root, "tools", "engine-worker-entry.ts")],
	outfile,
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	minify: true,
	sourcemap: "linked",
	legalComments: "none",
	logLevel: "warning",
	metafile: true,
	define: DEFINE,
	inject: [INJECT],
	plugins: [noNode, lowerPow]
})

// the math alone (pow, cube) for the page: a few KiB
const mathOut = path.join(root, "web", "sim", "engine-math.js")
await esbuild.build({
	entryPoints: [path.join(root, "tools", "engine-math-entry.ts")],
	outfile: mathOut,
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	minify: true,
	legalComments: "none",
	logLevel: "warning"
})

const bytes = statSync(outfile).size
const gz = gzipSync(readFileSync(outfile), { level: 9 }).length
const map = statSync(outfile + ".map").size
const byPkg = {}
for (const [, out] of Object.entries(result.metafile.outputs).filter(([f]) => f.endsWith("engine-worker.js"))) {
	for (const [file, v] of Object.entries(out.inputs)) {
		const m = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
		const k = m ? m[1] : "engine (tooling/src/sim, tools)"
		byPkg[k] = (byPkg[k] ?? 0) + v.bytesInOutput
	}
}
console.log(`web/sim/engine-worker.js  ${(bytes / 1024).toFixed(1)} KiB, gzip ${(gz / 1024).toFixed(1)} KiB; map ${(map / 1024).toFixed(1)} KiB`)
console.log("  by source:", Object.entries(byPkg).map(([k, v]) => `${k} ${(v / 1024).toFixed(1)} KiB`).join(", "))
console.log(`web/sim/engine-math.js  ${(statSync(mathOut).size / 1024).toFixed(1)} KiB, gzip ${(gzipSync(readFileSync(mathOut), { level: 9 }).length / 1024).toFixed(1)} KiB`)
console.log(stubbed.size ? `  node built-ins stubbed: ${[...stubbed].join("; ")}` : "  no node built-ins in the bundle")

// the optics module's ray tracer as plain JavaScript for the 3D view and the AI's digest (tools/build-optics.mjs: web/sim/optics.js)
await import("./build-optics.mjs")
