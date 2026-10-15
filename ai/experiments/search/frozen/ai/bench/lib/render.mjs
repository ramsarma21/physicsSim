// Real renders for the bench: the app's own critique camera (web/ai/shot.js: the same view3d renderer, models and Wide camera the AI panel
// sends to the refine step) in a HEADLESS Chromium (never a visible window), on a blank page of the local server's origin so the modules load
// as they do in the app. Several pages render in parallel; each keeps one shot (one WebGL context) alive.
//   const r = await createRenderer({ pages: 2 }); const shots = await r.render(sim, scene)   // [{label, t, width, height, dataUrl}]
//   await r.close()
// The page is http://localhost:8790/__bench_blank.html (answered by a request route here, never by the server), so nothing of the app's own
// UI or default scene runs. A page that breaks (a module mid-edit by another agent, a lost GPU context) is reloaded and the job retried once.
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const PW = "/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1"
const EXE = "/Users/ramsarma/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
export const ORIGIN = process.env.BENCH_APP_ORIGIN || "http://localhost:8790"
const BLANK = `${ORIGIN}/__bench_blank.html`

export async function createRenderer({ pages = 2, timeoutMs = 90000, log = () => {} } = {}) {
	const { chromium } = require(PW)
	const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: "light" })
	// the app's own import map (three, its addons...), read from the live index.html so it follows the app
	const index = await (await fetch(`${ORIGIN}/`)).text()
	const importMap = index.match(/<script type="importmap">[\s\S]*?<\/script>/)?.[0] ?? ""
	if (!importMap) throw new Error(`no import map in ${ORIGIN}/ (is the app server running?)`)
	await ctx.route(BLANK, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta charset=utf-8><title>bench</title>${importMap}</head><body style=margin:0></body></html>` }))
	const slots = []
	const queue = []
	let closed = false

	async function openPage() {
		const page = await ctx.newPage()
		const errors = []
		page.on("pageerror", (e) => errors.push(e.message))
		await page.goto(BLANK, { waitUntil: "load" })
		await page.evaluate(async () => {
			const cat = await (await fetch("/api/catalog")).json()
			const m = await import("/ai/shot.js")
			window.__shot = m.createShot({ looks: () => cat.looks })
		})
		return { page, errors, busy: false, renders: 0 }
	}
	for (let i = 0; i < pages; i++) slots.push(await openPage())

	async function renderOn(slot, sim, scene, opts) {
		const p = slot.page.evaluate(
			async ([sim, scene, times]) => {
				const out = await window.__shot.render(sim, { scene, times: times ?? null })
				return out.map((s) => ({ label: s.label, t: s.t, width: s.width, height: s.height, dataUrl: s.dataUrl }))
			},
			[sim, scene, opts.times ?? null]
		)
		let timer
		const to = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`render timed out after ${timeoutMs / 1000} s`)), timeoutMs)))
		try {
			return await Promise.race([p, to])
		} finally {
			clearTimeout(timer)
		}
	}
	function pump() {
		while (queue.length) {
			const slot = slots.find((s) => !s.busy)
			if (!slot) return
			const job = queue.shift()
			slot.busy = true
			;(async () => {
				const t0 = Date.now()
				try {
					let shots
					try {
						shots = await renderOn(slot, job.sim, job.scene, job.opts)
					} catch (e) {
						log(`render failed (${e.message}); reloading the page and trying again`)
						try {
							await slot.page.close()
						} catch {}
						Object.assign(slot, await openPage())
						shots = await renderOn(slot, job.sim, job.scene, job.opts)
					}
					slot.renders++
					job.resolve({ shots, ms: Date.now() - t0 })
				} catch (e) {
					job.reject(e)
				} finally {
					slot.busy = false
					pump()
				}
			})()
		}
	}
	/** The critique pictures of one run: start, end and (with a goal) a close-up. -> {shots: [{label, t, dataUrl...}], ms} */
	function render(sim, scene, opts = {}) {
		if (closed) return Promise.reject(new Error("the renderer is closed"))
		return new Promise((resolve, reject) => {
			queue.push({ sim, scene, opts, resolve, reject })
			pump()
		})
	}
	async function close() {
		closed = true
		try {
			await browser.close()
		} catch {}
	}
	return { render, close }
}
