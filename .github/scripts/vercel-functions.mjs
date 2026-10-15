// Every `functions` pattern in vercel.json must match a file of this commit: Vercel fails the whole deployment when one matches no
// function ("[unused_function] The pattern ... doesn't match any Serverless Functions inside the `api` directory"), before it builds
// anything. Run from the repository root (node .github/scripts/vercel-functions.mjs); fs.globSync needs Node 22+.
import fs from "node:fs"

const v = JSON.parse(fs.readFileSync("vercel.json", "utf8"))
const pats = Object.keys(v.functions ?? {})
const bad = []
for (const g of pats) {
	const hits = fs.globSync(g)
	console.log(`vercel.json functions["${g}"]: ${hits.length ? hits.join(", ") : "NO FILE"}`)
	if (!hits.length) bad.push(g)
}
if (bad.length) {
	console.error(`::error title=vercel.json function pattern matches no file::${bad.join(", ")} (Vercel fails every deployment of this commit with [unused_function])`)
	process.exit(1)
}
console.log(`vercel.json: all ${pats.length} function patterns match a tracked file`)
