// The directed camera end to end, as a caller of the app does it: open each scene in the app's page for the drawn models' boxes, ask the
// app's server for a shot plan with them (POST /api/ai/direct: the live director, Opus 5.5, its plan measured on those boxes) for each of the
// design's twelve examples (plans/lessons.json: the lesson or demo and the run, or one run per lane), then export
// each video's MP4 in the app's own page, headless (the view's "director-plan" camera and web/export/encoder.js, as the export dialog does; a
// comparison filmed one run per lane is filmed lane by lane with one film and its bands put together, as the lesson compositor does), and put
// a contact sheet together from the MP4's own frames (each shot's first, middle and last frame, and today's Wide at the shot's middle moment).
//   node web/export/test/direct-e2e.mjs ask  --server http://127.0.0.1:<port> --out <dir> [--only 01,05]     the plans (live: minutes, dollars)
//   node web/export/test/direct-e2e.mjs film --server http://127.0.0.1:<port> --out <dir> [--only ...] [--size 1280x720] [--fps 30] [--blur 8]
// Writes <out>/<example>/: request.json, result.json (the step's whole answer: every round, usage), plan.json, checks.json (the engine's
// measured checks of the plan the step returned), video.mp4, sheet.jpg, film.json (the shots as filmed), stills/. The server is this
// repository's own (python3 web/server.py <port>, whose AI steps source ~/.config/truefoundry/env themselves). Headless Chromium only.
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..")
const argv = process.argv.slice(2)
const MODE = argv[0]
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const SERVER = opt("--server", "http://127.0.0.1:9531")
const OUT = path.resolve(opt("--out", path.join(os.tmpdir(), "direct-e2e")))
const ONLY = opt("--only", "") ? opt("--only", "").split(",") : null
const [W, H] = opt("--size", "1280x720").split("x").map(Number)
const FPS = Number(opt("--fps", 30))
const BLUR = Number(opt("--blur", 8))
const EXAMPLES = JSON.parse(readFileSync(path.join(HERE, "plans", "lessons.json"), "utf8")).examples
const names = Object.keys(EXAMPLES).filter((n) => !ONLY || ONLY.some((o) => n.startsWith(o)))
const readScene = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"))
const scenesOf = (ex) => (ex.runs ? Object.fromEntries(Object.entries(ex.runs).map(([l, p]) => [l, readScene(p)])) : { "": readScene(ex.scene) })
const log = (name, s) => console.log(`${new Date().toISOString().slice(11, 19)} [${name}] ${s}`)
mkdirSync(OUT, { recursive: true })

if (MODE === "ask") await ask()
else if (MODE === "film") await film()
else {
	console.error("usage: direct-e2e.mjs ask|film --server <url> --out <dir> [--only 01,05]")
	process.exit(2)
}

// ------------------------------------------------------------------------------------------------ ask: the director's plans, live
async function ask() {
	// the drawn models' boxes of every run, from the app's own page (what the video will show), then every director at once
	const boxes = await pageBoxes()
	const rows = await Promise.all(names.map((n) => askOne(n, boxes[n])))
	writeFileSync(path.join(OUT, "ask-summary.json"), JSON.stringify(rows, null, 1))
	for (const r of rows) console.log(r.line)
	process.exit(rows.some((r) => !r.ok) ? 1 : 0)
}
async function askOne(name, boxes) {
	const ex = EXAMPLES[name]
	const dir = path.join(OUT, name)
	mkdirSync(dir, { recursive: true })
	const scenes = scenesOf(ex)
	const payload = { ...ex.payload, ...(ex.runs ? { runs: scenes } : { scene: scenes[""] }), ...(boxes ? { boxes: ex.runs ? boxes : boxes[""] } : {}), return_digest: true }
	const requestId = `e2e-${name}-${Date.now().toString(36)}`
	writeFileSync(path.join(dir, "request.json"), JSON.stringify({ example: name, requestId, payload: { ...payload, ...(ex.runs ? { runs: ex.runs } : { scene: ex.scene }), ...(payload.boxes ? { boxes: `(${Object.keys(ex.runs ? payload.boxes : { "": payload.boxes }).map((l) => `${l || "the run"}: ${Object.keys(ex.runs ? payload.boxes[l] : payload.boxes).length} model boxes`).join(", ")})` } : {}) } }, null, 1))
	const t0 = Date.now()
	let last = ""
	const poll = setInterval(async () => {
		try {
			const p = await (await fetch(`${SERVER}/api/ai/progress?id=${encodeURIComponent(requestId)}`)).json()
			const s = p?.state ? `${p.state}${p.model ? ` ${p.model}` : ""}${p.attempt ? ` attempt ${p.attempt}` : ""}${p.repair ? " (repair)" : ""}${p.phase ? ` ${p.phase}` : ""}${p.tokens ? ` ~${p.tokens} tokens` : ""}` : ""
			if (s && s.replace(/~\d+/, "") !== last.replace(/~\d+/, "")) log(name, `${Math.round((Date.now() - t0) / 1000)} s ${s}`)
			last = s || last
		} catch {}
	}, 5000)
	let res
	try {
		const r = await fetch(`${SERVER}/api/ai/direct`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload, client: { requestId } }), signal: AbortSignal.timeout(900000) })
		res = await r.json()
		res.status = r.status
	} catch (e) {
		res = { ok: false, error: String(e?.message ?? e) }
	} finally {
		clearInterval(poll)
	}
	const secs = Math.round((Date.now() - t0) / 1000)
	if (!res.ok) {
		writeFileSync(path.join(dir, "error.json"), JSON.stringify(res, null, 1))
		return { example: name, ok: false, line: `${name}: FAILED ${res.status ?? ""} ${res.code ?? ""} ${res.error ?? ""} (${secs} s)` }
	}
	const R = res.result
	writeFileSync(path.join(dir, "plan.json"), JSON.stringify(R.plan, null, "\t") + "\n")
	writeFileSync(path.join(dir, "checks.json"), JSON.stringify({ source: R.source, measured: R.measured, ok: R.report?.ok ?? null, failed: (R.report?.checks ?? []).filter((c) => c.ok === false), checks: R.report?.checks ?? [], shots: R.report?.shots ?? [], timing: R.timing ?? null, fallback: R.fallback ?? null }, null, 1))
	if (R.digest?.text) writeFileSync(path.join(dir, "digest.txt"), R.digest.text + "\n")
	const { digest, ...rest } = R
	writeFileSync(path.join(dir, "result.json"), JSON.stringify({ ...res, result: { ...rest, digest: digest ? { hash: digest.hash } : null } }, null, 1))
	const usd = Number(res.usage?.costInUSD)
	const line = `${name}: ${R.source} plan, ${R.plan.shots.length} shots, ${R.timing?.seconds ?? "?"} s of video; checks ${R.measured ? (R.report?.ok ? "all pass" : `${(R.report?.checks ?? []).filter((c) => c.ok === false).length} failed`) : "not measured"}; rounds ${(R.rounds ?? []).map((x) => `${x.round}:${x.ok ? "ok" : `${x.failed.length} failed`}`).join(" ")}; ${secs} s, $${Number.isFinite(usd) ? usd.toFixed(3) : "?"}; ${res.model ?? ""}${res.warnings?.length ? `; warnings: ${res.warnings.join(" | ").slice(0, 300)}` : ""}`
	writeFileSync(path.join(dir, "summary.txt"), line + "\n" + R.shots.map((s) => `  ${s.id} [${s.beat}] ${s.move} ${s.seconds ?? "?"} s: ${s.why}`).join("\n") + "\n")
	log(name, line)
	return { example: name, ok: true, source: R.source, measured: R.measured, passed: R.report?.ok ?? null, seconds: secs, usd: Number.isFinite(usd) ? usd : null, line }
}

// ------------------------------------------------------------------------------------------------ the app's page
async function launch() {
	const { chromium } = require(process.env.PLAYWRIGHT_CORE || path.join(os.homedir(), ".bun/install/cache/playwright-core@1.60.0@@@1"))
	const CHROME = [path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"), path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell")].find((p) => existsSync(p))
	return chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--use-mock-keychain", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] })
}
/** The app opened and its first run settled, with window.__open(scene) -> runId (the scene's run landed, every model built). */
async function openApp(page) {
	await page.goto(`${SERVER}/?profile=directe2e&quality=high`, { waitUntil: "domcontentloaded" })
	await page.waitForFunction(() => window.sandbox?.view && window.sandboxApp, null, { timeout: 180000 })
	await page.waitForFunction(() => {
		const S = window.sandbox
		return S.sim && !S.layout && S.view.exportInfo().ready
	}, null, { timeout: 180000 })
	await page.evaluate(() => {
		window.__open = async (scene) => {
			const S = window.sandbox
			S.playing = false
			const before = S.sim
			window.sandboxApp.open(scene)
			const t0 = performance.now()
			while (performance.now() - t0 < 180000) {
				const i = S.view.exportInfo()
				if (S.sim && S.sim !== before && !S.layout && i.ready && S.view._debug.run && S.view._debug.run.doc === S.sim.doc) break
				await new Promise((r) => setTimeout(r, 100))
			}
			await S.view.whenSettled()
			return S.view.exportInfo().runId
		}
	})
}
/** Each example's runs' drawn model boxes ({example: {lane: boxes}}), as the export dialog, the skill or the compositor hands them to the director. */
async function pageBoxes() {
	const browser = await launch()
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
	await openApp(page)
	const out = {}
	for (const name of names) {
		const scenes = scenesOf(EXAMPLES[name])
		out[name] = {}
		for (const [lane, scene] of Object.entries(scenes)) out[name][lane] = await page.evaluate(async (sc) => (await window.__open(sc), window.sandbox.view.exportBoxes()), scene)
		log(name, `model boxes: ${Object.entries(out[name]).map(([l, b]) => `${l || "the run"} ${Object.keys(b ?? {}).length}`).join(", ")}`)
	}
	await browser.close()
	return out
}

// ------------------------------------------------------------------------------------------------ film: each plan's MP4 in the app's page
async function film() {
	const browser = await launch()
	const summary = []
	for (const name of names) {
		const dir = path.join(OUT, name)
		if (!existsSync(path.join(dir, "plan.json"))) {
			log(name, "no plan.json: ask first")
			summary.push({ example: name, error: "no plan" })
			continue
		}
		const plan = JSON.parse(readFileSync(path.join(dir, "plan.json"), "utf8"))
		const scenes = scenesOf(EXAMPLES[name])
		const t0 = Date.now()
		// (a fresh page per video: each export starts from the app as a person opens it)
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
		const errors = []
		page.on("pageerror", (e) => errors.push(e.message))
		try {
			const res = await filmOne(page, plan, scenes)
			if (res.error) throw new Error(res.error)
			writeFileSync(path.join(dir, "video.mp4"), Buffer.from(res.mp4, "base64"))
			writeFileSync(path.join(dir, "film.json"), JSON.stringify({ duration: res.duration, frames: res.frames, size: [W, H], fps: FPS, blur: BLUR, lanes: Object.keys(scenes), sound: res.sound, shots: res.shots, notes: res.notes, pageReport: res.report, frameMs: res.frameMs, errors }, null, 1))
			mkdirSync(path.join(dir, "stills"), { recursive: true })
			for (const w of res.wide) writeFileSync(path.join(dir, "stills", `wide-${w.shot}.jpg`), Buffer.from(w.b64, "base64"))
			const sheet = contactSheet(dir, res.shots, res.report)
			const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,nb_frames", "-of", "json", path.join(dir, "video.mp4")], { encoding: "utf8" }))
			const row = { example: name, duration: res.duration, frames: res.frames, mp4: probe, ok: res.report?.ok ?? null, failed: res.report?.failed ?? [], sheet, seconds: Math.round((Date.now() - t0) / 1000), frameMsMedian: res.frameMs, errors }
			summary.push(row)
			log(name, `MP4 ${res.duration.toFixed(2)} s, ${res.frames} frames, ${probe.streams?.map((s) => `${s.codec_name} ${s.width ?? ""}${s.height ? "x" + s.height : ""}`).join(" + ")}; page checks ${row.ok ? "all pass" : `FAIL ${row.failed.length}: ${row.failed.slice(0, 3).join(" | ")}`}; ${row.seconds} s`)
		} catch (e) {
			log(name, `ERROR ${e.message}`)
			summary.push({ example: name, error: e.message, errors })
		} finally {
			await page.close()
		}
	}
	await browser.close()
	writeFileSync(path.join(OUT, "film-summary.json"), JSON.stringify(summary, null, 1))
	process.exit(summary.some((s) => s.error) ? 1 : 0)
}

async function filmOne(page, plan, scenes) {
	await openApp(page)
	return page.evaluate(
		async ({ plan, scenes, W, H, FPS, BLUR }) => {
			const S = window.sandbox
			const open = window.__open
			const jpeg = async (cv, q = 0.9) => {
				const blob = await cv.convertToBlob({ type: "image/jpeg", quality: q })
				return blob
			}
			const b64 = async (blob) => {
				const buf = new Uint8Array(await blob.arrayBuffer())
				let s = ""
				for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000))
				return btoa(s)
			}
			const enc = await import("/export/encoder.js")
			const lanes = Object.keys(scenes)
			const perLane = !(lanes.length === 1 && lanes[0] === "")
			const base = { camera: "director-plan", width: W, height: H, fps: FPS }
			// ---- the film: one run; or (one run per lane) planned once from every lane's run and model boxes, as the compositor does
			let opts
			let report = null
			if (!perLane) {
				await open(scenes[""])
				opts = { ...base, plan }
			} else {
				const others = {}
				for (const lane of lanes.slice(1)) {
					await open(scenes[lane])
					others[lane] = { sim: S.sim, boxes: S.view.exportBoxes(), scene: scenes[lane] }
				}
				await open(scenes[lanes[0]])
				const made = S.view.exportPlan({ ...base, plan, runs: others, lane: lanes[0] })
				report = made.report
				opts = { ...base, film: JSON.parse(JSON.stringify(made.film)) }
			}
			const info = S.view.exportInfo(perLane ? { ...opts, lane: lanes[0] } : opts)
			if (!info.plan) return { error: info.planError ?? "the view made no film of this plan" }
			report ??= info.plan.report
			const frames = info.plan.frameCount
			const shots = info.plan.shots
			const shotAt = new Map(shots.flatMap((s) => Array.from({ length: s.frames[1] - s.frames[0] + 1 }, (_, j) => [s.frames[0] + j, s])))
			const blur = BLUR > 1 ? { samples: BLUR } : 0
			const times = []
			// ---- the other lanes' frames first (one run per lane): every frame of each, kept as JPEG
			const kept = new Map()
			for (const lane of perLane ? lanes.slice(1) : []) {
				const runId = await open(scenes[lane])
				const list = []
				for (let i = 0; i < frames; i++) {
					const cv = await S.view.renderFrame(i / FPS, { ...opts, runId, lane, motionBlur: blur, quality: "high" })
					list.push(await jpeg(cv, 0.95))
				}
				kept.set(lane, list)
				S.view.endExport()
			}
			// ---- the video: the first lane's run (or the one run) drawn frame by frame into the app's encoder, the other lanes' bands laid over
			const runId = await open(scenes[lanes[0]])
			const comp = new OffscreenCanvas(W, H)
			const g = comp.getContext("2d")
			let sound = null
			if (!perLane && typeof enc.synthesizeImpacts !== "function") {
				// (the encoder module has no sound maker: audio.js's, with each hit retimed to when the video shows it)
			}
			try {
				const audio = await import("/export/audio.js")
				const Shots = S.view._debug.export.Shots
				const film = S.view._debug.export.plan("director-plan", W, H, FPS, opts)?.film
				if (!perLane && film && typeof audio.synthesizeImpacts === "function" && typeof Shots?.retime === "function") {
					const impacts = Shots.retime(film, S.sim.track?.impacts ?? [])
					if (impacts.length) {
						sound = await audio.synthesizeImpacts(impacts, S.sim.doc, { duration: film.duration, sampleRate: 48000, track: S.sim.track, stage: scenes[""].stage, tones: false, panAt: (t, x, y) => S.view.exportProject(t, x, y, opts) })
					}
				}
			} catch (e) {
				console.warn("sound:", e)
			}
			const frame = async (i) => {
				const t1 = performance.now()
				const cv = await S.view.renderFrame(i / FPS, { ...opts, runId, ...(perLane ? { lane: lanes[0] } : {}), motionBlur: blur, quality: "high", index: i, frames })
				times.push(performance.now() - t1)
				if (!perLane) return cv
				g.drawImage(cv, 0, 0)
				const s = shotAt.get(i)
				for (const b of s?.bands ?? []) {
					if (!b.lane || b.lane === lanes[0] || !kept.has(b.lane)) continue
					const bm = await createImageBitmap(kept.get(b.lane)[i])
					const [x, y, w, h] = b.rect
					g.drawImage(bm, x, y, w, h, x, y, w, h)
					bm.close()
				}
				return comp
			}
			const out = await enc.encodeMp4({ frames: frame, frameCount: frames, fps: FPS, width: W, height: H, audio: sound, title: plan.title || "Directed" })
			const blob = out instanceof Blob ? out : out?.blob ?? out
			// ---- today's Wide at each shot's middle moment (the first lane's run), for the sheet
			const wide = []
			for (const s of shots) {
				const mid = Math.round((s.frames[0] + s.frames[1]) / 2)
				const cam = S.view.exportCamera(mid / FPS, { ...opts, ...(perLane ? { lane: lanes[0] } : {}) })
				const cv = await S.view.renderFrame(cam.t, { camera: "wide", width: W, height: H, runId, motionBlur: blur })
				wide.push({ shot: s.id, b64: await b64(await jpeg(cv, 0.85)) })
			}
			S.view.endExport()
			times.sort((a, b) => a - b)
			return { mp4: await b64(blob), duration: frames / FPS, frames, shots, report, notes: info.plan.plan?.notes ?? null, wide, sound: !!sound, frameMs: Math.round(times[times.length >> 1] ?? 0) }
		},
		{ plan, scenes, W, H, FPS, BLUR },
	)
}

/** The contact sheet from the MP4's own frames: per shot its first, middle and last frame, then today's Wide at its middle moment. */
function contactSheet(dir, shots, report) {
	const mp4 = path.join(dir, "video.mp4")
	const stills = path.join(dir, "stills")
	mkdirSync(stills, { recursive: true })
	const rows = []
	for (const s of shots) {
		const [i0, i1] = s.frames
		const picks = [...new Set([i0, Math.round((i0 + i1) / 2), i1])]
		const files = []
		for (const i of picks) {
			const f = path.join(stills, `${s.id}-f${String(i).padStart(4, "0")}.png`)
			execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", Math.max(0, (i - 0.3) / FPS).toFixed(4), "-i", mp4, "-frames:v", "1", f])
			files.push(f)
		}
		const rep = report?.shots?.find((x) => x.id === s.id)
		const sizes = rep?.heroes?.length ? rep.heroes.map((h) => `${h.what}${h.lane ? "@" + h.lane : ""} ${h.s}`).join(", ") : rep?.size?.map((z) => z.s).join("/") ?? ""
		const head = `${s.id} · ${s.move}${s.layout && s.layout !== "single" ? ` · ${s.layout}` : ""}${s.rate !== 1 ? ` · ${s.rate === 0 ? "freeze" : `x${s.rate}`}` : ""} · video ${s.video[0].toFixed(1)}-${s.video[1].toFixed(1)} s · run ${s.run[0].toFixed(2)}-${s.run[1].toFixed(2)} s${sizes ? ` · ${sizes}` : ""}`
		rows.push({ head, files, wide: path.join(stills, `wide-${s.id}.jpg`) })
	}
	const spec = path.join(dir, "sheet-spec.json")
	writeFileSync(spec, JSON.stringify({ rows, out: path.join(dir, "sheet.jpg") }))
	execFileSync("python3", ["-I", path.join(HERE, "sheet.py"), spec])
	return path.join(dir, "sheet.jpg")
}
