// Concept-image generation through the TrueFoundry gateway's OpenAI-compatible images endpoint (the same call as
// ai/bench/tools/gen-images.mjs, probed 2026-10-15): POST <base without /v1>/images/generations. Over HTTP/1.1 (fetchH1: Node's fetch
// puts parallel calls on ONE HTTP/2 connection that the gateway serves one by one, which is why the bench's image log shows 16 s ... 380 s).
// The key is read from process.env only (source ~/.config/truefoundry/env in the same shell command); it is never printed, logged or stored:
// errors are scrubbed of it.
//   const r = await generateImage({ model: "openai-group/gpt-image-2.5-sunburst", prompt, size: "1536x1024", quality: "high" })
//   // {ok, b64 (PNG/JPEG base64), mime, ms, attempts, usage?, status} | {ok: false, error, status, ms, attempts}
import { fetchH1 } from "../../../research/fetch-h1.mjs"
import { gated } from "./sem.mjs"

export const IMAGE_MODELS = {
	sunburst: "openai-group/gpt-image-2.5-sunburst",
	flare: "openai-group/gpt-image-2.5-flare",
	gemini: "gemini-group/gemini-3-pro-image-preview"
}
const isGemini = (m) => /gemini/.test(m)

function scrub(s, key) {
	let t = String(s ?? "")
	if (key) t = t.split(key).join("[key]")
	return t.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [key]").slice(0, 400)
}

export async function generateImage({ model, prompt, size = "1536x1024", quality = "high", timeoutMs = 300000, retries = 2, signal, track = null } = {}) {
	const base = (process.env.TRUEFOUNDRY_BASE_URL || "https://tfy.promptlens.trilogy.com/v1").replace(/\/v1\/?$/, "")
	const key = process.env.TRUEFOUNDRY_API_KEY
	if (!key) return { ok: false, error: "TRUEFOUNDRY_API_KEY is not set", status: 0, ms: 0, attempts: [] }
	const body = { model, prompt, n: 1 }
	if (!isGemini(model)) {
		body.size = size
		if (quality) body.quality = quality
	}
	const attempts = []
	const t0 = Date.now()
	for (let attempt = 1; attempt <= retries + 1; attempt++) {
		let ta = Date.now()
		let status = 0
		let wait = 0
		try {
			const r = await gated(() => {
				ta = Date.now()
				return fetchH1(base + "/images/generations", {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
					body: JSON.stringify(body),
					signal: signal ?? AbortSignal.timeout(timeoutMs)
				}).then(async (res) => ({ res, json: await res.json().catch(() => null) }))
			}, track)
			status = r.res.status
			const d = r.json?.data?.[0]
			const b64 = d?.b64_json
			if (r.res.ok && b64) {
				const head = Buffer.from(b64.slice(0, 16), "base64")
				const mime = head[0] === 0x89 ? "image/png" : head[0] === 0xff ? "image/jpeg" : head.slice(8, 12).toString() === "WEBP" ? "image/webp" : "image/png"
				attempts.push({ ok: true, ms: Date.now() - ta, status })
				// ms: the model's own time (summed over attempts, without waiting for a slot of the experiment's cap); wallMs: with it
				return { ok: true, b64, mime, ms: attempts.reduce((s, a) => s + a.ms, 0), wallMs: Date.now() - t0, attempts, status, usage: r.json?.usage ?? null, revised_prompt: d?.revised_prompt ?? null }
			}
			const msg = scrub(r.json?.error?.message ?? r.json?.message ?? `HTTP ${status}`, key)
			attempts.push({ ok: false, ms: Date.now() - ta, status, error: msg })
			if (status === 429) wait = Number(r.res.headers.get?.("retry-after")) * 1000 || 8000 * attempt
			else if (status >= 500) wait = 4000 * attempt
			else return { ok: false, error: msg, status, ms: Date.now() - t0, attempts }
		} catch (e) {
			attempts.push({ ok: false, ms: Date.now() - ta, status, error: scrub(e?.message ?? e, key) })
			wait = 4000 * attempt
		}
		if (attempt <= retries) await new Promise((res) => setTimeout(res, wait))
	}
	return { ok: false, error: attempts.at(-1)?.error ?? "failed", status: attempts.at(-1)?.status ?? 0, ms: Date.now() - t0, attempts }
}
