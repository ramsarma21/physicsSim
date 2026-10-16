// The one definition of how the engine's math is made deterministic, shared by the browser bundle (tools/build-engine.mjs) and node
// (tools/engine-math-node.mjs: the server's worker research/poc/worker.ts, research/poc/dense_track.ts and the validators), so the
// server and every browser run the same functions on the same bits, on any machine:
//   - Math.sin, cos, atan2, exp, hypot and pow are replaced wherever a module names them (esbuild `define`) by tools/fdlibm.ts's (planck
//     keeps `var sin = Math.sin` at load time, so patching the global would be too late);
//   - `a ** b` in the engine's own files (tooling/src, planck/dist) is first lowered to Math.pow(a, b), so it goes through the same pow.
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))

export const DEFINE = { "Math.sin": "__fdSin", "Math.cos": "__fdCos", "Math.atan2": "__fdAtan2", "Math.exp": "__fdExp", "Math.hypot": "__fdHypot", "Math.pow": "__fdPow" }
export const INJECT = path.join(here, "fdlibm-inject.ts") // exports the six __fd names
export const INJECT_NAMES = Object.values(DEFINE)
/** The files whose `**` is lowered to the engine's pow in the bundle. */
export const LOWER_POW = /[\\/](tooling[\\/]src|planck[\\/]dist)[\\/].*\.(ts|mjs)$/
/** The engine's own files in node: tooling/src, and a copy of its sim folder elsewhere (research/rw-validate-p3.ts steps one 10 times finer). */
export const ENGINE_FILES = /[\\/](tooling[\\/]src|src[\\/]sim)[\\/].*\.(ts|mts|js|mjs)$/
/** A module that names one of the replaced functions. */
export const NAMES_MATH = /\bMath\s*\.\s*(sin|cos|atan2|exp|hypot|pow)\b/
/** The math itself (never rewritten: it is what the rewritten code calls). */
export const MATH_FILES = /[\\/]tools[\\/](fdlibm[^\\/]*|crpow[^\\/]*|engine-math-[^\\/]*)$/

/**
 * esbuild's transform options that lower `**` (the bundle's onLoad step), for a .ts or .js/.mjs file: `a ** b` becomes `__pow(a, b)` with
 * esbuild's helper `var __pow = Math.pow` at the top, which the build's `define` then points at the engine's pow.
 */
export const lowerOptions = (file) => ({ loader: file.endsWith(".ts") || file.endsWith(".mts") ? "ts" : "js", target: "es2022", supported: { "exponent-operator": false }, sourcefile: file, sourcemap: "inline" })
/** After that transform (in the bundle): the calls to Math.pow go to the engine's pow. */
export const afterLower = (code) => code.replaceAll("Math.pow(", "__fdPow(")

/**
 * The same rewrite in one pass, for node (tools/engine-math-node.mjs): `define` in the pass that lowers `**` cannot reach the helper it
 * writes (`var __pow = Math.pow`; the bundle's build pass does), so every Math.pow left after it is renamed too. The line numbers stay
 * the source's (the inline source map holds). `lower`: also lower `**`.
 */
export const rewriteForNode = (esbuild, src, file, lower) => {
	const opts = lowerOptions(file)
	if (!lower) delete opts.supported
	return esbuild.transformSync(src, { ...opts, define: DEFINE, format: "esm" }).code.replace(/\bMath\.pow\b/g, "__fdPow")
}

/** esbuild from the project's node_modules (a plain `npm ci` at the root) or tooling/node_modules. */
export const findEsbuild = async () => {
	const { createRequire } = await import("node:module")
	const { existsSync } = await import("node:fs")
	const root = path.resolve(here, "..")
	const found = [path.join(root, "node_modules"), path.join(root, "tooling", "node_modules")].find((d) => existsSync(path.join(d, "esbuild", "package.json")))
	return found ? createRequire(path.join(found, "x.js"))("esbuild") : undefined
}
