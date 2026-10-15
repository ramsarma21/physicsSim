// Generates the bench's reference images (photoreal + hand-drawn sketches) through the TrueFoundry gateway's OpenAI-compatible
// images endpoint. The key is read from the environment only (never printed or written):
//   zsh -c 'source ~/.config/truefoundry/env && node ai/bench/tools/gen-images.mjs <outDir> [ids...] [--models=a,b] [--n=1]'
// Writes <outDir>/<id>__<model-slug>__<k>.png and <outDir>/gen-log.jsonl (id, model, ms, bytes, status; no secrets).
// Gateway notes (probed 2026-10-15): POST <base without /v1>/images/generations works (the /v1 path answers 404);
// openai-group/gpt-image-2 | gpt-image-2.5-flare | gpt-image-2.5-sunburst | gpt-image-1.5 take size 1536x1024 + quality high;
// gemini-group/gemini-3-pro-image-preview answers 1024x1024 only (size/quality are ignored) and refuses /chat/completions.
import fs from "node:fs"
import path from "node:path"
import { PROMPTS } from "./image-prompts.mjs"

const args = process.argv.slice(2)
const outDir = args.find((a) => !a.startsWith("--"))
if (!outDir) { console.error("usage: gen-images.mjs <outDir> [ids...] [--models=...] [--n=1]"); process.exit(2) }
const ids = args.filter((a) => !a.startsWith("--")).slice(1)
const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")))
const base = (process.env.TRUEFOUNDRY_BASE_URL || "").replace(/\/v1\/?$/, "")
const key = process.env.TRUEFOUNDRY_API_KEY
if (!base || !key) { console.error("TRUEFOUNDRY_API_KEY / TRUEFOUNDRY_BASE_URL not set (source ~/.config/truefoundry/env in the same command)"); process.exit(2) }
const models = (opt.models || "openai-group/gpt-image-2,openai-group/gpt-image-2.5-sunburst,gemini-group/gemini-3-pro-image-preview").split(",")
const n = Number(opt.n || 1)
const conc = Number(opt.conc || 6)
fs.mkdirSync(outDir, { recursive: true })
const log = fs.createWriteStream(path.join(outDir, "gen-log.jsonl"), { flags: "a" })
const slug = (m) => m.replace(/^.*\//, "").replace(/[^a-z0-9.]+/gi, "-")

const jobs = []
for (const p of PROMPTS) if (!ids.length || ids.includes(p.id)) for (const m of p.models ?? models) for (let k = 0; k < n; k++) jobs.push({ p, m, k })

async function one({ p, m, k }) {
	const file = path.join(outDir, `${p.id}__${slug(m)}__${k}.png`)
	if (fs.existsSync(file)) return console.log("skip", file)
	const body = { model: m, prompt: p.prompt, n: 1 }
	if (!m.startsWith("gemini")) { body.size = p.size || "1536x1024"; body.quality = "high" }
	const t0 = Date.now()
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const r = await fetch(base + "/images/generations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(400000) })
			const j = await r.json().catch(() => null)
			const b64 = j?.data?.[0]?.b64_json
			if (r.ok && b64) {
				fs.writeFileSync(file, Buffer.from(b64, "base64"))
				const rec = { id: p.id, model: m, k, ms: Date.now() - t0, bytes: fs.statSync(file).size, status: r.status, attempt }
				log.write(JSON.stringify(rec) + "\n")
				return console.log("ok", JSON.stringify(rec))
			}
			const msg = (j?.error?.message || j?.message || `HTTP ${r.status}`).slice(0, 200)
			log.write(JSON.stringify({ id: p.id, model: m, k, status: r.status, error: msg, attempt }) + "\n")
			console.log("fail", p.id, m, r.status, msg)
			if (r.status < 500 && r.status !== 429) return
		} catch (e) {
			console.log("error", p.id, m, String(e.message).slice(0, 120))
		}
		await new Promise((res) => setTimeout(res, 4000 * attempt))
	}
}
let next = 0
await Promise.all(Array.from({ length: Math.min(conc, jobs.length) }, async () => { while (next < jobs.length) await one(jobs[next++]) }))
log.end()
