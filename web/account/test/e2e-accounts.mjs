// The whole account path in a headless Chromium, with no accounts or network: node web/account/test/e2e-accounts.mjs
// The real page (web/index.html, the browser engine) and its account layer (web/account: auth.js -> clerk.js -> store.js -> cloud.js) talk to
// the REAL scenes function (api/scenes/index.mjs) on a Postgres in this process (PGlite); only Clerk is stood in for: "clerk-js" is answered
// by a small Clerk-shaped module whose Google round trip is immediate and whose session tokens are real RS256 JWTs signed by this test's own
// Clerk instance (the function verifies them exactly as it verifies Clerk's). It checks: sign in -> the chip shows the person; a scene saved
// to the account is in the database under that person; My scenes lists it; its picture goes up and comes back; a second device signing in as the same person
// sees it; another person does not; signing out goes back to this browser's scenes; no page errors; nothing asked of another origin.
// Also (round 3): signed out, Build with AI shows "needs an account" (and the REAL AI gate's 401 sign_in brings it up too), signed in the gate
// lets the person through; savedAs is kept in the database; two devices changing one scene keep both versions (If-Match, 412, "(other copy)");
// Delete account… removes the account, its scenes and the Clerk user; Clerk connected without a database (storage: false) stays local.
// Needs playwright-core and its headless shell (PLAYWRIGHT_CORE, CHROMIUM; defaults are this machine's). Never opens a visible window.
import { createRequire } from "node:module"
import { readFileSync, existsSync, statSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { testClerk, testDatabase } from "./helpers.mjs"
import { handle } from "../../../api/scenes/index.mjs"
import { aiGate } from "../../../api/_lib/ai-gate.mjs"

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const require = createRequire(import.meta.url)
const pw = require(process.env.PLAYWRIGHT_CORE ?? "/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
const CHROMIUM = process.env.CHROMIUM ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`

const clerk = testClerk("clerk.e2e.example")
clerk.users.set("user_e2e_ana", { email: "ana@example.com", first: "Ana", last: "Lima" })
clerk.users.set("user_e2e_bo", { email: "bo@example.com", first: "Bo", last: "Reyes" })
const ENV = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.pk, CLERK_SECRET_KEY: ["sk", "test", "E2ETESTSECRET0123456789"].join("_"), DATABASE_URL: "postgres://e2e:x@127.0.0.1/none" }
const db = await testDatabase()

// the stand-in for the vendored SDK (same calls web/account/clerk.js makes); the person to sign in as is ?as=<sub> (default Ana)
const FAKE_CLERK = `
const KEY = "e2e:clerk-user"
const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) } catch { return null } }
let person = read()
const listeners = new Set()
const fire = () => listeners.forEach((f) => f({ user: person }))
export class Clerk {
	constructor(pk) { this.pk = pk }
	async load() {
		this.environment = { displayConfig: { applicationName: "Physics Sandbox" }, userSettings: { authenticatableSocialStrategies: ["oauth_google"] } }
		this.client = { signIn: { authenticateWithRedirect: async ({ redirectUrl }) => { sessionStorage.setItem("e2e:going", new URLSearchParams(location.search).get("as") || "user_e2e_ana"); location.assign(redirectUrl) } } }
	}
	get user() { return person ? { id: person.sub, fullName: person.name, primaryEmailAddress: { emailAddress: person.email } } : null }
	get session() { return person ? { getToken: async () => (await fetch("/__test/token?sub=" + encodeURIComponent(person.sub))).text() } : null }
	async handleRedirectCallback(params, navigate) {
		const sub = sessionStorage.getItem("e2e:going")
		sessionStorage.removeItem("e2e:going")
		if (sub) {
			const who = await (await fetch("/__test/person?sub=" + encodeURIComponent(sub))).json()
			person = { sub, ...who }
			sessionStorage.setItem(KEY, JSON.stringify(person))
			fire()
		}
		await navigate(params.signInForceRedirectUrl)
	}
	addListener(f) { listeners.add(f); return () => listeners.delete(f) }
	async signOut(cb) { person = null; sessionStorage.removeItem(KEY); fire(); if (typeof cb === "function") await cb() }
}
`
const TYPES = { ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".wasm": "application/wasm" }
const apiLog = []
const server = http.createServer(async (req, res) => {
	const u = new URL(req.url, "http://x")
	if (u.pathname === "/vendor/clerk/clerk.mjs") {
		res.writeHead(200, { "Content-Type": TYPES[".mjs"] })
		return res.end(FAKE_CLERK)
	}
	if (u.pathname === "/__test/token") {
		const origin = `http://${req.headers.host}`
		res.writeHead(200, { "Content-Type": "text/plain" })
		return res.end(clerk.token({ sub: u.searchParams.get("sub"), azp: origin }))
	}
	if (u.pathname === "/__test/person") {
		const p = clerk.users.get(u.searchParams.get("sub"))
		res.writeHead(200, { "Content-Type": "application/json" })
		return res.end(JSON.stringify({ name: [p?.first, p?.last].filter(Boolean).join(" "), email: p?.email }))
	}
	if (u.pathname === "/api/scenes" || u.pathname.startsWith("/api/scenes/")) {
		const t0 = Date.now()
		await handle(req, res, { env: ENV, fetch: clerk.fetch })
		apiLog.push(`${req.method} ${u.pathname} ${res.statusCode} ${Date.now() - t0}ms`)
		return
	}
	if (u.pathname.startsWith("/api/ai/") && req.method === "POST") {
		// the REAL gate (api/_lib/ai-gate.mjs) in front of a step this test doesn't run: who may use Build with AI
		const gate = await aiGate(req, u.pathname.split("/").pop(), { accessProblem: () => [503, "not_configured", "no invite or preview token here"], env: ENV, fetch: clerk.fetch })
		apiLog.push(`POST ${u.pathname} ${gate.ok ? "gate ok" : gate.status}`)
		res.writeHead(gate.ok ? 503 : gate.status, { "Content-Type": "application/json" })
		return res.end(JSON.stringify(gate.ok ? { ok: false, error: "no AI model in this test", code: "unavailable", passedGate: true } : { ok: false, error: gate.error, code: gate.code, ...gate.extra }))
	}
	if (u.pathname.startsWith("/api/")) {
		res.writeHead(503, { "Content-Type": "application/json" })
		return res.end(JSON.stringify({ ok: false, error: "not in this test", code: "unavailable" }))
	}
	let file = path.join(web, decodeURIComponent(u.pathname))
	if (u.pathname === "/") file = path.join(web, "index.html")
	if (!file.startsWith(web) || !existsSync(file) || statSync(file).isDirectory()) {
		res.writeHead(404, { "Content-Type": "text/plain" })
		return res.end("404")
	}
	res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" })
	res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const origin = `http://127.0.0.1:${server.address().port}`
const APP = `${origin}/?engine=browser&accounts=1&intro=0`

const browser = await pw.chromium.launch({ headless: true, executablePath: CHROMIUM, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] })
const results = []
const check = async (name, fn) => {
	try {
		await fn()
		results.push(["ok", name])
	} catch (e) {
		results.push(["FAIL", name, String(e.message).split("\n").slice(0, 3).join(" | ")])
	}
}
const accountOf = async (sub) => (await db.pg.query("select account_id from identities where sub = $1", [sub])).rows[0]?.account_id ?? null
async function device(name, { viewport = { width: 1440, height: 900 } } = {}) {
	const ctx = await browser.newContext({ viewport })
	const page = await ctx.newPage()
	const errors = []
	const others = []
	page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`))
	page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${name} console: ${m.text().slice(0, 200)}`))
	page.on("request", (r) => {
		const u = r.url()
		if (!u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:")) others.push(u)
	})
	return { ctx, page, errors, others }
}
const ready = (page) => page.waitForFunction(() => window.sandboxLibrary?.auth && window.sandboxLibrary.auth.state !== "loading" && !document.querySelector("#my-scenes")?.disabled, null, { timeout: 60000 })
const state = (page) => page.evaluate(() => ({ auth: window.sandboxLibrary.auth.state, kind: window.sandboxLibrary.store.kind, user: window.sandboxLibrary.auth.user }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const postAi = (page) => page.evaluate(async () => { const r = await fetch("/api/ai/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: {} }) }); return { status: r.status, ...(await r.json()) } })
const sheetTitle = (page) => page.evaluate(() => document.querySelector("dialog.acct-sheet[open] h2")?.textContent ?? null)

let a, b, c
try {
	a = await device("laptop")
	await check("a deploy with accounts, signed out: the page asks /api/scenes/me and offers Sign in", async () => {
		await a.page.goto(APP)
		await ready(a.page)
		const s = await state(a.page)
		assert.equal(s.auth, "signed-out")
		assert.equal(s.kind, "local")
		assert.ok(await a.page.locator(".acct-signin").isVisible(), "the Sign in button shows")
		assert.ok(apiLog.some((l) => l.startsWith("GET /api/scenes/me 200")))
	})
	await check("signed out: Edit with AI shows \"needs an account\" (not the panel), and the real AI gate's 401 sign_in brings it up too", async () => {
		assert.equal(await a.page.evaluate(() => window.sandboxLibrary.auth.aiSignInRequired), true, "/api/scenes/me said ai.signInRequired")
		await a.page.locator("#ai").click()
		await a.page.waitForSelector("dialog.acct-sheet[open]", { timeout: 5000 })
		assert.equal(await sheetTitle(a.page), "Edit with AI needs an account")
		assert.notEqual(await a.page.evaluate(() => document.querySelector("#ai").getAttribute("aria-expanded")), "true", "the AI drawer stayed shut")
		await a.page.keyboard.press("Escape")
		const r = await postAi(a.page)
		assert.deepEqual([r.status, r.code], [401, "sign_in"])
		await a.page.waitForSelector("dialog.acct-sheet[open]", { timeout: 5000 })
		assert.equal(await sheetTitle(a.page), "Build with AI needs an account")
		await a.page.keyboard.press("Escape")
	})
	await check("Sign in: Google's round trip, then the chip shows the person and My scenes is the account", async () => {
		const back = a.page.waitForURL(/auth=callback/, { timeout: 20000 })
		await a.page.locator(".acct-signin").click()
		await back
		await a.page.waitForFunction(() => window.sandboxLibrary?.auth?.state === "signed-in", null, { timeout: 30000 })
		await ready(a.page)
		const s = await state(a.page)
		assert.equal(s.kind, "cloud")
		assert.equal(s.user.email, "ana@example.com")
		assert.equal(await a.page.locator(".acct-avatar").first().textContent(), "AL")
		assert.ok(!(await a.page.evaluate(() => location.search)).includes("auth=callback"), "the address is put back")
	})
	await check("signed in: the AI gate lets the person through (their token is on the request)", async () => {
		const r = await postAi(a.page)
		assert.equal(r.passedGate, true, JSON.stringify(r))
		assert.ok(!(await a.page.evaluate(() => !!document.querySelector("dialog.acct-sheet[open]"))), "no sheet")
	})
	await check("savedAs (the app's Save links a scene to its scenario) is kept in the database and comes back", async () => {
		const meta = await a.page.evaluate(async () => window.sandboxLibrary.store.create({ name: "Saved ramp", scene: structuredClone(window.sandbox.scene), savedAs: "saved-ramp" }))
		assert.equal(meta.savedAs, "saved-ramp")
		assert.equal((await db.pg.query("select saved_as from scenes where id = $1", [meta.id])).rows[0].saved_as, "saved-ramp")
		const back = await a.page.evaluate(async (id) => (await window.sandboxLibrary.store.list()).find((m) => m.id === id)?.savedAs, meta.id)
		assert.equal(back, "saved-ramp")
		await a.page.evaluate((id) => window.sandboxLibrary.store.remove(id), meta.id)
	})
	await check("a scene saved to the account is in the database, under that person, with a server-made id", async () => {
		const meta = await a.page.evaluate(async () => window.sandboxLibrary.store.create({ name: "E2E ramp", scene: structuredClone(window.sandbox.scene) }))
		assert.match(meta.id, /^s_[a-z2-7]{16}$/)
		const acct = await accountOf("user_e2e_ana")
		const rows = (await db.pg.query("select name, owner_id from scenes where id = $1", [meta.id])).rows
		assert.deepEqual(rows, [{ name: "E2E ramp", owner_id: acct }])
	})
	await check("My scenes (the library) lists the account's scenes", async () => {
		await a.page.evaluate(() => window.sandboxLibrary.open())
		await a.page.waitForFunction(() => [...document.querySelectorAll("dialog[open]")].some((d) => d.textContent.includes("E2E ramp")), null, { timeout: 15000 })
		await a.page.keyboard.press("Escape")
	})
	await check("a picture: sent with the token, kept by the server, served back to the card (a picture alone is not an edit)", async () => {
		const r = await a.page.evaluate(async () => {
			const m = (await window.sandboxLibrary.store.list()).find((x) => x.name === "E2E ramp")
			const c = new OffscreenCanvas(64, 36)
			const g = c.getContext("2d")
			g.fillStyle = "#2557d6"
			g.fillRect(0, 0, 64, 36)
			const blob = await c.convertToBlob({ type: "image/webp", quality: 0.8 })
			const m2 = await window.sandboxLibrary.store.update(m.id, { thumb: blob })
			const back = await window.sandboxLibrary.store.thumb(m2)
			return { versions: [m.version, m2.version], sent: blob.size, type: back?.type ?? null, size: back?.size ?? null }
		})
		assert.equal(r.versions[0], r.versions[1])
		assert.equal(r.type, "image/webp")
		assert.equal(r.size, r.sent)
		const acct = await accountOf("user_e2e_ana")
		const row = (await db.pg.query("select thumb_type, octet_length(thumb) as n from scenes where owner_id = $1 and name = 'E2E ramp'", [acct])).rows[0]
		assert.deepEqual(row, { thumb_type: "image/webp", n: r.sent })
	})
	b = await device("phone", { viewport: { width: 375, height: 812 } })
	await check("a second device signs in as the same person and sees the same scenes", async () => {
		await b.page.goto(APP)
		await ready(b.page)
		const back = b.page.waitForURL(/auth=callback/, { timeout: 20000 })
		await b.page.locator(".acct-signin").click()
		await back
		await b.page.waitForFunction(() => window.sandboxLibrary?.auth?.state === "signed-in", null, { timeout: 30000 })
		const names = await b.page.evaluate(async () => (await window.sandboxLibrary.store.list()).map((m) => m.name))
		assert.ok(names.includes("E2E ramp"), names.join(", "))
	})
	await check("two devices change one scene: neither overwrites the other (If-Match: the second is kept as \"(other copy)\")", async () => {
		const id = await a.page.evaluate(async () => (await window.sandboxLibrary.store.list()).find((m) => m.name === "E2E ramp").id)
		for (const d of [a, b]) await d.page.evaluate((id) => window.sandboxLibrary.autosave.open(id), id)
		await sleep(600)
		await a.page.evaluate(() => window.sandboxApp.rename("Ramp from the laptop"))
		await sleep(300)
		await a.page.evaluate(() => window.sandboxLibrary.autosave.flush({ now: true }))
		await b.page.evaluate(() => window.sandboxApp.rename("Ramp from the phone"))
		await sleep(300)
		await b.page.evaluate(() => window.sandboxLibrary.autosave.flush({ now: true }))
		const acct = await accountOf("user_e2e_ana")
		let names = []
		for (let i = 0; i < 40 && !names.includes("Ramp from the phone (other copy)"); i++) {
			await sleep(250)
			names = (await db.pg.query("select name from scenes where owner_id = $1 and deleted_at is null", [acct])).rows.map((r) => r.name)
		}
		assert.ok(names.includes("Ramp from the laptop"), names.join(" | "))
		assert.ok(names.includes("Ramp from the phone (other copy)"), names.join(" | "))
		assert.equal((await db.pg.query("select name from scenes where id = $1", [id])).rows[0].name, "Ramp from the laptop", "the laptop's change was not overwritten")
		const cur = await b.page.evaluate(() => window.sandboxLibrary.autosave.currentId)
		assert.equal((await db.pg.query("select name from scenes where id = $1", [cur])).rows[0]?.name, "Ramp from the phone (other copy)", "the phone goes on in its copy")
	})
	await check("the phone: no sideways scroll with the account chip in the bar", async () => {
		const w = await b.page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
		assert.ok(w[0] <= w[1], `scrollWidth ${w[0]} > ${w[1]}`)
	})

	c = await device("someone else")
	await check("another person sees none of them", async () => {
		await c.page.goto(`${APP}&as=user_e2e_bo`)
		await ready(c.page)
		const back = c.page.waitForURL(/auth=callback/, { timeout: 20000 })
		await c.page.locator(".acct-signin").click()
		await back
		await c.page.waitForFunction(() => window.sandboxLibrary?.auth?.state === "signed-in", null, { timeout: 30000 })
		const names = await c.page.evaluate(async () => (await window.sandboxLibrary.store.list()).map((m) => m.name))
		assert.ok(!names.includes("E2E ramp"), names.join(", "))
		assert.equal((await state(c.page)).user.email, "bo@example.com")
	})
	await check("Delete account…: after typing DELETE, the account, its scenes and the Clerk user are gone, and the page is signed out", async () => {
		const made = await c.page.evaluate(async () => window.sandboxLibrary.store.create({ name: "Bo's ramp", scene: structuredClone(window.sandbox.scene) }))
		const acct = await accountOf("user_e2e_bo")
		assert.ok(acct)
		const n0 = clerk.calls.deletes
		await c.page.locator(".acct-avatar").click()
		await c.page.locator('.acct-menu button:has-text("Delete account")').click()
		await c.page.waitForSelector("dialog.acct-del[open]")
		assert.equal(await c.page.locator("dialog.acct-del .acct-danger").isDisabled(), true)
		await c.page.fill("dialog.acct-del .acct-del-q", "DELETE")
		await c.page.locator("dialog.acct-del .acct-danger").click()
		await c.page.waitForFunction(() => window.sandboxLibrary.auth.state === "signed-out", null, { timeout: 15000 })
		assert.equal(await accountOf("user_e2e_bo"), null, "no identity left")
		assert.equal((await db.pg.query("select count(*)::int as n from scenes where owner_id = $1 or id = $2", [acct, made.id])).rows[0].n, 0, "no scene left")
		assert.equal((await db.pg.query("select count(*)::int as n from accounts where id = $1", [acct])).rows[0].n, 0, "no account left")
		assert.equal(clerk.calls.deletes, n0 + 1, "the Clerk user was deleted")
		assert.equal((await state(c.page)).kind, "local")
	})
	await check("Clerk connected but no database yet (storage: false): the page stays local, nothing about signing in shows", async () => {
		const d = await device("no database")
		await d.ctx.route("**/api/scenes/me", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, accounts: { provider: "clerk", publishableKey: clerk.pk }, storage: false, ai: { signInRequired: false } }) }))
		await d.page.goto(APP)
		await d.page.waitForFunction(() => window.sandboxLibrary?.auth && window.sandboxLibrary.auth.state !== "loading" && !document.querySelector("#my-scenes")?.disabled, null, { timeout: 60000 })
		assert.equal((await state(d.page)).auth, "local")
		assert.equal(await d.page.locator(".acct-signin").count(), 0)
		await d.ctx.close()
	})
	await check("signing out: My scenes is this browser's again", async () => {
		await a.page.evaluate(() => window.sandboxLibrary.auth.signOut())
		const s = await state(a.page)
		assert.equal(s.auth, "signed-out")
		assert.equal(s.kind, "local")
	})
	await check("no page errors, and no request to another origin", async () => {
		const errors = [...a.errors, ...b.errors, ...c.errors]
		assert.deepEqual(errors, [])
		assert.deepEqual([...a.others, ...b.others, ...c.others], [])
	})
} finally {
	await browser.close()
	server.close()
	await db.close()
}
for (const r of results) console.log(r.join("  "))
console.log(`scenes API calls: ${apiLog.length} (${[...new Set(apiLog.map((l) => l.split(" ").slice(0, 3).join(" ")))].slice(0, 12).join("; ")})`)
const failed = results.filter((r) => r[0] !== "ok").length
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`)
process.exit(failed ? 1 : 0)
