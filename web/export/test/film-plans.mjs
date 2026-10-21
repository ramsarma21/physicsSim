// Films the design's twelve worked shot plans (web/export/test/plans) through the sandbox's own export renderer, headless, and writes for every
// shot its first, middle and last frame (each stop of a travel that dwells), today's Wide camera at the shot's middle moment, a contact sheet per
// plan, and a report: the safety net measured in the page on the drawn models' boxes, the time a frame takes, a determinism check (the same frame
// drawn again after a later one, with motion blur: the same bytes) and a projection check (each band's look point lands at the middle of its
// band). A plan of one run per lane is filmed as the lesson compositor will: the other lane's run and model boxes are handed to the plan, the plan
// is compiled once (exportPlan), each lane's run is filmed with that same film ({film, lane}), and the bands are put together.
//   node web/export/test/film-plans.mjs --server http://127.0.0.1:<port> --out <dir> [--size 1280x720] [--fps 30] [--blur 8] [--only 01,05]
//   node web/export/test/film-plans.mjs --focus ...   the automatic plan instead (camera "focus") on the 12 scenarios, the 10 gallery scenes
//                                                     and the plans' scenes (one run each)
//   LESSON_SCENES=<lesson-regen/compositor/build2/scenes>   the lesson compositor's lane scenes (plans 02, 03, 04; skipped without it)
// The server is this repository's own (python3 web/server.py <port>); only GET and POST /api/... are asked. Headless Chromium only.
import { createRequire } from "node:module"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..")
const argv = process.argv.slice(2)
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const SERVER = opt("--server", "http://127.0.0.1:9511")
const OUT = path.resolve(opt("--out", path.join(os.tmpdir(), "film-plans")))
const [W, H] = opt("--size", "1280x720").split("x").map(Number)
const FPS = Number(opt("--fps", 30))
const BLUR = Number(opt("--blur", 8))
const ONLY = opt("--only", "") ? opt("--only", "").split(",") : null
const FOCUS = argv.includes("--focus")
const LESSON = process.env.LESSON_SCENES ?? null
const { chromium } = require(process.env.PLAYWRIGHT_CORE || path.join(os.homedir(), ".bun/install/cache/playwright-core@1.60.0@@@1"))
const CHROME = [path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"), path.join(os.homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell")].find((p) => existsSync(p))

const planIndex = JSON.parse(readFileSync(path.join(HERE, "plans", "index.json"), "utf8")).plans
// the jobs: each design plan with its runs, or (--focus) each scene with the automatic plan
const index = {}
if (!FOCUS) Object.assign(index, planIndex)
else {
	const seen = new Set()
	const add = (p) => {
		if (seen.has(p)) return
		seen.add(p)
		index[`focus-${path.basename(p).replace(/\.(scene\.)?json$/, "")}`] = { "": p }
	}
	for (const s of JSON.parse(readFileSync(path.join(ROOT, "web", "scenario-list.json"), "utf8"))) if (s.id !== "empty") add(`web/scenarios/${s.id}.json`)
	for (const g of JSON.parse(readFileSync(path.join(ROOT, "web", "gallery", "index.json"), "utf8"))) add(`web/${g.scene}`)
	for (const runs of Object.values(planIndex)) for (const p of Object.values(runs)) add(p)
}
const sceneOf = (p) => {
	if (p.startsWith("$LESSON_SCENES/")) return LESSON ? path.join(LESSON, p.slice("$LESSON_SCENES/".length)) : null
	return path.join(ROOT, p)
}
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--use-mock-keychain", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const errors = []
page.on("pageerror", (e) => errors.push(e.message))
await page.goto(`${SERVER}/?profile=filmplans&quality=high`, { waitUntil: "domcontentloaded" })
await page.waitForFunction(() => window.sandbox?.view && window.sandboxApp, null, { timeout: 180000 })
await page.waitForFunction(() => {
	const S = window.sandbox
	return S.sim && !S.layout && S.view.exportInfo().ready
}, null, { timeout: 180000 })
// in the page: open a scene and wait for its run and every model; draw frames; put a sheet together
await page.evaluate(() => {
	window.__film = {
		async open(scene) {
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
		},
		async jpeg(cv) {
			const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.88 })
			const buf = new Uint8Array(await blob.arrayBuffer())
			let s = ""
			for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000))
			return btoa(s)
		},
		hash(data) {
			let h1 = 0xdeadbeef
			let h2 = 0x41c6ce57
			for (let i = 0; i < data.length; i++) {
				h1 = Math.imul(h1 ^ data[i], 2654435761)
				h2 = Math.imul(h2 ^ data[i], 1597334677)
			}
			return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, "0")
		},
		frames: new Map(),
	}
})

const summary = []
for (const [name, runs] of Object.entries(index)) {
	if (ONLY && !ONLY.some((o) => name.startsWith(o))) continue
	const files = Object.fromEntries(Object.entries(runs).map(([lane, p]) => [lane, sceneOf(p)]))
	if (Object.values(files).some((f) => !f || !existsSync(f))) {
		console.log(`${name}: skipped (its lane scenes are the lesson compositor's: set LESSON_SCENES)`)
		summary.push({ plan: name, skipped: true })
		continue
	}
	const plan = FOCUS ? null : JSON.parse(readFileSync(path.join(HERE, "plans", `${name}.json`), "utf8"))
	const scenes = Object.fromEntries(Object.entries(files).map(([lane, f]) => [lane, JSON.parse(readFileSync(f, "utf8"))]))
	const dir = path.join(OUT, name)
	mkdirSync(dir, { recursive: true })
	const t0 = Date.now()
	const res = await page.evaluate(
		async ({ plan, scenes, W, H, FPS, BLUR }) => {
			const F = window.__film
			const S = window.sandbox
			const lanes = Object.keys(scenes)
			const perLane = !(lanes.length === 1 && lanes[0] === "")
			const base = { camera: plan ? "director-plan" : "focus", width: W, height: H, fps: FPS }
			const out = { pics: [], report: null, ms: [], checks: {} }
			// ---- the film: one run, or the first lane's run with the others' runs and model boxes handed in
			let opts
			if (!plan) {
				await F.open(scenes[""])
				opts = { ...base, focus: { scene: scenes[""] } }
			} else if (!perLane) {
				await F.open(scenes[""])
				opts = { ...base, plan }
			} else {
				const others = {}
				for (const lane of lanes.slice(1)) {
					await F.open(scenes[lane])
					others[lane] = { sim: S.sim, boxes: S.view.exportBoxes(), scene: scenes[lane] }
				}
				await F.open(scenes[lanes[0]])
				const made = S.view.exportPlan({ ...base, plan, runs: others, lane: lanes[0] })
				out.report = made.report
				opts = { ...base, film: JSON.parse(JSON.stringify(made.film)) } // (as the compositor holds it: data)
			}
			const info = S.view.exportInfo(perLane ? { ...opts, lane: lanes[0] } : opts)
			if (!info.plan) return { error: info.planError ?? "no plan" }
			out.report ??= info.plan.report
			out.notes = info.plan.plan?.notes ?? null
			out.duration = info.plan.duration
			out.shots = info.plan.shots
			// ---- which frames: each shot's first, middle and last (each stop of a travel that dwells), and today's Wide at the middle one's moment
			const picks = []
			for (const s of info.plan.shots) {
				const [i0, i1] = s.frames
				const list = [i0, Math.round((i0 + i1) / 2), i1]
				for (const i of [...new Set(list)]) picks.push({ shot: s.id, i, mid: i === Math.round((i0 + i1) / 2) })
			}
			const lanesFilm = perLane ? lanes : [""]
			const drawn = new Map()
			for (const lane of lanesFilm) {
				const runId = perLane ? await F.open(scenes[lane]) : S.view.exportInfo().runId
				for (const p of picks) {
					const o = { ...opts, runId, motionBlur: BLUR > 1 ? { samples: BLUR } : 0, ...(perLane ? { lane } : {}) }
					const t1 = performance.now()
					const cv = await S.view.renderFrame(p.i / FPS, o)
					out.ms.push(performance.now() - t1)
					drawn.set(`${lane}|${p.i}`, await createImageBitmap(cv))
				}
				if (lane === lanesFilm[0]) {
					// determinism: a frame drawn again after a later one gives the same bytes (motion blur on)
					const k = picks[Math.min(1, picks.length - 1)].i
					const o = { ...opts, runId, motionBlur: BLUR > 1 ? { samples: BLUR } : 0, output: "imagedata", ...(perLane ? { lane } : {}) }
					const a = F.hash((await S.view.renderFrame(k / FPS, o)).data)
					await S.view.renderFrame(picks[picks.length - 1].i / FPS, o)
					const b = F.hash((await S.view.renderFrame(k / FPS, o)).data)
					out.checks.deterministic = a === b
					// projection: each band's look point lands at the middle of its band (exportProject through exportCamera's own cameras)
					let worst = 0
					for (const p of picks) {
						const cam = S.view.exportCamera(p.i / FPS, { ...opts, ...(perLane ? { lane } : {}) })
						for (const bd of cam.bands) {
							if (bd.inset || (perLane && bd.lane && bd.lane !== lane)) continue
							const q = S.view.exportProject(p.i / FPS, bd.target[0], bd.target[1], { ...opts, ...(perLane ? { lane: bd.lane ?? lane } : { lane: bd.lane ?? undefined }), xy: true, z: bd.target[2] })
							if (!q) continue
							const ex = ((bd.rect[0] + bd.rect[2] / 2) / W) * 2 - 1
							const ey = 1 - ((bd.rect[1] + bd.rect[3] / 2) / H) * 2
							worst = Math.max(worst, Math.abs(q.x - ex), Math.abs(q.y - ey))
						}
					}
					out.checks.projectionError = worst
					// today's Wide at each shot's middle moment (the first lane's run)
					for (const p of picks.filter((x) => x.mid)) {
						const cam = S.view.exportCamera(p.i / FPS, { ...opts, ...(perLane ? { lane } : {}) })
						const cv = await S.view.renderFrame(cam.t, { camera: "wide", width: W, height: H, runId, motionBlur: BLUR > 1 ? { samples: BLUR } : 0 })
						drawn.set(`wide|${p.i}`, await createImageBitmap(cv))
					}
				}
				S.view.endExport()
			}
			// ---- the frames as the video shows them (one run per lane: each band from its own lane's run)
			const shotOf = new Map(info.plan.shots.flatMap((s) => Array.from({ length: s.frames[1] - s.frames[0] + 1 }, (_, j) => [s.frames[0] + j, s])))
			const composed = new Map()
			for (const p of picks) {
				const c = new OffscreenCanvas(W, H)
				const g = c.getContext("2d")
				g.drawImage(drawn.get(`${lanesFilm[0]}|${p.i}`), 0, 0)
				if (perLane) {
					const s = shotOf.get(p.i)
					for (const b of s.bands) {
						if (!b.lane || b.lane === lanesFilm[0]) continue
						const [x, y, w, h] = b.rect
						g.drawImage(drawn.get(`${b.lane}|${p.i}`), x, y, w, h, x, y, w, h)
					}
				}
				composed.set(p.i, c)
				out.pics.push({ file: `${p.shot}-f${String(p.i).padStart(4, "0")}.jpg`, b64: await F.jpeg(c) })
			}
			// ---- the contact sheet: one row per shot (its frames, then today's Wide at its middle moment)
			const tw = 384
			const th = Math.round((tw * H) / W)
			const cap = 34
			const rows = info.plan.shots
			const cols = Math.max(...rows.map((s) => picks.filter((p) => p.shot === s.id).length)) + 1
			const sheet = new OffscreenCanvas(cols * (tw + 6) + 6, rows.length * (th + cap + 6) + 6)
			const sg = sheet.getContext("2d")
			sg.fillStyle = "#0b0c0f"
			sg.fillRect(0, 0, sheet.width, sheet.height)
			sg.font = "600 15px Helvetica, Arial, sans-serif"
			rows.forEach((s, r) => {
				const y = 6 + r * (th + cap + 6)
				const row = picks.filter((p) => p.shot === s.id)
				const rep = out.report?.shots?.find((x) => x.id === s.id)
				sg.fillStyle = "#e8e8e8"
				sg.fillText(`${s.id} · ${s.move}${s.layout !== "single" ? ` · ${s.layout}` : ""}${s.rate !== 1 ? ` · ${s.rate === 0 ? "freeze" : `x${s.rate}`}` : ""} · video ${s.video[0].toFixed(1)}-${s.video[1].toFixed(1)} s · run ${s.run[0].toFixed(2)}-${s.run[1].toFixed(2)} s${rep ? ` · size ${rep.size.map((z) => z.s).join("/")}` : ""}`, 8, y + 22)
				row.forEach((p, k) => sg.drawImage(composed.get(p.i), 6 + k * (tw + 6), y + cap, tw, th))
				const wide = row.find((p) => p.mid)
				if (wide && drawn.get(`wide|${wide.i}`)) {
					sg.drawImage(drawn.get(`wide|${wide.i}`), 6 + (cols - 1) * (tw + 6), y + cap, tw, th)
					sg.fillStyle = "rgba(0,0,0,0.6)"
					sg.fillRect(6 + (cols - 1) * (tw + 6), y + cap, 92, 22)
					sg.fillStyle = "#fff"
					sg.fillText("today's Wide", 10 + (cols - 1) * (tw + 6), y + cap + 16)
				}
			})
			out.sheet = await F.jpeg(sheet)
			for (const b of drawn.values()) b.close()
			return out
		},
		{ plan, scenes, W, H, FPS, BLUR },
	)
	if (res.error) {
		console.log(`${name}: ERROR ${res.error}`)
		summary.push({ plan: name, error: res.error })
		continue
	}
	for (const p of res.pics) writeFileSync(path.join(dir, p.file), Buffer.from(p.b64, "base64"))
	writeFileSync(path.join(OUT, `sheet-${name}.jpg`), Buffer.from(res.sheet, "base64"))
	const ms = res.ms.slice().sort((a, b) => a - b)
	const row = { plan: name, duration: res.duration, shots: res.shots.length, stills: res.pics.length, ok: res.report?.ok ?? null, failed: res.report?.failed ?? [], deterministic: res.checks.deterministic, projectionError: res.checks.projectionError, frameMs: { median: ms[ms.length >> 1], max: ms[ms.length - 1] }, seconds: (Date.now() - t0) / 1000, ...(FOCUS ? { notes: res.notes } : {}) }
	writeFileSync(path.join(dir, "report.json"), JSON.stringify({ ...row, report: res.report, shots: res.shots }, null, 1))
	summary.push(row)
	console.log(`${name}: ${res.duration.toFixed(2)} s video, ${res.shots.length} shots, ${res.pics.length} stills; net ${row.ok ? "ALL CHECKS PASS" : `FAIL (${row.failed.length})`}; deterministic ${row.deterministic}; projection ${row.projectionError?.toExponential(2)}; frame ${row.frameMs.median.toFixed(0)} ms median (blur ${BLUR}); ${row.seconds.toFixed(0)} s`)
	for (const f of row.failed) console.log(`   FAIL ${f}`)
}
writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ size: [W, H], fps: FPS, blur: BLUR, errors, plans: summary }, null, 1))
if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(" | ")}`)
await browser.close()
// (the automatic plan may leave a hero under its floor where no framing reaches it at real time: its notes say so; motion and comfort always hold)
const MOTION = /^(\S+) (keep-in|speed|zoom-rate|turn-rate|no-jump|cut|still|settled|shot-length|hold-length|label):/
const bad = summary.filter((s) => !s.skipped && (s.error || (FOCUS ? s.failed.some((f) => MOTION.test(f)) : s.ok === false) || s.deterministic === false || !(s.projectionError < 1e-6)))
console.log(bad.length ? `${bad.length} with problems: ${bad.map((b) => b.plan).join(", ")}` : FOCUS ? "every scene filmed with the automatic plan: every motion and comfort check passes, deterministic, projection exact" : "every plan filmed: all checks pass, deterministic, projection exact")
process.exit(bad.length ? 1 : 0)
