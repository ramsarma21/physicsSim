// My scenes, end to end in the real app (headless Chromium with the GPU: never a visible window). Needs the page served: the local server
// (http://localhost:8790, already running) by default, or BASE=http://127.0.0.1:<port> QS=&engine=browser for `npm run preview:static`.
//   node web/account/test/library.e2e.mjs            (SHOTS=<folder> also saves screenshots there)
// Each part runs in its own ?profile, so nothing of the person's own library is touched. What is checked:
//   library      a pristine example is not kept; an edit makes a project with a picture; New → Blank starts another; undo/redo move between
//                them; rename (menu), duplicate (⌘D), delete + Undo, search, sort, arrow keys; open; reload keeps the project; dark; 375 px
//   ai+import    New → Build with AI (?aimock=1) and Import each start a project; New's "save first" note is gone for a kept scene
//   adopt        a scene saved with Save before My scenes existed is kept once; picking it from the menu continues it; Save renames it
//   account      ?accountmock: Sign in chip, sign-in from the library, copy this browser's scenes in, edits go to that copy, sign out
//   reload       back from Google (a reload, signed in): the browser's scene on the table goes on in the account as ONE scene
//   keys         search → Enter → card, Shift+F10 menu, rename + Esc, F2, Esc closes
//   aiSignIn     ?accountmock=1: signed out, Edit with AI (button and A) and New → Build with AI show "needs an account", never the panel;
//                Continue with Google signs in and puts the person back where they were (New with their words); Build then works;
//                signed out again, a 401 sign_in from /api/ai/* brings up the same sheet (the backstop)
//   cloudSavedAs signed in: Save as "My ramp", another scenario, "My ramp" again, edit: still ONE scene in the account, linked to my-ramp
//   copyLater    "Not now" on the copy offer leaves a line under the cards that brings the offer back
//   edits        rename keeps punctuation and says what it left out; deleting the scene on the table says it's still on the table
//   account      (see above) …and Delete account… with a typed confirmation signs out with the account gone
//   phone        375 px touch screen: the ⋯ button has a 44 px target
// Every part also fails on a console error or warning, and the account part on a request to another origin.
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
const EXE = process.env.CHROMIUM_PATH || "/Users/ramsarma/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
const BASE = process.env.BASE || "http://localhost:8790"
const QS = process.env.QS || ""
const SHOTS = process.env.SHOTS || null
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")
const only = process.argv.slice(2)

let fails = 0
const ok = (c, m) => {
	console.log(`${c ? "  ok  " : "  FAIL"} ${m}`)
	if (!c) fails++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null)

const browser = await chromium.launch({ headless: true, ...(fs.existsSync(EXE) ? { executablePath: EXE } : {}), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

/** a fresh page in its own profile, with its console watched */
async function open(query = "", { width = 1440, height = 900, init, ctxOpts = {} } = {}) {
	const ctx = await browser.newContext({ viewport: { width, height }, ...ctxOpts })
	const page = await ctx.newPage()
	const errors = []
	const other = []
	page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
	page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text()}`))
	page.on("request", (r) => !r.url().startsWith(new URL(BASE).origin + "/") && !/^(data|blob):/.test(r.url()) && other.push(r.url()))
	const profile = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
	if (init) await page.addInitScript(init.fn, { ...init.arg, profile })
	await page.goto(`${BASE}/?profile=${profile}${QS}${query}`)
	await page.waitForSelector("#my-scenes:not([disabled])", { timeout: 60000 })
	await page.waitForFunction(() => window.sandboxLibrary?.autosave.ready)
	const L = (f, ...a) => page.evaluate(f, ...a)
	const list = () => L(async () => (await window.sandboxLibrary.store.list()).map((m) => ({ id: m.id, name: m.name, items: m.items, thumb: !!m.thumb, v: m.version, origin: m.origin, savedAs: m.savedAs })))
	const waitFor = async (pred, ms = 15000) => {
		const t = Date.now()
		while (Date.now() - t < ms) {
			if (await pred()) return true
			await sleep(150)
		}
		return false
	}
	const stable = () => page.waitForFunction(() => document.querySelector("#status")?.dataset.state === "ok" && !document.querySelector("#chain")?.classList.contains("stale"), null, { timeout: 30000 })
	const addFirst = async () => {
		await page.click("#add")
		await page.waitForSelector(".cat-card")
		await page.click(".cat-card[data-key]")
		await page.keyboard.press("Escape")
	}
	const done = async ({ origins = false } = {}) => {
		ok(!errors.length, `no console errors${errors.length ? `: ${errors.join(" | ")}` : ""}`)
		if (origins) ok(!other.length, `no request to another origin${other.length ? `: ${other.join(" ")}` : ""}`)
		await ctx.close()
	}
	return { page, profile, L, list, waitFor, stable, addFirst, done, ctx, errors }
}

const parts = {
	async library() {
		const { page, L, list, waitFor, stable, addFirst, done } = await open()
		await stable()
		ok((await list()).length === 0, "a pristine starter is not kept")
		await page.keyboard.press("o")
		await page.waitForSelector("dialog.lib-dialog[open] .lib-empty:not([hidden])")
		await sleep(300)
		await shot(page, "lib-empty")
		ok(await L(() => document.activeElement?.closest(".lib-empty") && document.activeElement.textContent.includes("New scene")), "O opens it; the empty library focuses New scene")
		await page.keyboard.press("Escape")
		await sleep(300)
		ok(!(await L(() => document.querySelector("dialog.lib-dialog")?.open)), "Esc closes")

		await addFirst()
		ok(await waitFor(async () => (await list()).length === 1, 8000), "an edit makes a project")
		let l = await list()
		ok(l[0]?.name === "Rube Goldberg machine", `named after the scene (${l[0]?.name})`)
		await stable()
		await page.mouse.move(5, 5)
		ok(await waitFor(async () => (await list())[0]?.thumb, 20000), "and it gets its picture")
		const firstId = l[0].id

		await page.click("#new")
		await page.waitForSelector("dialog.np-dialog[open]")
		await sleep(400)
		ok(await L(() => !document.querySelector(".np-lib")?.hidden), "New shows the My scenes row")
		await shot(page, "lib-new")
		await page.click('[data-pick="blank"]')
		await page.click('[data-pane="blank"] .np-primary')
		await sleep(500)
		await stable()
		ok((await list()).length === 1, "a bare table is not kept")
		await addFirst()
		ok(await waitFor(async () => (await list()).length === 2, 8000), "New → Blank + an edit: a second project")
		l = await list()
		const secondId = l.find((m) => m.id !== firstId)?.id
		ok(l.find((m) => m.id === secondId)?.name === "Untitled scene", "called Untitled scene")
		await stable()
		await page.keyboard.press("Meta+z")
		await page.keyboard.press("Meta+z")
		await sleep(600)
		ok(await L((id) => window.sandboxLibrary.autosave.currentId === id, firstId), "undo past its start: back on the first project")
		await sleep(1500)
		ok((await list()).find((m) => m.id === secondId)?.items === 1, "the second kept what it had")
		await page.keyboard.press("Meta+Shift+z")
		await page.keyboard.press("Meta+Shift+z")
		await sleep(400)
		ok(await L((id) => window.sandboxLibrary.autosave.currentId === id, secondId), "redo: on the second again")
		await stable()
		await page.mouse.move(5, 5)
		ok(await waitFor(async () => (await list()).find((m) => m.id === secondId)?.thumb, 20000), "the second gets its picture too")

		await page.click("#my-scenes")
		await page.waitForSelector(".lib-item .lib-thumb img", { timeout: 8000 }).catch(() => {})
		await sleep(400)
		ok((await page.$$(".lib-item")).length === 2, "two cards")
		ok(await L(() => !!document.querySelector(".lib-item.is-current .lib-now")), "the one on the table is marked")
		await shot(page, "lib-cards")
		await page.hover(`.lib-item[data-id="${secondId}"]`)
		await page.click(`.lib-item[data-id="${secondId}"] .lib-more`)
		await page.waitForSelector(".lib-menu")
		await page.click('.lib-menu button:has-text("Rename")')
		await page.waitForSelector(".lib-rename")
		await page.keyboard.type("Tennis ball drop")
		await page.keyboard.press("Enter")
		await sleep(400)
		ok((await list()).find((m) => m.id === secondId)?.name === "Tennis ball drop", "rename")
		ok(await L(() => window.sandbox.scene.name === "Tennis ball drop" && document.querySelector("#scene-name").textContent === "Tennis ball drop"), "the scene on the table takes the name")
		await page.focus(`.lib-item[data-id="${firstId}"] .lib-open`)
		await page.keyboard.press("Meta+d")
		await waitFor(async () => (await list()).length === 3, 4000)
		l = await list()
		const dup = l.find((m) => m.name === "Rube Goldberg machine copy")
		ok(dup?.thumb, "⌘D duplicates, picture and all")
		await page.focus(`.lib-item[data-id="${dup.id}"] .lib-open`)
		await page.keyboard.press("Delete")
		await page.waitForSelector(".lib-snack:not([hidden]) .lib-snack-act")
		ok((await list()).length === 2, "Delete")
		await shot(page, "lib-deleted")
		await page.click(".lib-snack-act")
		ok(await waitFor(async () => (await list()).length === 3, 3000), "Undo brings it back")
		await page.fill(".lib-q", "tennis")
		await sleep(150)
		ok((await page.$$(".lib-item")).length === 1, "search")
		await page.fill(".lib-q", "zzz")
		await sleep(150)
		ok(await L(() => !document.querySelector(".lib-empty").hidden), "no match: says so")
		await page.fill(".lib-q", "")
		await page.selectOption(".lib-sort", "name")
		await sleep(150)
		const names = await L(() => [...document.querySelectorAll(".lib-name")].map((e) => e.textContent))
		ok(JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b))), `sort by name (${names.join(" | ")})`)
		await page.selectOption(".lib-sort", "recent")
		await page.focus(".lib-item .lib-open")
		await page.keyboard.press("ArrowRight")
		ok(await L(() => document.activeElement === document.querySelectorAll(".lib-open")[1]), "→ moves to the next card")

		await page.click(`.lib-item[data-id="${firstId}"] .lib-open`)
		await sleep(500)
		ok(await L((id) => !document.querySelector("dialog.lib-dialog").open && window.sandboxLibrary.autosave.currentId === id && window.sandbox.scene.name === "Rube Goldberg machine", firstId), "open: the scene is on the table")
		await stable()
		const v = (await list()).find((m) => m.id === firstId).v
		await sleep(1500)
		ok((await list()).find((m) => m.id === firstId).v === v, "opening is not an edit")

		await page.reload()
		await page.waitForSelector("#my-scenes:not([disabled])", { timeout: 60000 })
		await page.waitForFunction(() => window.sandboxLibrary?.autosave.ready)
		ok(await L((id) => window.sandboxLibrary.autosave.currentId === id, firstId), "after a reload the table is still that project")
		await page.click("#my-scenes")
		await page.waitForSelector(".lib-item .lib-thumb img", { timeout: 8000 }).catch(() => {})
		await sleep(400)
		ok((await page.$$(".lib-item")).length === 3, "three cards after the reload")
		await page.emulateMedia({ colorScheme: "dark" })
		await sleep(250)
		await shot(page, "lib-dark")
		await page.keyboard.press("Escape")
		await sleep(300)
		await page.setViewportSize({ width: 375, height: 812 })
		await sleep(400)
		await page.click("#my-scenes")
		await sleep(600)
		await shot(page, "lib-phone")
		const o = await L(() => ({ sw: document.documentElement.scrollWidth, cw: document.querySelector(".lib-card").getBoundingClientRect().width, g: document.querySelector(".lib-grid").scrollWidth - document.querySelector(".lib-grid").clientWidth }))
		ok(o.sw <= 375 && o.cw <= 375 && o.g <= 0, `375 px: no sideways scrolling (${JSON.stringify(o)})`)
		await done()
	},

	async aiImport() {
		const { page, L, list, waitFor, done } = await open("&aimock=1")
		await page.click("#new")
		await page.waitForSelector("dialog.np-dialog[open]")
		await page.click('[data-pick="ai"]')
		await page.fill(".np-input", "A Rube Goldberg chain reaction with dominoes")
		await page.keyboard.press("Enter")
		ok(await waitFor(async () => (await list()).length === 1, 90000), "New → Build with AI: a project")
		const l = await list()
		ok(l[0]?.origin === "ai", `named by the plan (${l[0]?.name})`)
		await sleep(1200)
		await page.click("#new")
		await page.waitForSelector("dialog.np-dialog[open]")
		ok(await L(() => document.querySelector(".np-keep").hidden), "New doesn't ask to save a kept scene first")
		await page.keyboard.press("Escape")
		await sleep(300)
		const sc = JSON.parse(fs.readFileSync(path.join(ROOT, "web/scenarios/newtons-cradle.json"), "utf8"))
		const file = path.join(fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "lib-e2e-")), "imported.json")
		fs.writeFileSync(file, JSON.stringify({ ...sc, name: "Imported cradle" }))
		await page.setInputFiles("#import-file", file)
		ok(await waitFor(async () => (await list()).length === 2), "Import: another project")
		ok((await list())[0]?.name === "Imported cradle", "named after the file's scene")
		await done()
	},

	async adopt() {
		const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "web/scenarios/atwood.json"), "utf8"))
		const fn = ({ scene: s, profile }) => {
			const k = `sandbox@${profile}:saved`
			if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ "my-atwood": { ...s, name: "My atwood", id: "my-atwood" } }))
		}
		const { page, list, waitFor, done } = await open("&engine=browser", { init: { fn, arg: { scene } } })
		ok(await waitFor(async () => (await list()).length === 1, 10000), "a scene saved before My scenes is kept")
		const l = await list()
		ok(l[0]?.savedAs === "my-atwood" && l[0]?.name === "My atwood", "linked to its saved scenario")
		await page.waitForFunction(() => document.querySelector('#scenario option[value="my-atwood"]'))
		await page.selectOption("#scenario", "my-atwood")
		await page.waitForFunction(() => window.sandbox.scene?.name === "My atwood")
		await sleep(500)
		ok(await page.evaluate((id) => window.sandboxLibrary.autosave.currentId === id, l[0].id), "picking it from the menu continues it")
		page.on("dialog", (d) => d.accept("Atwood renamed"))
		await page.click("#save")
		await sleep(1800)
		const l2 = await list()
		ok(l2.length === 1 && l2[0].name === "Atwood renamed" && l2[0].savedAs === "atwood-renamed", "Save renames it (no second copy)")
		await done()
	},

	async account() {
		const { page, L, list, waitFor, stable, addFirst, done } = await open("&accountmock=1")
		ok(await page.isVisible(".acct-signin"), "Sign in chip")
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list()).length === 1), "a scene in this browser")
		await page.click("#my-scenes")
		await page.waitForSelector(".lib-banner:not([hidden]) .acct-google")
		ok(true, "the library offers sign-in")
		await page.click(".lib-banner .acct-google")
		await page.waitForSelector(".acct-avatar", { timeout: 5000 })
		ok(await L(() => window.sandboxLibrary.store.kind === "cloud" && document.querySelector(".lib-where").textContent.includes("In your account")), "signed in: In your account")
		await page.waitForSelector(".lib-banner:not([hidden]) .lib-copy", { timeout: 5000 })
		await shot(page, "acct-copy")
		await page.click(".lib-copy")
		await page.waitForSelector(".lib-item", { timeout: 8000 })
		ok((await list()).length === 1, "copied in")
		await page.keyboard.press("Escape")
		await page.mouse.move(5, 5)
		ok(await waitFor(async () => (await list())[0]?.thumb, 20000), "with its picture (taken now if it had none yet)")
		await page.click("#my-scenes")
		await page.waitForSelector(".lib-item .lib-thumb img", { timeout: 8000 }).catch(() => {})
		await sleep(300)
		await shot(page, "acct-cards")
		const before = (await list())[0].items
		await page.keyboard.press("Escape")
		await sleep(300)
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list())[0]?.items === before + 1, 30000), "the next edit goes to that copy")
		ok((await list()).length === 1, "one scene in the account, not two")
		await page.click(".acct-avatar")
		await page.waitForSelector(".acct-menu")
		await shot(page, "acct-menu")
		await page.click('.acct-menu button:has-text("Sign out")')
		await sleep(300)
		ok(await L(() => window.sandboxLibrary.store.kind === "local") && (await page.isVisible(".acct-signin")), "sign out: this browser's again")
		await done({ origins: true })
	},

	async reload() {
		const { page, profile, L, list, waitFor, stable, addFirst, done } = await open("&accountmock=1")
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list()).length === 1), "a scene in this browser")
		await sleep(800)
		await page.goto(`${BASE}/?profile=${profile}${QS}&accountmock=signedin`)
		await page.waitForSelector("#my-scenes:not([disabled])", { timeout: 60000 })
		await page.waitForFunction(() => window.sandboxLibrary.autosave.ready)
		await sleep(1500)
		ok(await L(() => window.sandboxLibrary.store.kind === "cloud"), "back signed in")
		ok((await list()).length === 0, "nothing is written to the account by itself")
		await page.click("#my-scenes")
		await page.waitForSelector(".lib-copy")
		await page.click(".lib-copy")
		await page.waitForSelector(".lib-item")
		const before = (await list())[0]?.items
		await page.keyboard.press("Escape")
		await sleep(300)
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list())[0]?.items === before + 1), "the edit goes to the copy")
		ok((await list()).length === 1, "one scene in the account")
		await done({ origins: true })
	},

	async aiSignIn() {
		const { page, L, list, waitFor, done, ctx, errors } = await open("&accountmock=1&aimock=1&engine=browser")
		const sheet = () => L(() => { const d = document.querySelector("dialog.acct-sheet[open]"); return d ? d.querySelector("h2").textContent : null })
		const drawerOpen = () => L(() => document.querySelector("#ai")?.getAttribute("aria-expanded") === "true")
		ok(await L(() => window.sandboxLibrary.auth.aiSignInRequired && window.sandboxLibrary.auth.state === "signed-out"), "signed out on a deploy whose AI needs sign-in")
		await page.click("#ai")
		await page.waitForSelector("dialog.acct-sheet[open]", { timeout: 3000 })
		ok((await sheet()) === "Edit with AI needs an account" && !(await drawerOpen()), "Edit with AI: the sheet, not the panel")
		ok(await L(() => !!document.querySelector("dialog.acct-sheet[open] .acct-google") && document.activeElement?.classList.contains("acct-google")), "Continue with Google has the focus")
		await shot(page, "ai-signin-sheet")
		await page.keyboard.press("Escape")
		await sleep(200)
		ok((await sheet()) === null, "Esc closes it")
		await page.keyboard.press("a")
		await sleep(200)
		ok((await sheet()) === "Edit with AI needs an account" && !(await drawerOpen()), "the A key: the sheet too")
		await page.click("dialog.acct-sheet .acct-sheet-later")
		await sleep(200)
		await page.click("#new")
		await page.waitForSelector("dialog.np-dialog[open]")
		await page.click('[data-pick="ai"]')
		await page.fill(".np-input", "A ball rolls down a ramp into a cup")
		await page.keyboard.press("Enter")
		await sleep(250)
		ok((await sheet()) === "Build with AI needs an account", "New → Build with AI: Enter shows the sheet (nothing is sent)")
		await page.click("dialog.acct-sheet .acct-google")
		await page.waitForSelector(".acct-avatar", { timeout: 5000 })
		await sleep(300)
		ok(await L(() => document.querySelector("dialog.np-dialog[open] .np-input")?.value === "A ball rolls down a ramp into a cup" && !document.querySelector("dialog.acct-sheet")), "signed in: back in New with the words typed")
		await page.click("dialog.np-dialog .np-ai")
		ok(await waitFor(async () => (await list()).length === 1, 90000), "Build now runs, and the scene is kept in the account")
		ok(await L(() => window.sandboxLibrary.store.kind === "cloud"), "(in the account)")
		await sleep(800)
		// the backstop: signed out, a 401 sign_in from the AI function itself (any way in) brings up the same sheet
		await page.click(".acct-avatar")
		await page.click('.acct-menu button:has-text("Sign out")')
		await sleep(300)
		await ctx.route("**/api/ai/**", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, code: "sign_in", error: "Sign in with Google to use Build with AI", retryable: false }) }))
		await L(() => fetch("/api/ai/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.status))
		await sleep(300)
		ok((await sheet()) === "Build with AI needs an account", "a 401 sign_in from /api/ai/* shows the sheet (the backstop)")
		await page.keyboard.press("Escape")
		for (let i = errors.length - 1; i >= 0; i--) if (/status of 401/.test(errors[i])) errors.splice(i, 1) // (the browser's own line for the test's deliberate 401)
		await done()
	},

	async cloudSavedAs() {
		const { page, L, list, waitFor, stable, addFirst, done, ctx } = await open("&accountmock=signedin&engine=browser")
		page.on("dialog", (d) => d.accept("My ramp"))
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list()).length === 1), "a scene in the account")
		await sleep(1200)
		await page.click("#save")
		await page.waitForFunction(() => document.querySelector('#scenario option[value="my-ramp"]'), null, { timeout: 8000 })
		await sleep(600)
		await page.selectOption("#scenario", "newtons-cradle")
		await sleep(1500)
		await page.selectOption("#scenario", "my-ramp")
		await sleep(1200)
		await stable()
		await addFirst()
		await sleep(1500)
		await L(() => window.sandboxLibrary.autosave.flush({ now: true }))
		const l = await list()
		ok(l.length === 1, `picking the saved scenario again continues the same scene (${l.map((m) => `${m.name}(${m.items})`).join(", ")})`)
		ok(l[0]?.savedAs === "my-ramp" && l[0]?.name === "My ramp", `linked to it in the account (savedAs ${l[0]?.savedAs})`)
		await done()
	},

	async copyLater() {
		const { page, L, list, waitFor, stable, addFirst, done } = await open("&accountmock=1")
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list()).length === 1), "a scene in this browser")
		await page.click("#my-scenes")
		await page.click(".lib-banner .acct-google")
		await page.waitForSelector(".lib-banner:not([hidden]) .lib-copy", { timeout: 5000 })
		await page.click('.lib-banner button:has-text("Not now")')
		await page.waitForSelector(".lib-foot:not([hidden]) .lib-foot-go", { timeout: 3000 })
		ok(await L(() => document.querySelector(".lib-banner").hidden && /1 scene in this browser isn’t in your account yet/.test(document.querySelector(".lib-foot").textContent)), "Not now: a quiet line under the cards instead")
		await shot(page, "copy-later")
		await page.click(".lib-foot-go")
		await page.waitForSelector(".lib-banner:not([hidden]) .lib-copy", { timeout: 3000 })
		ok(await L(() => document.querySelector(".lib-foot").hidden), "…which brings the offer back")
		await page.click(".lib-copy")
		ok(await waitFor(async () => (await list()).length === 1 && (await L(() => !document.querySelector(".lib-foot:not([hidden])") && document.querySelector(".lib-banner").hidden))), "copied: neither shows any more")
		await done()
	},

	async edits() {
		const { page, L, list, waitFor, stable, addFirst, done } = await open()
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list()).length === 1), "a project")
		await page.keyboard.press("o")
		await page.waitForSelector(".lib-item")
		await sleep(300)
		await page.focus(".lib-item .lib-open")
		await page.keyboard.press("F2")
		await page.waitForSelector(".lib-rename")
		await page.keyboard.press("Meta+a")
		await page.keyboard.type("Ramp v2.1: test! <b>x</b> ✨")
		await page.keyboard.press("Enter")
		await sleep(500)
		const nm = (await list())[0].name
		const snack = await L(() => document.querySelector(".lib-snack")?.textContent ?? "")
		ok(nm === "Ramp v2.1: test! bxb", `rename keeps ordinary punctuation (${nm})`)
		ok(/can’t have < > \/ ✨/.test(snack), `…and says what it left out (${snack})`)
		ok((await L(() => window.sandbox.scene.name)) === nm, "the table takes the name")
		await page.focus(".lib-item .lib-open")
		await page.keyboard.press("Delete")
		await sleep(400)
		const said = await L(() => document.querySelector(".lib-snack")?.textContent ?? "")
		ok(/still on the table/.test(said) && /Undo/.test(said), `deleting the scene on the table says it is still on the table (${said})`)
		await shot(page, "deleted-on-table")
		await done()
	},

	async deleteAccount() {
		const { page, L, list, waitFor, stable, addFirst, done } = await open("&accountmock=signedin")
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list()).length === 1), "a scene in the account")
		await page.click(".acct-avatar")
		await page.waitForSelector(".acct-menu")
		ok(await L(() => [...document.querySelectorAll(".acct-menu button")].some((b) => b.textContent.includes("Delete account"))), "the account menu has Delete account…")
		await page.click('.acct-menu button:has-text("Delete account")')
		await page.waitForSelector("dialog.acct-del[open]")
		const go = "dialog.acct-del .acct-danger"
		ok(await L((go) => document.querySelector(go).disabled, go), "nothing happens until DELETE is typed")
		await page.keyboard.type("delet")
		ok(await L((go) => document.querySelector(go).disabled, go), "(not yet)")
		await page.keyboard.type("e")
		await sleep(100)
		await shot(page, "delete-account")
		ok(await L((go) => !document.querySelector(go).disabled, go), "typed: the button is live")
		await page.click(go)
		await page.waitForSelector(".acct-signin", { timeout: 8000 })
		ok(await L(() => window.sandboxLibrary.auth.state === "signed-out" && window.sandboxLibrary.store.kind === "local" && !document.querySelector("dialog.acct-del")), "signed out, back to this browser")
		ok(await L(() => { const db = JSON.parse(sessionStorage.getItem("sandbox-mock-cloud")); return !db.user && !Object.keys(db.scenes).length }), "the account and its scenes are gone (DELETE /api/scenes/me)")
		ok(await L(() => /deleted/.test(document.querySelector("#toast")?.textContent ?? "")), "and it says so")
		await done()
	},

	async phone() {
		const { page, L, list, waitFor, stable, addFirst, done } = await open("", { width: 375, height: 812, ctxOpts: { hasTouch: true, isMobile: true } })
		await stable()
		await addFirst()
		ok(await waitFor(async () => (await list()).length === 1), "a project")
		await page.click("#my-scenes")
		await page.waitForSelector(".lib-item .lib-more")
		await sleep(300)
		const r = await L(() => {
			const b = document.querySelector(".lib-item .lib-more")
			const q = b.getBoundingClientRect()
			const hits = [[q.left - 7, q.top + q.height / 2], [q.right + 7, q.top + q.height / 2], [q.left + q.width / 2, q.top - 7], [q.left + q.width / 2, q.bottom + 7]].map(([x, y]) => b.contains(document.elementFromPoint(x, y)))
			return { w: q.width, hits, hoverNone: matchMedia("(hover: none)").matches }
		})
		ok(r.hoverNone && r.hits.every(Boolean), `the ⋯ button answers 7 px around its ${r.w} px circle: a 44 px target (${JSON.stringify(r)})`)
		await done()
	},

	async keys() {
		const { page, L, done } = await open()
		await L(async () => {
			const st = window.sandboxLibrary.store
			const sc = window.sandbox.scene
			await st.create({ name: "Alpha ramp", scene: { ...sc, name: "Alpha ramp" } })
			await st.create({ name: "Beta drop", scene: { ...sc, name: "Beta drop" } })
		})
		await page.keyboard.press("o")
		await page.waitForSelector(".lib-item")
		await sleep(300)
		ok(await L(() => document.activeElement?.classList.contains("lib-q")), "the search has focus")
		await page.keyboard.type("beta")
		await page.keyboard.press("Enter")
		ok(await L(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Open “Beta drop”")), "Enter: the first match")
		await page.keyboard.press("Shift+F10")
		await page.waitForSelector(".lib-menu")
		await page.keyboard.press("ArrowDown")
		ok(await L(() => document.activeElement.textContent.includes("Rename")), "Shift+F10 menu, ↓")
		await page.keyboard.press("Enter")
		await page.waitForSelector(".lib-rename")
		await page.keyboard.type("x")
		await page.keyboard.press("Escape")
		await sleep(200)
		ok(await L(async () => document.querySelector("dialog.lib-dialog").open && !document.querySelector(".lib-rename") && (await window.sandboxLibrary.store.list()).some((m) => m.name === "Beta drop")), "Esc cancels a rename (the dialog stays)")
		await page.keyboard.press("F2")
		await page.waitForSelector(".lib-rename")
		await page.keyboard.press("Meta+a")
		await page.keyboard.type("Beta drop v2")
		await page.keyboard.press("Enter")
		await sleep(400)
		ok(await L(async () => (await window.sandboxLibrary.store.list()).some((m) => m.name === "Beta drop v2")), "F2 renames")
		await page.keyboard.press("Escape")
		await sleep(300)
		ok(!(await L(() => document.querySelector("dialog.lib-dialog").open)), "Esc closes")
		await done()
	}
}

for (const [name, run] of Object.entries(parts)) {
	if (only.length && !only.includes(name)) continue
	console.log(`${name}`)
	try {
		await run()
	} catch (e) {
		ok(false, `${name} threw: ${e.message.split("\n")[0]}`)
	}
}
await browser.close()
console.log(fails ? `${fails} FAILED` : "ALL OK")
process.exit(fails ? 1 : 0)
