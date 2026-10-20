#!/usr/bin/env node
// The owner's tool for robot keys (the video pipeline's x-agent-key), run on the owner's machine against the site's Neon database:
//   node tools/video-agent/keys.mjs issue <name> [--usd 25] [--steps 120] [--videos 50] [--mb 2000] [--out <file>]
//   node tools/video-agent/keys.mjs revoke <name>
//   node tools/video-agent/keys.mjs list
// issue prints the new key ONCE (only its sha256 is stored), for the owner to hand over privately; with --out it writes it to that file
// (mode 600) and prints nothing secret. A revoked name can be issued again (a new key). Changes apply at once: no redeploy.
// Caps per key: --usd AI dollars a day, --steps AI steps an hour, --videos new videos a day, --mb megabytes of uploads a day.
// The database: DATABASE_URL from the environment, else from blender-playground/.env.local (never printed). The master key (AI_AGENT_KEY,
// name "owner") lives in Vercel's environment, not here; list shows its use today. docs/DEPLOY.md "Robot keys".
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getDb, databaseUrl } from "../../api/_lib/db.mjs"
import { VIDEO_DEFAULTS, issueAgentKey, listAgentKeys, revokeAgentKey } from "../../api/_lib/agent-keys.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const USAGE = `usage:
  node tools/video-agent/keys.mjs issue <name> [--usd 25] [--steps 120] [--videos 50] [--mb 2000] [--out <file>]
  node tools/video-agent/keys.mjs revoke <name>
  node tools/video-agent/keys.mjs list`

/** KEY=value lines of a .env file (quotes stripped; export allowed); never logged. */
export function readEnvFile(file) {
	const out = {}
	if (!fs.existsSync(file)) return out
	for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
		const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
		if (!m) continue
		let v = m[2]
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
		out[m[1]] = v
	}
	return out
}

function parse(argv) {
	const [cmd, ...rest] = argv
	const o = { cmd, name: null, usd: 25, steps: 120, videos: VIDEO_DEFAULTS.videosPerDay, mb: VIDEO_DEFAULTS.uploadMbPerDay, out: null }
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i]
		if (a === "--usd") o.usd = Number(rest[++i])
		else if (a === "--steps") o.steps = Number(rest[++i])
		else if (a === "--videos") o.videos = Number(rest[++i])
		else if (a === "--mb") o.mb = Number(rest[++i])
		else if (a === "--out") o.out = rest[++i] ?? null
		else if (!a.startsWith("--") && o.name === null) o.name = a
		else throw new Error(`unknown argument ${a}\n${USAGE}`)
	}
	if (!["issue", "revoke", "list"].includes(cmd)) throw new Error(USAGE)
	if (cmd !== "list" && !o.name) throw new Error(`${cmd} needs a name\n${USAGE}`)
	if (cmd !== "issue" && (o.out || ["--usd", "--steps", "--videos", "--mb"].some((f) => argv.includes(f)))) throw new Error(`--usd, --steps, --videos, --mb and --out go with issue\n${USAGE}`)
	return o
}

const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "")

/** Runs one command against `db`; returns the lines to print (the key itself only for issue without --out). */
export async function run(argv, { db, write = (f, s) => fs.writeFileSync(f, s, { mode: 0o600 }) } = {}) {
	const o = parse(argv)
	if (o.cmd === "issue") {
		const key = await issueAgentKey(db, o.name, { usd: o.usd, steps: o.steps, videos: o.videos, mb: o.mb })
		const caps = `$${o.usd.toFixed(2)} a day, ${o.steps} AI steps an hour, ${o.videos} new videos and ${o.mb} MB of uploads a day`
		if (o.out) {
			write(path.resolve(o.out), `${key}\n`)
			return [`Issued an agent key for "${o.name}" (${caps}), written to ${o.out} (mode 600). Hand it over privately, then delete the file.`]
		}
		return [
			`Issued an agent key for "${o.name}" (${caps}). It is shown this once (only its hash is kept); hand it over privately:`,
			"",
			key,
			"",
			`They send it as the header x-agent-key. To stop it: node tools/video-agent/keys.mjs revoke ${o.name}`,
		]
	}
	if (o.cmd === "revoke") return [(await revokeAgentKey(db, o.name)) ? `Revoked "${o.name}": its key is refused from the next request on.` : `"${o.name}" has no active key.`]
	const rows = await listAgentKeys(db)
	const table = [["name", "status", "$/day", "steps/hour", "videos/day", "MB/day", "issued", "used today", "steps today", "this hour", "videos today", "MB today"]]
	for (const r of rows)
		table.push([
			r.name,
			r.name === "owner" ? "master (AI_AGENT_KEY)" : r.revokedAt ? `revoked ${day(r.revokedAt)}` : "active",
			r.usdPerDay === null ? "env" : `$${Number(r.usdPerDay).toFixed(2)}`,
			r.stepsPerHour === null ? "env" : String(r.stepsPerHour),
			r.videosPerDay === null ? "env" : String(r.videosPerDay),
			r.uploadMbPerDay === null ? "env" : String(r.uploadMbPerDay),
			day(r.createdAt),
			`$${r.usdToday.toFixed(2)}`,
			String(r.stepsToday),
			String(r.stepsThisHour),
			String(r.videosToday),
			String(r.uploadMbToday),
		])
	const w = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)))
	return table.map((r) => r.map((c, i) => c.padEnd(w[i])).join("  ").trimEnd())
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const env = { ...readEnvFile(path.join(root, ".env.local")), ...process.env }
		if (!databaseUrl(env)) throw new Error("no DATABASE_URL: put the site's Neon connection string in blender-playground/.env.local (vercel env pull, or the Neon console)")
		parse(process.argv.slice(2)) // (usage errors before any connection)
		const db = await getDb(env)
		for (const line of await run(process.argv.slice(2), { db })) console.log(line)
	} catch (e) {
		console.error(`keys: ${String(e?.message ?? e)}`)
		process.exit(1)
	}
}
