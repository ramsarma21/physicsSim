// The hands (web/hands.js) in the app, headless (the app's own page with ?engine=browser: the scene is built and run in the page, so this starts only
// a static server of its own, never the app's):
//   every proof scene (tools/hands/scenes): its hands are made (grip, side, skin as the scene asks), no pull pin or gate where a hand holds, the
//   pusher's machinery not drawn under a hand skin, a fixed thing's stand gone; the hand is in the export's picture before the release and gone
//   from it once it has let go (skin-coloured pixels); the same moment drawn twice is the same picture
//   setOptions({hands: "off"}) gives the pins back and draws no hand; "all" puts a hand on a held thing whose scene asks for none
//   a scene with no hands (the starter) draws the very same pixels with the hands on and off
//   the live canvas shows the hand; the library card's photo (web/account/thumb.js) and an MP4 made by the export's encoder (web/export/encoder.js) too
//   every hand drawn with web/models/hand.glb (skinned meshes); with that file unreachable the capsule hand is drawn instead
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
	// (hand.glb's index is a child's real finger, thicker than the capsule hand's: a pinch of the clip 1.5 cm under the drawn magnet would lie on
	// the magnet, so the auto hold keeps the cleanest, the clip on the open palm, which drops from under it as it jumps up)
	fo13_s2_clip_magnet: [{ item: "clip", grip: "palm", from: "right" }, { item: "magnet", grip: "grip", from: "above" }],
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
				const rigs = (run.hands?.rigs ?? []).map((g) => ({ item: g.item, grip: g.grip, from: g.from, skin: g.skin, thrown: !!g.thrown, n: (g.rigs ?? [g.rig]).length, mesh: (g.rigs ?? [g.rig]).every((x) => x.mesh && x.meshes.every((m) => m.isSkinnedMesh)) }))
				const solidsDrawn = new Set()
				run.group.traverse((o) => o.userData?.solidId && o.isMesh && o.visible && !o.userData.hand && solidsDrawn.add(o.userData.solidId))
				return { rigs, pins: run.pins.length, gates: run.gates.length, mounts: (run.mounts ?? []).length, drawn: [...solidsDrawn], held: run.doc.release?.parts ?? [], tRelease: run.tRelease, duration: S.view.exportInfo().duration, runId: S.view.exportInfo().runId, ...window.__h.holders() }
			},
			/** What holds each held item (web/view3d.js heldHow), the items held from above in a liquid (mod_mechanics.py holdFrom), the view plug-ins drawn. */
			holders() {
				const run = window.sandbox.view._debug.run
				const fromAbove = [...new Set(run.doc.solids.filter((s) => s.holdFrom === "above").map((s) => s.item))]
				return { heldHow: Object.fromEntries(run.heldHow ?? []), fromAbove, plugins: (run.plugins ?? []).map((p) => p.name) }
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
		return { rigs: run.hands?.rigs?.length ?? 0, pins: run.pins.length, ...window.__h.holders() }
	}, mode)
	/** One holder per held thing (web/view3d.js heldHow): a hand alone where one holds; else, in the real look, the mechanics module's fork from
	 *  above for a thing held in a liquid; "mechanics:holders" drawn exactly when some thing is held by its fork. */
	const oneHolder = (r, name, hands) => {
		const handed = new Set(hands ? r.rigs.map((g) => g.item) : [])
		const bad = Object.entries(r.heldHow).filter(([item, how]) => (handed.has(item) ? how !== "hand" : r.fromAbove.includes(item) ? how !== "fork" : how === "hand" || how === "fork"))
		const forks = Object.values(r.heldHow).filter((v) => v === "fork").length
		ok(bad.length === 0 && forks > 0 === r.plugins.includes("mechanics:holders"), `${name}: one holder each, hands ${hands ? "on" : "off"}`, JSON.stringify({ heldHow: r.heldHow, fromAbove: r.fromAbove, fork: r.plugins.includes("mechanics:holders") }))
	}

	// ---- every proof scene: its hands, what they replace, the picture before and after the release
	for (const [name, scene] of Object.entries(scenes)) {
		const r = await open(scene)
		const want = WANT[name] ?? []
		const got = want.map((w) => r.rigs.find((g) => g.item === w.item))
		ok(r.rigs.length === want.length && want.every((w, i) => got[i] && Object.entries(w).every(([k, v]) => k === "item" || got[i][k] === v)), `${name}: its hands`, JSON.stringify(r.rigs))
		ok(r.rigs.every((g) => g.mesh), `${name}: drawn with hand.glb (skinned meshes)`)
		const heldItems = new Set(r.held.map((id) => id.split("/")[0]))
		if (heldItems.size) ok(r.pins === 0 && r.gates === 0, `${name}: no pull pin or gate where a hand holds`, `pins ${r.pins}`)
		if (name.startsWith("fo36")) ok(!r.drawn.some((id) => id.startsWith("pusher/")), `${name}: the pusher's housing, rod and paddle are not drawn`)
		if (name === "fo13_s2_clip_magnet") ok(r.mounts === 0, `${name}: the magnet in a fist has no stand`, `mounts ${r.mounts}`)
		oneHolder(r, name, true)
		const t0 = Math.min(0.3, r.tRelease - 0.05)
		const a = await frame(t0)
		const a2 = await frame(t0)
		ok(a.hash === a2.hash, `${name}: the same moment drawn twice is the same picture`)
		oneHolder({ ...(await setHands("off")), rigs: [] }, name, false)
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

	// ---- the lesson look holds a thing in a liquid with its own hanger from above, never with the mechanics module's fork too (heldHow)
	r = await open(scenes.ma25_s1_cork_held)
	const lesson = await page.evaluate(async () => {
		const S = window.sandbox
		S.view.setOptions({ hands: "off", style: "lesson" })
		await S.view.whenSettled()
		const out = window.__h.holders()
		S.view.setOptions({ hands: "scene", style: null })
		await S.view.whenSettled()
		return out
	})
	ok(lesson.heldHow.cork === "hanger" && !lesson.plugins.includes("mechanics:holders"), "the lesson look, hands off: a cork held in the water hangs from the look's hanger, no fork", JSON.stringify(lesson))

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
	// ---- every type: held with an auto hand (and let go), fixed in a grip; every pusher skin; every pitcher's vessel and side: built from the
	// page's own builder and engine (web/sim), each hand made, its poses finite before and through the release, and how long making them takes
	const sweep = await page.evaluate(async () => {
		const sim = await import("./sim/index.js")
		const { createEngine } = await import("./sim/engine.js")
		const { makeHands } = await import("./hands.js")
		const engine = createEngine()
		const out = { types: 0, made: 0, bad: [], ms: [], grips: {} }
		const finite = (r) => [r.root.position.x, r.root.position.y, r.root.position.z, r.arm.position.x, r.arm.position.y, r.arm.quaternion.w].every(Number.isFinite)
		const check = async (scene, label, wantRigs = 1) => {
			let lay
			try {
				lay = sim.layout(sim.clean(scene))
			} catch (e) {
				return // (a type that cannot stand alone here)
			}
			let track
			try {
				track = await engine.run(lay.doc, 120) // (web/sim/engine.js: the track itself)
			} catch (e) {
				out.bad.push(`${label}: engine ${String(e?.message ?? e).slice(0, 80)}`)
				return
			}
			try {
				const pf = (s) => {
					const q = track.frames[0].placements[s.id]
					return { x: q ? q.x : s.at.x, y: q ? q.y : s.at.y, angle: q ? q.angle : (s.angle ?? 0) }
				}
				const t0 = performance.now()
				const H = makeHands({ doc: lay.doc, track, resolved: lay.resolved, mode: "scene" })
				H.fit(pf, track)
				out.ms.push(performance.now() - t0)
				out.types++
				const n = H.rigs.reduce((a, r) => a + (r.rigs ?? [r.rig]).length, 0)
				if (H.rigs.length < Math.min(1, wantRigs)) {
					if (H.plans?.length) out.bad.push(`${label}: planned, no hand made`)
					return
				}
				out.made++
				for (const r of H.rigs) out.grips[r.grip ?? r.skin ?? "pour"] = (out.grips[r.grip ?? r.skin ?? "pour"] ?? 0) + 1
				for (const t of [0, 0.29, 0.31, 0.34, 0.4, 0.6, 0.9]) {
					H.at(t)
					for (const r of H.rigs) for (const g of r.rigs ?? [r.rig]) if (!finite(g)) out.bad.push(`${label}: not finite at ${t} s`)
				}
				void n
			} catch (e) {
				out.bad.push(`${label}: ${String(e?.stack ?? e).slice(0, 160)}`)
			}
		}
		const types = sim.catalog().types
		for (const t of types) {
			if (!t.dynamic || t.key === "pusher") continue
			const base = { version: 2, name: `sweep ${t.key}`, seconds: 1.0, release: 0.3, items: [{ id: "table", type: "table", x: 0.6, y: 0 }] }
			await check({ ...base, id: `sw-${t.key}`, items: [...base.items, { id: "it", type: t.key, x: 0.4, y: 0.35, held: true, props: { hand: "auto" } }] }, `${t.key} held`)
			await check({ ...base, id: `swf-${t.key}`, items: [...base.items, { id: "it", type: t.key, x: 0.4, y: 0.35, fixed: true, props: { hand: "grip" } }] }, `${t.key} fixed`)
		}
		for (const skin of ["finger", "hand", "two hands", "fist"])
			await check({ version: 2, id: `swp-${skin}`, name: "sweep pusher", seconds: 1.0, release: 0.3, items: [{ id: "table", type: "table", x: 0.6, y: 0 }, { id: "p", type: "pusher", x: 0.2, y: 0, props: { hand: skin } }, { id: "b", type: "tennis-ball", x: 0.29, y: 0.034 }] }, `pusher ${skin}`)
		for (const vessel of ["pitcher", "jug", "measuring cup", "cup"])
			for (const side of ["right", "left"])
				await check({ version: 2, id: `swq-${vessel}-${side}`, name: "sweep pitcher", seconds: 1.5, release: 0.3, items: [{ id: "table", type: "table", x: 0.6, y: 0 }, { id: "q", type: "pitcher", x: 0.5, y: 0.3, props: { hand: "hand", vessel, pour_to: side, pour_at: 0.2, tip_s: 0.8 } }] }, `pitcher ${vessel} ${side}`)
		engine.terminate()
		out.ms.sort((a, b) => a - b)
		return { ...out, median: out.ms[out.ms.length >> 1], max: out.ms.at(-1) }
	})
	ok(sweep.types > 400 && sweep.bad.length === 0, `every dynamic type held (auto) and fixed (grip), every pusher skin, every pitcher: hands made, finite through the release (${sweep.made} of ${sweep.types} scenes with a hand)`, sweep.bad.slice(0, 5).join(" | "))
	ok(sweep.max < 400, `making a scene's hands takes ${sweep.median?.toFixed(1)} ms (median), ${sweep.max?.toFixed(0)} ms at most`, JSON.stringify(sweep.grips))
	ok(errors.length === 0, "no page errors", errors.slice(0, 3).join(" | "))

	// ---- hand.glb unreachable (an old deploy, a blocked file): the procedural capsule hand is drawn, and nothing else changes
	{
		const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } })
		const warnings = []
		p2.on("console", (m) => m.type() === "warning" && warnings.push(m.text()))
		await p2.route("**/models/hand.glb", (route) => route.abort())
		await p2.goto(`http://127.0.0.1:${PORT}/web/index.html?engine=browser&profile=handstest2&quality=high`)
		await p2.waitForFunction(() => window.sandbox?.view && window.sandboxApp && window.sandbox.sim && !window.sandbox.layout, null, { timeout: 240000 })
		const fb = await p2.evaluate(async (scene) => {
			const S = window.sandbox
			S.playing = false
			window.sandboxApp.open(scene)
			const t0 = performance.now()
			while (!(S.sim?.doc?.id === scene.id && !S.layout && S.view._debug.run?.sim === S.sim)) {
				if (performance.now() - t0 > 120000) throw new Error("no run")
				await new Promise((r) => setTimeout(r, 50))
			}
			await S.view.whenSettled()
			const rigs = S.view._debug.run.hands?.rigs ?? []
			const cv = await S.view.renderFrame(0.3, { width: 480, height: 270, camera: "wide", runId: S.view.exportInfo().runId, samples: 4 })
			return { n: rigs.length, mesh: rigs.some((g) => (g.rigs ?? [g.rig]).some((x) => x.mesh)), meshes: rigs.reduce((a, g) => a + (g.rigs ?? [g.rig]).reduce((b, x) => b + x.meshes.length, 0), 0), w: cv.width }
		}, scenes.mo19_s1_ball_drop)
		ok(fb.n === 1 && !fb.mesh && fb.meshes > 10 && fb.w === 480, "hand.glb unreachable: the capsule hand holds the ball and the export draws it", JSON.stringify(fb))
		ok(warnings.some((w) => /hand\.glb could not be loaded/.test(w)), "... and the page says why, once", warnings.filter((w) => /hand/.test(w)).slice(0, 2).join(" | "))
		await p2.close()
	}
} finally {
	await browser.close()
	server.kill()
}
console.log(`${passed} passed, ${failed} failed (pictures in ${OUT})`)
process.exit(failed ? 1 : 0)
