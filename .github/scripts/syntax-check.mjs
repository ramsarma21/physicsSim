// Syntax of every tracked JavaScript and TypeScript file, with the running node itself:
//   .js / .mjs / .cjs  `node --check <file>` (several at once)
//   .ts                module.stripTypeScriptTypes, the strip-only transform node applies when it runs a .ts file: a syntax error or syntax
//                      node cannot strip (an enum, a namespace, parameter properties) fails, as it would at run time
//                      (`node --check` does not strip types, so it cannot check a .ts file)
//   node .github/scripts/syntax-check.mjs
import { execFileSync, spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.js", "*.mjs", "*.cjs", "*.ts"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean)
const js = tracked.filter((f) => !f.endsWith(".ts"))
const ts = tracked.filter((f) => f.endsWith(".ts"))
const bad = []

for (const f of ts) {
	try {
		stripTypeScriptTypes(readFileSync(path.join(root, f), "utf8"), { mode: "strip" })
	} catch (e) {
		bad.push(`${f}: ${e.code ?? e.name}: ${String(e.message).split("\n")[0]}`)
	}
}

const check = (f) =>
	new Promise((resolve) => {
		const p = spawn(process.execPath, ["--check", f], { cwd: root, stdio: ["ignore", "ignore", "pipe"] })
		let err = ""
		p.stderr.on("data", (d) => (err += d))
		p.on("close", (code) => {
			if (code !== 0) bad.push(`${f}:\n${err.trim()}`)
			resolve()
		})
	})
const queue = [...js]
await Promise.all(Array.from({ length: Math.max(2, os.availableParallelism()) }, async () => {
	while (queue.length) await check(queue.shift())
}))

if (bad.length) {
	for (const b of bad) console.error(`::error::syntax: ${b.split("\n")[0]}\n${b}`)
	console.error(`syntax-check: ${bad.length} of ${tracked.length} files failed`)
	process.exit(1)
}
console.log(`syntax-check: ${js.length} JavaScript files (node --check) and ${ts.length} TypeScript files (strip-only) parse with node ${process.version}`)
