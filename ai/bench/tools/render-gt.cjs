// Renders the ground-truth scenes (ai/bench/gt/<id>.json) with the app's own 3D view in a HEADLESS Chromium (never a visible window):
// the real page at http://localhost:8790/?profile=bench-gt&quality=high, the scene handed to it the way the app restores a saved scene
// (localStorage), the view enlarged to fill a 1280×720 window with the app's chrome hidden, the Wide camera at t = 0, every model built
// (view._debug.settled()). A second angle (the orbit camera turned and raised) for the scenes listed in SECOND. Writes
// gt/<id>.png, gt/<id>-b.png and gt/<id>.meta.json (cameras + each item's box in metres and in each picture, 0..1 image coords).
//   node ai/bench/tools/render-gt.cjs [ids...]
const fs = require("node:fs")
const path = require("node:path")
const { chromium } = require("/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")

const BENCH = path.resolve(__dirname, "..")
const GT = process.env.GT_DIR || path.join(BENCH, "gt") // (GT_DIR: render the scenes of another folder, e.g. reference answers copied out)
const EXE = "/Users/ramsarma/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
const W = 1280
const H = 720
const PROFILE = "bench-gt"
// second angle: azimuth (deg, + = camera moves to the right around the scene) and extra elevation (deg)
const SECOND = { "rube-goldberg": [35, 12], "book-ramp-ball": [-35, 10], "stacks": [30, 15], "seesaw-catapult": [-30, 12], "wrecking-ball": [35, 10], "vehicles": [30, 14], "desk-objects": [-25, 20], "pendulum-dominoes": [-35, 10] }
// The picture is the scene at t = 0. The Wide camera frames everything the run moves through, so the run is cut to the release moment
// (0.5 s) for the render: the start layout fills the picture instead of a launched ball's whole flight. Only `seconds` differs.
const SHOT_SECONDS = 0.5
const descriptions = JSON.parse(fs.readFileSync(path.join(__dirname, "gt-descriptions.json"), "utf8"))

const HIDE_CHROME = `
header.top, .transport, .chain, .view-tools, .edit-hint, .busy-bar, .warnings, .toast, #panel, .catalog-host, #drop-hint, #error { display: none !important; }
html, body { margin: 0 !important; overflow: hidden !important; }
main.layout, section.stage, .viewport { position: fixed !important; inset: 0 !important; width: ${W}px !important; height: ${H}px !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; }
#view-3d { position: absolute !important; inset: 0 !important; width: ${W}px !important; height: ${H}px !important; border-radius: 0 !important; }`

/** In the page: each visible item's box in the picture (0..1), from the doc solids' outlines at t = 0 and their depth, through the active camera. */
function boxesInPage(camName) {
	const S = window.sandbox
	const THREE = S.view._debug.THREE
	const cam = S.view._debug[camName]
	cam.updateMatrixWorld()
	const items = new Map(S.scene.items.map((i) => [i.id, i]))
	const pl = S.sim.track.frames[0].placements
	const out = {}
	const v = new THREE.Vector3()
	for (const s of S.sim.doc.solids) {
		const it = items.get(s.item)
		if (!it || s.hidden_3d || it.type === "table" || it.type === "wall") continue
		const p = pl[s.id]
		if (!p) continue
		const b = s.body
		let pts
		let d
		if (b.kind === "ball") {
			pts = Array.from({ length: 16 }, (_, k) => [b.radius * Math.cos((k * Math.PI) / 8), b.radius * Math.sin((k * Math.PI) / 8)])
			d = s.shape === "cylinder" ? (s.depth3d ?? 4 * b.radius) : (s.depth3d ?? 2 * b.radius)
		} else {
			if (b.kind === "polygon") pts = b.points.map((q) => [q.x, q.y])
			else { const hw = b.width / 2; const hh = b.height / 2; const hb = hw * (b.taper ?? 1); pts = [[-hb, -hh], [hb, -hh], [hw, hh], [-hw, hh]] }
			d = s.depth3d ?? b.depth ?? 0.05
		}
		const c = Math.cos(p.angle ?? 0)
		const n = Math.sin(p.angle ?? 0)
		const r = (out[s.item] ??= { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
		for (const [lx, ly] of pts)
			for (const z of [-d / 2, d / 2]) {
				v.set(p.x + lx * c - ly * n, p.y + lx * n + ly * c, z).project(cam)
				const X = (v.x + 1) / 2
				const Y = (1 - v.y) / 2
				r.x0 = Math.min(r.x0, X); r.x1 = Math.max(r.x1, X); r.y0 = Math.min(r.y0, Y); r.y1 = Math.max(r.y1, Y)
			}
	}
	const clip = (q) => Math.round(Math.max(0, Math.min(1, q)) * 10000) / 10000
	return Object.fromEntries(Object.entries(out).map(([k, r]) => [k, [clip(r.x0), clip(r.y0), clip(r.x1), clip(r.y1)]]))
}
function camInPage(camName) {
	const S = window.sandbox
	const cam = S.view._debug[camName]
	const t = camName === "orbitCam" ? S.view._debug.controls.target : null
	const r4 = (q) => Math.round(q * 10000) / 10000
	const dir = new S.view._debug.THREE.Vector3()
	cam.getWorldDirection(dir)
	return { position: cam.position.toArray().map(r4), direction: dir.toArray().map(r4), target: t ? t.toArray().map(r4) : null, fov_v_deg: r4(cam.fov), aspect: r4(cam.aspect) }
}

async function renderOne(browser, id) {
	const scene = JSON.parse(fs.readFileSync(path.join(GT, `${id}.json`), "utf8"))
	const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light" })
	const page = await ctx.newPage()
	const logs = []
	page.on("console", (m) => { if (m.type() === "error") logs.push(m.text().slice(0, 200)) })
	page.on("pageerror", (e) => logs.push("pageerror: " + e.message))
	await page.addInitScript(([p, sc]) => {
		try {
			localStorage.setItem(`sandbox@${p}:scene`, JSON.stringify(sc))
			localStorage.setItem(`sandbox@${p}:scenario`, JSON.stringify("empty"))
			localStorage.setItem(`sandbox@${p}:panel`, "false")
			localStorage.setItem(`sandbox@${p}:autoplay`, "false")
		} catch {}
	}, [PROFILE, { ...scene, seconds: SHOT_SECONDS }])
	await page.goto(`http://localhost:8790/?profile=${PROFILE}&quality=high`, { waitUntil: "load" })
	await page.waitForFunction(() => window.sandbox?.view && window.sandbox.sim && window.sandbox.sim.key !== "layout" && !window.sandbox.layout, null, { timeout: 120000 })
	const same = await page.evaluate(() => JSON.stringify(window.sandbox.scene.items.map((i) => [i.id, i.type, i.x, i.y])))
	if (same !== JSON.stringify(scene.items.map((i) => [i.id, i.type, i.x, i.y]))) throw new Error(`${id}: the app did not load the scene as given`)
	await page.addStyleTag({ content: HIDE_CHROME })
	await page.evaluate(`window.__boxes = ${boxesInPage.toString()}`)
	await page.evaluate(async () => {
		const S = window.sandbox
		S.playing = false
		S.t = 0
		S.view.resize()
		S.view.setOptions({ camera: "wide" })
		S.view.frame()
		S.view.render(0)
		await S.view._debug.settled()
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
		S.view.render(0)
		await new Promise((r) => setTimeout(r, 400))
	})
	const q = await page.evaluate(() => window.sandbox.view.getQuality())
	const renders = []
	const fileA = `${id}.png`
	await page.screenshot({ path: path.join(GT, fileA), clip: { x: 0, y: 0, width: W, height: H } })
	renders.push({ file: `gt/${fileA}`, camera: "wide", width: W, height: H, cam: await page.evaluate(camInPage, "wideCam"), boxes: await page.evaluate(boxesInPage, "wideCam") })
	if (SECOND[id]) {
		const [az, el] = SECOND[id]
		await page.evaluate(async ([az, el]) => {
			const S = window.sandbox
			S.view.setOptions({ camera: "orbit" })
			S.view.render(0)
			const D = S.view._debug
			const c = D.orbitCam
			const ctl = D.controls
			const off = c.position.clone().sub(ctl.target)
			const sph = new D.THREE.Spherical().setFromVector3(off)
			sph.theta += (az * Math.PI) / 180
			sph.phi = Math.max(0.2, sph.phi - (el * Math.PI) / 180)
			off.setFromSpherical(sph)
			c.position.copy(ctl.target).add(off)
			c.lookAt(ctl.target)
			ctl.enableDamping = false
			ctl.update()
			// pull back (and re-aim at the middle of what is shown) until every item is inside the picture with a margin
			for (let k = 0; k < 40; k++) {
				const b = Object.values(window.__boxes("orbitCam"))
				const u = { x0: Math.min(...b.map((q) => q[0])), y0: Math.min(...b.map((q) => q[1])), x1: Math.max(...b.map((q) => q[2])), y1: Math.max(...b.map((q) => q[3])) }
				if (u.x0 > 0.04 && u.x1 < 0.96 && u.y0 > 0.08 && u.y1 < 0.95) break
				const o = c.position.clone().sub(ctl.target).multiplyScalar(1.07)
				c.position.copy(ctl.target).add(o)
				c.lookAt(ctl.target)
				ctl.update()
			}
			for (let k = 0; k < 10; k++) { ctl.update(); S.view.render(0); await new Promise((r) => requestAnimationFrame(r)) }
			await new Promise((r) => setTimeout(r, 400))
		}, [az, el])
		const fileB = `${id}-b.png`
		await page.screenshot({ path: path.join(GT, fileB), clip: { x: 0, y: 0, width: W, height: H } })
		renders.push({ file: `gt/${fileB}`, camera: `orbit (azimuth ${az > 0 ? "+" : ""}${az}°, raised ${el}°)`, width: W, height: H, cam: await page.evaluate(camInPage, "orbitCam"), boxes: await page.evaluate(boxesInPage, "orbitCam") })
	}
	const items = await page.evaluate(() => {
		const S = window.sandbox
		return S.scene.items.map((i) => ({ id: i.id, type: i.type, name: i.name ?? null, x: i.x, y: i.y, angle: i.angle ?? 0, props: i.props ?? {}, held: !!i.held }))
	})
	await ctx.close()
	return { id, scene, renders, items, quality: q, logs }
}

;(async () => {
	const want = process.argv.slice(2)
	const ids = fs.readdirSync(GT).filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json")).map((f) => f.replace(/\.json$/, "")).filter((id) => !want.length || want.includes(id))
	const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ["--use-angle=metal", "--headless=new", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] })
	try {
		for (const id of ids) {
			const t0 = Date.now()
			try {
				const r = await renderOne(browser, id)
				const { geometryOf } = await import(path.join(__dirname, "gt-geometry.mjs"))
				const geo = await geometryOf(r.scene)
				const meta = {
					id, source: fs.existsSync(path.join(BENCH, "../../web/scenarios", `${id}.json`)) ? `scenario:${id} (web/scenarios)` : "arrangement (tools/make-gt-scenes.mjs)", description: descriptions[id] ?? null,
					scene: `gt/${id}.json`, shot: { t: 0, run_seconds_for_framing: SHOT_SECONDS, page: "http://localhost:8790/?profile=bench-gt&quality=high (chrome hidden, view 1280×720)" }, quality: r.quality, renders: r.renders.map(({ boxes, ...rest }) => rest),
					items: r.items.map((it) => ({ ...it, box_m: geo[it.id] ?? null, image_box: Object.fromEntries(r.renders.map((rr) => [rr.file, rr.boxes[it.id] ?? null])) })),
				}
				fs.writeFileSync(path.join(GT, `${id}.meta.json`), JSON.stringify(meta, null, 1) + "\n")
				console.log(`ok ${id} ${Date.now() - t0} ms, ${r.renders.length} render(s), quality ${r.quality.tier}${r.logs.length ? ", console: " + r.logs.join(" | ") : ""}`)
			} catch (e) {
				console.log(`FAIL ${id}: ${e.message}`)
			}
		}
	} finally {
		await browser.close()
	}
})()
