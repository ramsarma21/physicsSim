// Reference implementation of the server step that imagine-first would add (POST /api/ai/imagine), built from this experiment's modules
// so the integrator can move it into ai/steps.mjs as one more RUNNER. Not wired into the app (this experiment may not edit app files).
//
//   payload {text* (the request), n? (1-3 concepts in parallel; 1 by default), pick? (true: the cheap vision check rates each and the best
//            comes first; default when n > 1)}
//   answer  {concepts: [{data: "data:image/jpeg;base64,..." (≤ 1536 px, q 0.85: what the client sends on to observe/plan), score?, problems?}],
//            cast: [{type, count, role, size}], missing, layout, story, prompt (the image prompt, for the record), ms: {prepass, image, check},
//            usage (the text calls), image_tokens}
//
// What it does (the experiment's measured flow): (1) the cast pre-pass, Opus 5.5 at low effort against the catalog brief (lib/cast.mjs:
// catalog keys + counts + true sizes + a start layout that would really work); (2) the image prompt (lib/prompts.mjs, the template the
// experiment picked); (3) n concepts in parallel on the image route (lib/image.mjs: /images/generations over HTTP/1.1, the key from the env
// only); (4) with n > 1 each concept is rated by the vision check (lib/check.mjs, Opus 5.5 low) and the best is put first.
// Downscaling uses `sips` here (macOS, like the bench); on the server use sharp or the client's own prepareImages().
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { castFor } from "../lib/cast.mjs"
import { checkConcept, checkSummary } from "../lib/check.mjs"
import { generateImage, IMAGE_MODELS } from "../lib/image.mjs"
import { imagePrompt } from "../lib/prompts.mjs"

export const IMAGINE_DEFAULTS = { model: "sunburst", template: "photo", quality: "high", size: "1536x1024", checker: "opus-low" }

function jpegDataUrl(b64) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imagine-"))
	try {
		const src = path.join(dir, "in.png")
		const out = path.join(dir, "out.jpg")
		fs.writeFileSync(src, Buffer.from(b64, "base64"))
		execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", "1536", src, "--out", out], { stdio: "ignore" })
		return `data:image/jpeg;base64,${fs.readFileSync(out).toString("base64")}`
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

export async function imagine(payload, o = {}) {
	const text = String(payload?.text ?? "").trim()
	if (!text) throw Object.assign(new Error("text is missing"), { code: "bad_input" })
	const n = Math.max(1, Math.min(3, Number(payload.n ?? 1) | 0))
	const pick = payload.pick ?? n > 1
	const cfg = { ...IMAGINE_DEFAULTS, ...(o.config ?? {}) }
	const t0 = Date.now()
	const pre = await castFor(text, { model: "opus-low", signal: o.signal })
	if (!pre.ok) throw Object.assign(new Error(`the pre-pass failed: ${pre.error?.message ?? "?"}`), { code: "gateway" })
	const t1 = Date.now()
	const prompt = await imagePrompt(cfg.template, text, pre.result)
	const gens = await Promise.all(Array.from({ length: n }, () => generateImage({ model: IMAGE_MODELS[cfg.model], prompt, quality: cfg.quality, size: cfg.size, signal: o.signal })))
	const ok = gens.filter((g) => g.ok)
	if (!ok.length) throw Object.assign(new Error(`no concept image: ${gens[0]?.error ?? "?"}`), { code: "gateway" })
	const t2 = Date.now()
	let concepts = ok.map((g) => ({ data: jpegDataUrl(g.b64), tokens: g.usage?.output_tokens ?? null }))
	if (pick && concepts.length > 1) {
		const checks = await Promise.all(concepts.map((c) => checkConcept({ dataUrl: c.data, request: text, prepass: pre.result, model: cfg.checker, signal: o.signal })))
		concepts = concepts.map((c, i) => {
			const r = checks[i]
			const s = r.ok ? checkSummary(r.result, pre.result) : null
			// the experiment's pick: the check's score, + 0.5 when every count is right, − 0.2 per extra object (at most 3)
			const rank = r.ok ? r.result.score_0_10 + (s?.exact ?? 0) * 0.5 - Math.min(3, s?.extras ?? 0) * 0.2 : -1
			return { ...c, score: r.ok ? r.result.score_0_10 : null, problems: r.ok ? r.result.problems : [], rank }
		})
		concepts.sort((a, b) => b.rank - a.rank)
	}
	return {
		concepts: concepts.map(({ rank, ...c }) => c),
		cast: pre.result.cast,
		missing: pre.result.missing,
		layout: pre.result.layout,
		story: pre.result.story,
		prompt,
		ms: { prepass: t1 - t0, image: t2 - t1, check: Date.now() - t2, total: Date.now() - t0 },
		usage: pre.usage
	}
}
