// The browser bundle's deterministic math for the engine in node (tools/engine-math-transform.ts has the rules; tools/build-engine.mjs
// applies them to the bundle): once this module has run, every engine module node loads afterwards (tooling/src and a copy of its sim
// folder, planck, effect) has Math.sin, cos, atan2, exp, hypot and pow replaced by tools/fdlibm.ts's and its `**` lowered to that pow,
// so the server's engine computes the same bits as the bundle in every browser, on any machine (node's own Math is the platform's).
//   node --import ./tools/engine-math-node.mjs research/rw-validate.ts all       (a script that imports the engine statically)
//   import "../../tools/engine-math-node.mjs"; const { simulate } = await import("../../tooling/src/sim/physics.ts")   (in the script)
// Modules loaded before it, and every other module, keep node's own Math. ENGINE_MATH_DEBUG=1 lists the modules it rewrites (on stderr).
// A CommonJS module cannot be rewritten here (node compiles it itself), but the bundle would rewrite it: one that the engine loads (its files
// and whatever they import, followed through the resolve hook) and that names Math.sin ... pow stops the load with an error, so the server
// can never quietly compute other bits than the browser.
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { ENGINE_FILES, findEsbuild, INJECT, INJECT_NAMES, LOWER_POW, MATH_FILES, NAMES_MATH, rewriteForNode } from "./engine-math-transform.ts"

const esbuild = await findEsbuild()
if (!esbuild) throw new Error("tools/engine-math-node.mjs: esbuild is not installed (run `npm ci` in the project root)")
// on the first line of the rewritten module, so its line numbers stay those of the source map
const header = `import { ${INJECT_NAMES.join(", ")} } from ${JSON.stringify(pathToFileURL(INJECT).href)};`
const NODE_MODULES = /[\\/]node_modules[\\/]/

const fileOf = (url) => (url && url.startsWith("file:") ? fileURLToPath(url) : undefined)
/** The URLs the engine's files resolved (what the bundle would hold besides them): the engine's own files are matched by name. */
const engineDeps = new Set()
const inEngine = (url) => {
	const file = fileOf(url)
	return file !== undefined && !MATH_FILES.test(file) && (ENGINE_FILES.test(file) || engineDeps.has(url))
}

if (!globalThis.__engineMathHooks) {
	globalThis.__engineMathHooks = true
	registerHooks({
		resolve(specifier, context, nextResolve) {
			const r = nextResolve(specifier, context)
			if (inEngine(context.parentURL)) engineDeps.add(r.url)
			return r
		},
		load(url, context, nextLoad) {
			const r = nextLoad(url, context)
			if (!url.startsWith("file:")) return r
			const file = fileURLToPath(url)
			// (a module that CommonJS code require()s comes here with no format yet: node compiles it as CommonJS)
			if (r.format === "commonjs" || r.format === "commonjs-typescript" || (r.format == null && /\.(c?js|c?ts)$/.test(file))) {
				if (!inEngine(url)) return r
				const src = r.source == null ? readFileSync(file, "utf8") : typeof r.source === "string" ? r.source : new TextDecoder().decode(r.source)
				const m = NAMES_MATH.exec(src)
				if (m) throw new Error(`engine-math: CommonJS module ${file} uses Math.${m[1]}; the bundle would rewrite it, this hook cannot (load it as ESM, or extend tools/engine-math-node.mjs)`)
				return r
			}
			if (r.format !== "module" && r.format !== "module-typescript") return r
			if (MATH_FILES.test(file)) return r
			// the bundle's rules: `**` lowered in the engine's files and planck's, the names replaced everywhere (here: in the engine and its packages)
			const pkg = NODE_MODULES.test(file)
			if (!pkg && !ENGINE_FILES.test(file)) return r
			const lower = pkg ? LOWER_POW.test(file) : true
			const src = typeof r.source === "string" ? r.source : new TextDecoder().decode(r.source)
			if (!NAMES_MATH.test(src) && !(lower && src.includes("**"))) return r
			if (process.env.ENGINE_MATH_DEBUG) process.stderr.write(`engine-math: ${file}${lower ? " (** lowered)" : ""}\n`)
			return { format: "module", source: header + rewriteForNode(esbuild, src, file, lower), shortCircuit: true }
		}
	})
}
