// web/account/clerk.js in a real (headless) Chromium: node web/account/test/clerk-browser.mjs
//   1. against a fake "clerk-js" (the importmap points the bare name at a recorder): the sign-in redirect's addresses (?profile= kept), the
//      return from Google (?auth=callback handled, then the address put back), a failed return (a sentence, no exception), the token on the
//      page's POSTs to /api/ai/* only (and one retry with a fresh token when the server says it expired), sign-out without leaving the page;
//   2. against the REAL vendored SDK (web/vendor/clerk/clerk.mjs): it loads as a module with no other-origin code, exposes the calls clerk.js
//      uses, and a Clerk that can't be reached ends in a clear failure (auth.js then shows "unavailable"), never a hang;
//   3. the REAL vendored SDK through a whole Google sign-in against an emulated Frontend API (./fapi-emulator.mjs): sign in leaves for
//      "Google", the return to ?auth=callback signs the person in and puts the address back (?profile= kept), a token comes, sign-out.
// Needs playwright-core and its headless shell (PLAYWRIGHT_CORE, CHROMIUM: defaults are this machine's). Never opens a visible window.
import { createRequire } from "node:module"
import { readFileSync, existsSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { emulateFapi } from "./fapi-emulator.mjs"

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const require = createRequire(import.meta.url)
const pw = require(process.env.PLAYWRIGHT_CORE ?? "/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
const CHROMIUM = process.env.CHROMIUM ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const PK = `pk_test_${Buffer.from("clerk.example.test$").toString("base64")}`

const FAKE = `
const log = (window.__clerkLog = [])
let user = null
const listeners = new Set()
const fire = () => listeners.forEach((f) => f({ user }))
export class Clerk {
	constructor(pk) { log.push(["new", pk]); this.pk = pk }
	get user() { return user }
	get session() { return user ? { getToken: async (o) => (o?.skipCache ? "tok-new" : "tok-old") } : null }
	async load(opts) {
		log.push(["load", { telemetry: opts?.telemetry, routerPush: typeof opts?.routerPush, routerReplace: typeof opts?.routerReplace }])
		this.client = { signIn: { authenticateWithRedirect: async (p) => { log.push(["redirect", p]) } } }
		this.environment = { displayConfig: { applicationName: "Physics Sandbox" }, userSettings: { authenticatableSocialStrategies: sessionStorage.getItem("fake:nogoogle") ? [] : ["oauth_google"] } }
	}
	async handleRedirectCallback(params, navigate) {
		log.push(["callback", params])
		if (sessionStorage.getItem("fake:fail")) throw new Error("oauth_callback.failed")
		user = { id: "user_1", fullName: "Ana Lima", primaryEmailAddress: { emailAddress: "ana@example.com" } }
		fire()
		await navigate(params.signInForceRedirectUrl)
	}
	addListener(f) { listeners.add(f); return () => listeners.delete(f) }
	async signOut(cb) { log.push(["signOut", typeof cb]); user = null; fire(); if (typeof cb === "function") await cb() }
}
`
const page = (clerkPath) => `<!doctype html><html><head><meta charset="utf-8"><title>clerk.js test</title>
<script type="importmap">{"imports": {"clerk-js": "${clerkPath}"}}</script></head>
<body><div id="toast" hidden></div><script type="module">
import { createClerkProvider } from "/account/clerk.js"
window.__make = (cfg) => createClerkProvider(cfg)
window.__ready = true
</script></body></html>`

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" }
const server = http.createServer((req, res) => {
	const u = new URL(req.url, "http://x")
	if (u.pathname === "/fake.html" || u.pathname === "/real.html") {
		res.writeHead(200, { "Content-Type": "text/html" })
		return res.end(page(u.pathname === "/fake.html" ? "/fake-clerk.mjs" : "/vendor/clerk/clerk.mjs"))
	}
	if (u.pathname === "/fake-clerk.mjs") {
		res.writeHead(200, { "Content-Type": "text/javascript" })
		return res.end(FAKE)
	}
	if (u.pathname.startsWith("/api/")) {
		const auth = req.headers.authorization ?? null
		const expired = auth === "Bearer tok-old" && u.searchParams.get("expire") === "1"
		res.writeHead(expired ? 401 : 200, { "Content-Type": "application/json" })
		return res.end(JSON.stringify(expired ? { ok: false, code: "sign_in", expired: true } : { ok: true, auth }))
	}
	const file = path.join(web, u.pathname)
	if (!file.startsWith(web + path.sep) || !existsSync(file)) {
		res.writeHead(404)
		return res.end()
	}
	res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" })
	res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const origin = `http://127.0.0.1:${server.address().port}`

const browser = await pw.chromium.launch({ headless: true, executablePath: CHROMIUM })
const results = []
const check = async (name, fn) => {
	try {
		await fn()
		results.push(["ok", name])
	} catch (e) {
		results.push(["FAIL", name, e.message.split("\n")[0]])
	}
}
try {
	const ctx = await browser.newContext()
	const p = await ctx.newPage()
	const errors = []
	p.on("pageerror", (e) => errors.push(e.message))
	const others = []
	p.on("request", (r) => {
		if (!r.url().startsWith(origin) && !r.url().startsWith("data:")) others.push(r.url())
	})
	const open = async (q = "") => {
		await p.goto(`${origin}/fake.html${q}`)
		await p.waitForFunction(() => window.__ready)
	}

	await check("no provider for a config that isn't Clerk's", async () => {
		await open()
		assert.equal(await p.evaluate(() => window.__make({ provider: "other", publishableKey: "pk_test_x" })), null)
		assert.equal(await p.evaluate(() => window.__make({ provider: "clerk", publishableKey: "sk_test_nope" })), null)
	})
	await check("load: telemetry off, Clerk's navigations kept in the page", async () => {
		await open("?profile=demo")
		await p.evaluate((pk) => window.__make({ provider: "clerk", publishableKey: pk }).then((v) => (window.__p = v)), PK)
		const log = await p.evaluate(() => window.__clerkLog)
		assert.deepEqual(log[0], ["new", PK])
		assert.deepEqual(log[1], ["load", { telemetry: false, routerPush: "function", routerReplace: "function" }])
	})
	await check("sign in: Google, coming back to ?auth=callback with ?profile= kept, then to this very address", async () => {
		await p.evaluate(() => window.__p.signIn())
		const red = (await p.evaluate(() => window.__clerkLog)).find((l) => l[0] === "redirect")[1]
		assert.equal(red.strategy, "oauth_google")
		assert.equal(red.redirectUrl, `${origin}/fake.html?profile=demo&auth=callback`)
		assert.equal(red.redirectUrlComplete, `${origin}/fake.html?profile=demo`)
		assert.equal(await p.evaluate(() => sessionStorage.getItem("sandbox:auth-back")), `${origin}/fake.html?profile=demo`)
	})
	await check("the return from Google: the callback is handled, the address put back, the person signed in", async () => {
		await open("?profile=demo&auth=callback")
		await p.evaluate((pk) => window.__make({ provider: "clerk", publishableKey: pk }).then((v) => (window.__p = v)), PK)
		const cb = (await p.evaluate(() => window.__clerkLog)).find((l) => l[0] === "callback")[1]
		assert.equal(cb.signInForceRedirectUrl, `${origin}/fake.html?profile=demo`)
		assert.equal(await p.evaluate(() => location.href), `${origin}/fake.html?profile=demo`)
		assert.deepEqual(await p.evaluate(() => window.__p.user), { id: "user_1", name: "Ana Lima", email: "ana@example.com" })
		assert.equal(await p.evaluate(() => window.__p.notice), null)
		assert.equal(await p.evaluate(() => sessionStorage.getItem("sandbox:auth-back")), null)
	})
	await check("Build with AI: POST /api/ai/* carries the token; nothing else does; an expired one is refreshed once", async () => {
		const r = await p.evaluate(async () => {
			const post = (u) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json())
			return {
				ai: await post("/api/ai/edit"),
				expired: await post("/api/ai/plan?expire=1"),
				get: await fetch("/api/ai/progress?id=1").then((r) => r.json()),
				scenes: await post("/api/scenes"),
				own: await fetch("/api/ai/edit", { method: "POST", headers: { Authorization: "Bearer mine" }, body: "{}" }).then((r) => r.json()),
			}
		})
		assert.equal(r.ai.auth, "Bearer tok-old")
		assert.equal(r.expired.auth, "Bearer tok-new")
		assert.equal(r.get.auth, null)
		assert.equal(r.scenes.auth, null)
		assert.equal(r.own.auth, "Bearer mine")
	})
	await check("sign out: no navigation, signed out after", async () => {
		const before = await p.evaluate(() => location.href)
		await p.evaluate(() => window.__p.signOut())
		assert.equal(await p.evaluate(() => location.href), before)
		assert.equal(await p.evaluate(() => window.__p.user), null)
		assert.deepEqual((await p.evaluate(() => window.__clerkLog)).find((l) => l[0] === "signOut"), ["signOut", "function"])
		const r = await p.evaluate(() => fetch("/api/ai/edit", { method: "POST", body: "{}" }).then((r) => r.json()))
		assert.equal(r.auth, null)
	})
	await check("a failed return from Google: a sentence on the page, signed out, the address put back", async () => {
		await open("?auth=callback")
		await p.evaluate(() => sessionStorage.setItem("fake:fail", "1"))
		await p.evaluate((pk) => window.__make({ provider: "clerk", publishableKey: pk }).then((v) => (window.__p = v)), PK)
		assert.match(await p.evaluate(() => window.__p.notice), /Couldn’t finish signing in/)
		assert.equal(await p.evaluate(() => document.querySelector("#toast").hidden), false)
		assert.equal(await p.evaluate(() => location.search), "")
		await p.evaluate(() => sessionStorage.removeItem("fake:fail"))
	})
	await check("Google not switched on in Clerk: no provider, a plain reason (auth.js shows sign-in unavailable)", async () => {
		await open()
		await p.evaluate(() => sessionStorage.setItem("fake:nogoogle", "1"))
		const r = await p.evaluate((pk) => window.__make({ provider: "clerk", publishableKey: pk }).then(() => "resolved", (e) => `rejected: ${e.message}`), PK)
		assert.match(r, /^rejected: Google sign-in isn’t switched on/)
		await p.evaluate(() => sessionStorage.removeItem("fake:nogoogle"))
	})
	await check("no page errors with the fake SDK", async () => assert.deepEqual(errors, []))

	// ---- the real, vendored SDK
	const q = await ctx.newPage()
	const qErrors = []
	q.on("pageerror", (e) => qErrors.push(e.message))
	const fapi = []
	await q.route("**/*", (route) => {
		const u = route.request().url()
		if (u.startsWith(origin)) return route.continue()
		fapi.push(u)
		return route.abort("connectionrefused")
	})
	await check("the vendored SDK loads as one module and has the calls clerk.js uses", async () => {
		await q.goto(`${origin}/real.html`)
		await q.waitForFunction(() => window.__ready)
		const shape = await q.evaluate(async (pk) => {
			const { Clerk } = await import("clerk-js")
			const c = new Clerk(pk)
			return { Clerk: typeof Clerk, load: typeof c.load, handleRedirectCallback: typeof c.handleRedirectCallback, signOut: typeof c.signOut, addListener: typeof c.addListener, redirectToSignIn: typeof c.redirectToSignIn, frontendApi: c.frontendApi ?? null }
		}, PK)
		assert.deepEqual(shape, { Clerk: "function", load: "function", handleRedirectCallback: "function", signOut: "function", addListener: "function", redirectToSignIn: "function", frontendApi: "clerk.example.test" })
	})
	await check("a Clerk that can't be reached: createClerkProvider fails within its 6 s (auth.js then shows sign-in unavailable)", async () => {
		const t0 = Date.now()
		const r = await q.evaluate((pk) => window.__make({ provider: "clerk", publishableKey: pk }).then(() => "resolved", (e) => `rejected: ${e.message}`), PK)
		assert.match(r, /^rejected: Clerk couldn’t be reached/)
		assert.ok(Date.now() - t0 < 9000, `took ${Date.now() - t0} ms`)
		assert.ok(fapi.length > 0 && fapi.every((u) => u.startsWith("https://clerk.example.test/")), `other-origin requests: ${fapi.slice(0, 3).join(", ")}`)
	})
	await check("the vendored SDK's other-origin requests go only to the Frontend API named by the key (no scripts from anywhere)", async () => {
		assert.ok(fapi.every((u) => new URL(u).host === "clerk.example.test"), fapi.join(", "))
		assert.ok(!fapi.some((u) => /\.js(\?|$)/.test(u)), "it asked for a script")
	})
	await check("no page errors from the real SDK", async () => assert.deepEqual(qErrors.filter((m) => !/Failed to fetch|ERR_CONNECTION|NetworkError|clerk\.example\.test|ClerkJS/i.test(m)), []))
	await check("the fake-SDK page made no other-origin request", async () => assert.deepEqual(others, []))
	console.log(`fapi requests seen (blocked): ${[...new Set(fapi.map((u) => new URL(u).pathname))].join(", ")}`)

	// ---- the real SDK, a whole sign-in, against an emulated Frontend API
	const ctx3 = await browser.newContext()
	const emu = await emulateFapi(ctx3, { origin, host: "clerk.example.test" })
	const r = await ctx3.newPage()
	const rErrors = []
	r.on("pageerror", (e) => rErrors.push(e.message))
	const make = () => r.evaluate((pk) => window.__make({ provider: "clerk", publishableKey: pk }).then((v) => ((window.__p = v), "ok"), (e) => `rejected: ${e.message}`), PK)
	await check("real SDK: loads against the Frontend API, Google switched on, nobody signed in", async () => {
		await r.goto(`${origin}/real.html?profile=demo`)
		await r.waitForFunction(() => window.__ready)
		assert.equal(await make(), "ok")
		assert.equal(await r.evaluate(() => window.__p.user), null)
	})
	await check("real SDK: Sign in asks Clerk for a Google sign-in with our two addresses, then the page goes to Google", async () => {
		const back = r.waitForURL(/auth=callback/, { timeout: 15000 })
		await r.evaluate(() => void window.__p.signIn())
		await back
		const req = emu.log.find((l) => l[0] === "POST" && l[1] === "/v1/client/sign_ins")
		const form = new URLSearchParams(req[2])
		assert.equal(form.get("strategy"), "oauth_google")
		assert.equal(form.get("redirect_url"), `${origin}/real.html?profile=demo&auth=callback`)
		assert.equal(form.get("action_complete_redirect_url"), `${origin}/real.html?profile=demo`)
		assert.ok(emu.log.some((l) => l[0] === "GOOGLE"))
	})
	await check("real SDK: back from Google, handleRedirectCallback signs the person in and the address is put back", async () => {
		await r.waitForFunction(() => window.__ready)
		assert.equal(await make(), "ok")
		assert.equal(r.url(), `${origin}/real.html?profile=demo`)
		assert.deepEqual(await r.evaluate(() => window.__p.user), { id: "user_g1", name: "Ana Lima", email: "ana@example.com" })
		assert.equal(await r.evaluate(() => window.__p.notice), null)
		assert.ok(emu.log.some((l) => l[1] === "/v1/client/sessions/sess_1/touch"), "the session was made active")
	})
	await check("real SDK: a session token for the API", async () => {
		assert.match(await r.evaluate(() => window.__p.getToken()), /^eyJ/)
		assert.match(await r.evaluate(() => window.__p.getToken({ skipCache: true })), /^eyJ/)
	})
	await check("real SDK: sign out ends the session at Clerk and stays on the page", async () => {
		await r.evaluate(() => window.__p.signOut())
		assert.equal(await r.evaluate(() => window.__p.user), null)
		assert.equal(r.url(), `${origin}/real.html?profile=demo`)
		assert.ok(emu.log.some((l) => /\/v1\/client\/sessions/.test(l[1]) && /DELETE/.test(l[1])))
	})
	await check("real SDK: a first-time Google account becomes a sign-up by itself (transfer) and is signed in", async () => {
		emu.setNewUser(true)
		const back = r.waitForURL(/auth=callback/, { timeout: 15000 })
		await r.evaluate(() => void window.__p.signIn())
		await back
		await r.waitForFunction(() => window.__ready)
		assert.equal(await make(), "ok")
		const signUp = emu.log.find((l) => l[0] === "POST" && l[1] === "/v1/client/sign_ups")
		assert.ok(signUp, "a sign-up was made")
		assert.equal(new URLSearchParams(signUp[2]).get("transfer"), "true")
		assert.equal(r.url(), `${origin}/real.html?profile=demo`)
		assert.deepEqual(await r.evaluate(() => window.__p.user), { id: "user_g1", name: "Ana Lima", email: "ana@example.com" })
		emu.setNewUser(false)
	})
	await check("real SDK: every request was one the emulated Frontend API knows, and no page errors", async () => {
		assert.deepEqual(emu.unhandled, [])
		assert.deepEqual(rErrors, [])
	})
	await ctx3.close()
} finally {
	await browser.close()
	server.close()
}
for (const r of results) console.log(r.join("  "))
const failed = results.filter((r) => r[0] !== "ok").length
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`)
process.exit(failed ? 1 : 0)
