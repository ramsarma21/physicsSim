// Writes web/scenario-list.json: the built-in scenarios in the format of the server's GET /api/scenarios ([{id, name, builtin, items}]), in
// the order the server lists them, from web/scenarios/*.json. A static host has no server to list a folder, so the page (web/sim/api.js) reads this.
//   node tools/gen-scenarios.mjs            writes it
//   node tools/gen-scenarios.mjs --check    writes nothing; exits 1 if the file is missing or doesn't match the folder (for a deploy script)
// (The list is NOT web/scenarios/index.json: web/server.py lists every *.json in that folder as a scenario and fails on one that isn't a scene.)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const folder = path.join(root, "web", "scenarios")
const out = path.join(root, "web", "scenario-list.json")
const ORDER = new Map([["rube-goldberg", 0], ["empty", 1]]) // the menu's first two (server.py: order.get(id, 9)); a Map, so an id like "constructor" gets 9

const list = []
for (const f of readdirSync(folder).filter((f) => f.endsWith(".json")).sort()) {
	let s
	try {
		s = JSON.parse(readFileSync(path.join(folder, f), "utf8"))
	} catch {
		continue // (the server skips a file that isn't JSON)
	}
	if (s === null || typeof s !== "object" || Array.isArray(s)) continue
	const id = f.slice(0, -5)
	list.push({ id, name: s.name ?? id, builtin: true, items: Array.isArray(s.items) ? s.items.length : 0 })
}
const key = (s) => [ORDER.get(s.id) ?? 9, s.name.toLowerCase()]
list.sort((a, b) => {
	const [oa, na] = key(a)
	const [ob, nb] = key(b)
	return oa - ob || (na < nb ? -1 : na > nb ? 1 : 0)
})
const text = `[\n${list.map((s) => " " + JSON.stringify(s)).join(",\n")}\n]\n`

if (process.argv.includes("--check")) {
	if (!existsSync(out) || readFileSync(out, "utf8") !== text) {
		console.error("web/scenario-list.json is out of date: run node tools/gen-scenarios.mjs")
		process.exit(1)
	}
	console.log(`web/scenario-list.json is up to date (${list.length} scenarios)`)
} else {
	writeFileSync(out, text)
	console.log(`wrote web/scenario-list.json: ${list.length} scenarios`)
}
