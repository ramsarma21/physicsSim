// The toy module in a headless browser (tools/plugin-toy/browser.html): the view's frame hooks and view plugins (web/view-plugins.js), a resized
// body drawn shrunk, and the inspector's link, readings and settings controls (web/inspector-plugins.js). Run test.mjs first (it builds the
// toy's engine bundle into TOY_OUT). Starts its own static server (never the app's):
//   TOY_OUT=<dir> node tools/plugin-toy/browser.mjs [--port 8798]
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PG = join(HERE, "..", "..")
const OUT = process.env.TOY_OUT || join(process.env.TMPDIR || "/tmp", "plugin-toy")
mkdirSync(OUT, { recursive: true })
const PORT = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 8798)
const bundle = join(OUT, "toy-engine.js")
if (!existsSync(bundle)) throw new Error(`no ${bundle}: run tools/plugin-toy/test.mjs first`)
const require = createRequire(import.meta.url)
const { chromium } = require("/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", PG], { stdio: "ignore" })
await new Promise((r) => setTimeout(r, 800))
let failed = 0
const ok = (cond, what, detail = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`)
	if (!cond) failed++
}
// (the cached playwright-core looks for headless shell 1223; what is installed is 1248, as tools/parity/browser.mjs says)
const shell = join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell")
const browser = await chromium.launch({ headless: true, ...(existsSync(shell) ? { executablePath: shell } : {}), args: ["--use-angle=metal", "--enable-gpu"] })
try {
	const page = await browser.newPage({ viewport: { width: 1300, height: 900 } })
	const errors = []
	page.on("pageerror", (e) => errors.push(String(e)))
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
	await page.route("**/toy-engine.js", (route) => route.fulfill({ path: bundle, contentType: "text/javascript" }))
	await page.goto(`http://127.0.0.1:${PORT}/tools/plugin-toy/browser.html`)
	await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 })
	await page.evaluate(() => window.__toy.view._debug?.settled?.())
	const at = async (t) =>
		page.evaluate((t) => {
			window.__toy.view.render(t)
			return { hook: window.__toyHook, label: window.__toyLabel, graph: window.__toyGraph }
		}, t)
	const a = await at(0.1)
	await page.screenshot({ path: join(OUT, "toy-view-0.1s.png"), clip: { x: 0, y: 0, width: 960, height: 540 } })
	const b = await at(0.5)
	await page.screenshot({ path: join(OUT, "toy-view-0.5s.png"), clip: { x: 0, y: 0, width: 960, height: 540 } })
	const c = await at(2.9)
	await page.screenshot({ path: join(OUT, "toy-view-2.9s.png"), clip: { x: 0, y: 0, width: 960, height: 540 } })
	ok(a?.hook?.calls > 0 && a.hook.u === 0 && a.hook.scale === 1, "frame hook: called, cold and full size at 0.1 s", JSON.stringify(a?.hook))
	ok(b?.hook?.u === 1 && b.hook.scale < 0.95 && b.hook.scale > 0.5, "frame hook: hot and shrinking at 0.5 s (600× time-lapse: 58 °C at 0.36 s, melted by 0.7 s)", JSON.stringify(b?.hook))
	ok(c?.hook?.scale === 0, "frame hook: melted away by 2.9 s", JSON.stringify(c?.hook))
	ok(/^cube: 20\.0$/.test(a?.label ?? "") && /^cube: 58\.0$/.test(c?.label ?? ""), "view plugin: the label reads the temperature", `${a?.label} / ${c?.label}`)
	ok(a?.graph > 0 && c?.graph > a.graph, "view plugin: the graph draws the reading up to the moment shown", `${a?.graph} → ${c?.graph} points`)
	const drawn = async (t) =>
		page.evaluate((t) => {
			const v = window.__toy.view
			v.render(t)
			let s = null
			const root = v._debug?.scene ?? v._debug?.root
			root?.traverse?.((o) => {
				if (o.name === "cube/wax") s = { scale: o.scale.x, visible: o.visible }
			})
			return s
		}, t)
	const half = await drawn(0.5)
	const gone = await drawn(2.9)
	ok(half && Math.abs(half.scale - b.hook.scale) < 1e-6 && half.visible && gone && !gone.visible, "the view draws the resized cube at its scale, and hides it once melted", JSON.stringify([half, gone]))
	// the inspector
	const insp = await page.evaluate(() => {
		const sel = document.querySelector("select[data-link=heater]")
		return {
			options: sel ? [...sel.options].map((o) => [o.value, o.textContent]) : null,
			value: sel?.value,
			readouts: document.querySelector(".insp-readouts")?.textContent ?? null,
			gravity: !!document.querySelector(".insp-gravity"),
			lapse: document.querySelector('input[aria-label="Time-lapse"]')?.value ?? null
		}
	})
	ok(JSON.stringify(insp.options) === JSON.stringify([["", "none"], ["pad", "Hot pad (pad)"], ["pad2", "Cold pad (pad2)"]]) && insp.value === "pad", "inspector: the link is a choice of the heater pads", JSON.stringify(insp.options))
	ok(/Temperature58\.0 °C/.test(insp.readouts ?? "") && /Melted1\.00$/.test(insp.readouts ?? ""), "inspector: the readings at the run's end", insp.readouts)
	ok(insp.gravity && insp.lapse === "600", "inspector: the scene's settings", JSON.stringify(insp))
	await page.selectOption("select[data-link=heater]", "pad2")
	await page.selectOption(".insp-gravity", "moon")
	const changes = await page.evaluate(() => window.__toy.changes)
	ok(JSON.stringify(changes[0]) === JSON.stringify(["cube", { props: { heater: "pad2" } }]) && changes[1]?.[0] === "scene" && changes[1][1].settings?.gravity === "moon" && changes[1][1].settings?.time_lapse === 600, "inspector: choosing a pad and the Moon send the patches", JSON.stringify(changes))
	await page.screenshot({ path: join(OUT, "toy-inspector.png"), clip: { x: 0, y: 540, width: 330, height: 360 } })
	ok(!errors.length, "no page errors", errors.slice(0, 3).join(" | "))
} finally {
	await browser.close()
	server.kill()
}
console.log(failed ? `${failed} FAILED` : "ALL PASS")
process.exit(failed ? 1 : 0)
