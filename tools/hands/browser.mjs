// The hands (web/hands.js) in the app, headless (the app's own page with ?engine=browser: the scene is built and run in the page, so this starts only
// a static server of its own, never the app's):
//   every proof scene (tools/hands/scenes): its hands are made (grip, side, skin as the scene asks), no pull pin or gate where a hand holds, the
//   pusher's machinery not drawn under a hand skin, a fixed thing's stand gone; the hand is in the export's picture before the release and gone
//   from it once it has let go (skin-coloured pixels); the same moment drawn twice is the same picture
//   setOptions({hands: "off"}) gives the pins back and draws no hand; "all" puts a hand on a held thing whose scene asks for none
//   a scene with no hands (the starter) draws the very same pixels with the hands on and off
//   the live canvas shows the hand; the library card's photo (web/account/thumb.js) and an MP4 made by the export's encoder (web/export/encoder.js) too
//   node tools/hands/browser.mjs [--port 8799] [--out dir]
import { execFileSync, spawn } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const PORT = Number(arg("--port", 8799))
const OUT = arg("--out", join(process.env.TMPDIR || "/tmp", "hands-browser"))
mkdirSync(OUT, { recursive: true })
const require = createRequire(import.meta.url)
const { chromium } = require("/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", PG], { stdio: "ignore" })
await new Promise((r) => setTimeout(r, 900))
let failed = 0
let passed = 0
const ok = (cond, what, detail = "") => {
	if (cond) passed++
	else failed++
	console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
}
const scenes = Object.fromEntries(readdirSync(join(HERE, "scenes")).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(HERE, "scenes", f), "utf8"))]))
// what each proof scene's hands must be: [{item, grip?, from?, skin?}]
const WANT = {
	ma25_s1_cork_held: [{ item: "cork", grip: "press", from: "above" }],
	ma25_s2_cork_let_go: [{ item: "cork", grip: "press", from: "above" }],
	ma25_s7_apple: [{ item: "apple", grip: "grip", from: "above" }],
	ma25_s8_grape: [{ item: "grape", grip: "pinch", from: "above" }],
	ma25_s9_grape: [{ item: "grape", grip: "pinch", from: "above" }],
	fo13_s1_clip_drop: [{ item: "clip", grip: "pinch", from: "right" }],
	fo13_s2_clip_magnet: [{ item: "clip", grip: "pinch", from: "right" }, { item: "magnet", grip: "grip", from: "above" }],
	mo19_s1_ball_drop: [{ item: "ball", grip: "palm", from: "left" }],
	mo19_s2_ball_throw: [{ item: "ball", grip: "palm", from: "left", thrown: true }],
	fo36_finger: [{ item: "pusher", skin: "finger" }],
	fo36_hand: [{ item: "pusher", skin: "hand" }],
	fo36_two_hands: [{ item: "pusher", skin: "two hands" }],
	fo36_fist: [{ item: "pusher", skin: "fist" }],
	ma50_s1_cup_pour: [{ item: "cup" }]
}
const shell = join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
const browser = await chromium.launch({ headless: true, ...(existsSync(shell) ? { executablePath: shell } : {}), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--use-mock-keychain"] })
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
	const errors = []
	page.on("pageerror", (e) => errors.push(String(e)))
	page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()))
	await page.goto(`http://127.0.0.1:${PORT}/web/index.html?engine=browser&profile=handstest&quality=high`)
	await page.waitForFunction(() => window.sandbox?.view && window.sandboxApp && window.sandbox.sim && !window.sandbox.layout, null, { timeout: 240000 })
	await page.evaluate(() => {
		// (in the page: open a scene as the app does, wait for its run, and measure pictures)
		window.__h = {
			async open(scene) {
				const S = window.sandbox
				S.playing = false
				window.sandboxApp.open(scene)
				const t0 = performance.now()
				while (!(S.sim?.doc?.id === scene.id && !S.layout && S.view._debug.run?.sim === S.sim)) {
					if (performance.now() - t0 > 120000) throw new Error(`no run for ${scene.id}`)
					await new Promise((r) => setTimeout(r, 50))
				}
				await S.view.whenSettled()
				const run = S.view._debug.run
				const rigs = (run.hands?.rigs ?? []).map((g) => ({ item: g.item, grip: g.grip, from: g.from, skin: g.skin, thrown: !!g.thrown, n: (g.rigs ?? [g.rig]).length }))
				const solidsDrawn = new Set()
				run.group.traverse((o) => o.userData?.solidId && o.isMesh && o.visible && !o.userData.hand && solidsDrawn.add(o.userData.solidId))
				return { rigs, pins: run.pins.length, gates: run.gates.length, mounts: (run.mounts ?? []).length, drawn: [...solidsDrawn], held: run.doc.release?.parts ?? [], tRelease: run.tRelease, duration: S.view.exportInfo().duration, runId: S.view.exportInfo().runId }
			},
			/** The export's picture at t: {hash, px (its RGBA bytes, base64)}. */
			async frame(t, opts = {}) {
				const S = window.sandbox
				const cv = await S.view.renderFrame(t, { width: 480, height: 270, camera: "wide", runId: S.view.exportInfo().runId, samples: 4, ...opts })
				const g = new OffscreenCanvas(cv.width, cv.height).getContext("2d")
				g.drawImage(cv, 0, 0)
				const d = g.getImageData(0, 0, cv.width, cv.height).data
				let h = 2166136261
				for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16)), 16777619)
				let s = ""
				for (let k = 0; k < d.length; k += 0x8000) s += String.fromCharCode.apply(null, d.subarray(k, k + 0x8000))
				return { hash: h >>> 0, px: btoa(s) }
			},
			/** Each hand's state at t (posed as the clock would): [{item, shown, x, y, z}] (the wrist's place). */
			handsAt(t) {
				const run = window.sandbox.view._debug.run
				run.hands?.at(t)
				return (run.hands?.rigs ?? []).map((g) => {
					const r = g.rig
					return { item: g.item, shown: r.root.visible && r.arm.visible, x: r.root.position.x, y: r.root.position.y, z: r.root.position.z }
				})
			}
		}
	})
	const open = (scene) => page.evaluate((s) => window.__h.open(s), scene)
	const frame = async (t, opts) => {
		const f = await page.evaluate(([t, o]) => window.__h.frame(t, o), [t, opts ?? {}])
		return { hash: f.hash, px: Buffer.from(f.px, "base64") }
	}
	/** How many pixels two pictures differ by (any channel by more than 30). */
	const differ = (a, b) => {
		let n = 0
		for (let i = 0; i < a.px.length; i += 4) if (Math.abs(a.px[i] - b.px[i]) > 30 || Math.abs(a.px[i + 1] - b.px[i + 1]) > 30 || Math.abs(a.px[i + 2] - b.px[i + 2]) > 30) n++
		return n
	}
	const handsAt = (t) => page.evaluate((t) => window.__h.handsAt(t), t)
	const setHands = (mode) => page.evaluate(async (m) => {
		const S = window.sandbox
		S.view.setOptions({ hands: m })
		await S.view.whenSettled()
		const run = S.view._debug.run
		return { rigs: run.hands?.rigs?.length ?? 0, pins: run.pins.length }
	}, mode)

	// ---- every proof scene: its hands, what they replace, the picture before and after the release
	for (const [name, scene] of Object.entries(scenes)) {
		const r = await open(scene)
		const want = WANT[name] ?? []
		const got = want.map((w) => r.rigs.find((g) => g.item === w.item))
		ok(r.rigs.length === want.length && want.every((w, i) => got[i] && Object.entries(w).every(([k, v]) => k === "item" || got[i][k] === v)), `${name}: its hands`, JSON.stringify(r.rigs))
		const heldItems = new Set(r.held.map((id) => id.split("/")[0]))
		if (heldItems.size) ok(r.pins === 0 && r.gates === 0, `${name}: no pull pin or gate where a hand holds`, `pins ${r.pins}`)
		if (name.startsWith("fo36")) ok(!r.drawn.some((id) => id.startsWith("pusher/")), `${name}: the pusher's housing, rod and paddle are not drawn`)
		if (name === "fo13_s2_clip_magnet") ok(r.mounts === 0, `${name}: the magnet in a fist has no stand`, `mounts ${r.mounts}`)
		const t0 = Math.min(0.3, r.tRelease - 0.05)
		const a = await frame(t0)
		const a2 = await frame(t0)
		ok(a.hash === a2.hash, `${name}: the same moment drawn twice is the same picture`)
		await setHands("off")
		const off = await frame(t0)
		await setHands("scene")
		const n = differ(a, off)
		ok(n > 400, `${name}: the hand is in the picture at ${t0} s (it changes ${n} of ${(480 * 270) | 0} pixels)`)
		const h0 = await handsAt(t0)
		ok(h0.length && h0.every((h) => h.shown && [h.x, h.y, h.z].every(Number.isFinite)), `${name}: every hand shown and placed at ${t0} s`)
		if (r.tRelease + 1.2 < r.duration && heldItems.size) {
			const late = await handsAt(r.tRelease + 1.2)
			const held = late.filter((h) => heldItems.has(h.item))
			ok(held.length > 0 && held.every((h) => !h.shown), `${name}: let go, the hand has left the picture by ${(r.tRelease + 1.2).toFixed(2)} s`, JSON.stringify(late))
			const kept = late.filter((h) => !heldItems.has(h.item))
			if (kept.length) ok(kept.every((h) => h.shown), `${name}: the hand on a fixed thing holds it to the end`)
		}
		const png = await page.evaluate(async (t) => {
			const S = window.sandbox
			const cv = await S.view.renderFrame(t, { width: 960, height: 540, camera: "wide", runId: S.view.exportInfo().runId, samples: 4 })
			const blob = await cv.convertToBlob({ type: "image/png" })
			const b = new Uint8Array(await blob.arrayBuffer())
			let s = ""
			for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000))
			return btoa(s)
		}, t0)
		writeFileSync(join(OUT, `${name}.png`), Buffer.from(png, "base64"))
	}

	// ---- show / hide: "off" gives the pins back; "all" puts a hand on a held thing that asks for none
	const bare = JSON.parse(JSON.stringify(scenes.mo19_s1_ball_drop))
	bare.id = "mo19-bare"
	delete bare.items.find((i) => i.id === "ball").props.hand
	let r = await open(bare)
	ok(r.rigs.length === 0 && r.pins === 1, "a held ball with no hand prop: the pull pin, no hand", JSON.stringify(r))
	let m = await setHands("all")
	ok(m.rigs === 1 && m.pins === 0, 'setOptions({hands: "all"}): a hand holds it, no pin', JSON.stringify(m))
	m = await setHands("off")
	ok(m.rigs === 0 && m.pins === 1, 'setOptions({hands: "off"}): the pin again', JSON.stringify(m))
	await setHands("scene")
	r = await open(scenes.fo36_hand)
	await setHands("off")
	const drawnOff = await page.evaluate(() => {
		const s = new Set()
		window.sandbox.view._debug.run.group.traverse((o) => o.userData?.solidId && o.isMesh && o.visible && s.add(o.userData.solidId))
		return [...s]
	})
	ok(drawnOff.includes("pusher/paddle") && drawnOff.includes("pusher/housing"), 'hands "off": the pusher is a machine again')
	await setHands("scene")

	// ---- a scene without hands: the very same pixels with the hands on and off (the starter)
	const starter = JSON.parse(readFileSync(join(PG, "web", "scenarios", "rube-goldberg.json"), "utf8"))
	r = await open(starter)
	const s1 = await frame(1.5)
	await setHands("off")
	const s2 = await frame(1.5)
	await setHands("scene")
	ok(r.rigs.length === 0 && s1.hash === s2.hash, "the starter (no hands): the same pixels with the hands on and off")

	// ---- the live canvas, the library card's photo, the MP4
	r = await open(scenes.mo19_s1_ball_drop)
	await page.evaluate(() => {
		window.sandbox.view.render(0.2)
	})
	await page.waitForTimeout(400)
	const shot = await page.locator("#view-3d canvas").first().screenshot({ path: join(OUT, "canvas.png") })
	const canvasSkin = await page.evaluate(async (b64) => {
		const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
		const g = new OffscreenCanvas(img.width, img.height).getContext("2d")
		g.drawImage(img, 0, 0)
		const d = g.getImageData(0, 0, img.width, img.height).data
		let n = 0
		for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i] - d[i + 2] > 45 && d[i] - d[i + 1] > 18 && d[i + 1] - d[i + 2] > 12 && d[i + 1] > 95) n++
		return n
	}, shot.toString("base64"))
	ok(canvasSkin > 150, "the live canvas shows the hand", `${canvasSkin} skin pixels`)
	const thumb = await page.evaluate(async () => {
		const { captureThumb } = await import("./account/thumb.js")
		const blob = await captureThumb(window.sandbox.view)
		if (!blob) return null
		const img = await createImageBitmap(blob)
		const g = new OffscreenCanvas(img.width, img.height).getContext("2d")
		g.drawImage(img, 0, 0)
		const d = g.getImageData(0, 0, img.width, img.height).data
		let n = 0
		for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i] - d[i + 2] > 45 && d[i] - d[i + 1] > 18 && d[i + 1] - d[i + 2] > 12 && d[i + 1] > 95) n++
		const b = new Uint8Array(await blob.arrayBuffer())
		let s = ""
		for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000))
		return { n, w: img.width, h: img.height, b64: btoa(s), type: blob.type }
	})
	if (thumb) writeFileSync(join(OUT, `thumb.${thumb.type.includes("webp") ? "webp" : "jpg"}`), Buffer.from(thumb.b64, "base64"))
	ok(!!thumb && thumb.n > 100, "the library card's photo (web/account/thumb.js) shows the hand", thumb ? `${thumb.w}x${thumb.h}, ${thumb.n} skin pixels` : "no photo")
	const mp4 = await page.evaluate(async () => {
		const enc = await import("./export/encoder.js")
		const S = window.sandbox
		const fps = 30
		const runId = S.view.exportInfo().runId
		try {
			const blob = await enc.encodeMp4({ frames: (i) => S.view.renderFrame(i / fps, { width: 640, height: 360, camera: "fixed", runId, fps }), frameCount: 30, fps, width: 640, height: 360 })
			const b = new Uint8Array(await blob.arrayBuffer())
			let s = ""
			for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000))
			return { b64: btoa(s), info: blob.info }
		} catch (e) {
			return { error: String(e?.message ?? e) }
		} finally {
			S.view.endExport()
		}
	})
	if (mp4.error) ok(false, "the export's encoder made an MP4", mp4.error)
	else {
		const file = join(OUT, "mo19-hands.mp4")
		writeFileSync(file, Buffer.from(mp4.b64, "base64"))
		let skin = -1
		try {
			const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "select=eq(n\\,6)", "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 26 })
			skin = 0
			for (let i = 0; i < raw.length; i += 3) if (raw[i] > 150 && raw[i] - raw[i + 2] > 45 && raw[i] - raw[i + 1] > 18 && raw[i + 1] - raw[i + 2] > 12 && raw[i + 1] > 95) skin++
		} catch (e) {
			skin = -2
		}
		ok(skin > 100, "an MP4 made by the export's encoder shows the hand (its 7th frame, read back with ffmpeg)", `${mp4.info?.frames} frames, ${mp4.info?.video?.codec}, ${skin} skin pixels`)
	}
	ok(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "))
} finally {
	await browser.close()
	server.kill()
}
console.log(`${passed} passed, ${failed} failed (pictures in ${OUT})`)
process.exit(failed ? 1 : 0)
