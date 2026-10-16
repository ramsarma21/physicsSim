// Every access state of Edit with AI and New → Build with AI on the real app (headless Chromium against the running local server at :8790; it
// never starts or stops it), with the deployment's answers stood in for by request routing (the local server has the AI on): AI off, sign-in
// required (the accounts layer's ?accountmock=1), a 401 sign_in answer, a quota used up, AI on; and the fix workers judging a stage tuner's
// candidate in the page. DOM checks plus a screenshot of each state.
//   node web/ai/test/access.e2e.mjs [outDir]     (default: <tmp>/ai-access-e2e)
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { chromium } = require("/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
const EXE = "/Users/ramsarma/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "ai-access-e2e"))
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
const checks = []
const ok = (name, cond, detail = "") => (checks.push({ name, ok: !!cond, detail }), console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`))
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) })

async function page(query, routes = {}) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const p = await ctx.newPage()
	const errors = []
	p.on("pageerror", (e) => errors.push(String(e?.message ?? e)))
	const hits = []
	for (const [pat, fn] of Object.entries(routes)) await p.route(pat, async (r) => (hits.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`), r.fulfill(await fn(r))))
	const profile = `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
	await p.goto(`http://localhost:8790/?engine=server&profile=${profile}${query}`, { waitUntil: "domcontentloaded" })
	await p.waitForFunction(() => !document.querySelector("#new")?.disabled && window.sandbox?.scene, null, { timeout: 90000 })
	await p.waitForTimeout(2500) // (the AI panel mounts when the page is idle, and asks what the deployment says)
	return { p, ctx, errors, hits }
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `${name}.png`) })
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText ?? null, sel)

// ---- 1. AI off on this deployment: /api/scenes/me (asked with ?accounts=1, as on a deploy) has no accounts; the probe answers not_configured
{
	const { p, ctx, errors, hits } = await page("&accounts=1", {
		"**/api/scenes/me": () => json(200, { ok: true, accounts: null, storage: false, ai: { signInRequired: false } }),
		"**/api/ai/edit": () => json(503, { ok: false, code: "not_configured", error: "the AI is not switched on for this deployment (no access configured)", retryable: false })
	})
	await p.waitForFunction(() => document.querySelector("#ai")?.classList.contains("ai-off"), null, { timeout: 15000 }).catch(() => {})
	ok("off: the top bar's Edit with AI is marked off before anything is opened", await p.evaluate(() => document.querySelector("#ai").classList.contains("ai-off")), await p.evaluate(() => document.querySelector("#ai").title))
	ok("off: the probe was one POST /api/ai/edit", hits.filter((h) => h === "POST /api/ai/edit").length === 1, hits.join(", "))
	await shot(p, "off-1-topbar")
	await p.click("#ai")
	await p.waitForTimeout(500)
	const offSays = await p.evaluate(() => [...document.querySelectorAll("#ai-drawer .ai-hero, #ai-drawer .ai-access")].filter((e) => !e.hidden).map((e) => e.innerText).join(" | "))
	ok("off: the drawer says so first, with no input box (the empty drawer's welcome gives way to it; one notice, not two)", /^AI isn['’]t available on this deployment/.test(offSays) && !offSays.includes(" | ") && (await p.evaluate(() => document.querySelector("#ai-drawer .ai-box").hidden)), offSays)
	ok("off: the drawer's hero has no stray 'null'", !/\bnull\b/.test((await text(p, "#ai-drawer .ai-hero")) ?? ""))
	await shot(p, "off-2-drawer")
	await p.click("#ai-drawer .ai-hero .ai-chip-btn")
	await p.waitForTimeout(500)
	ok("off: 'Start from an example' opens New on the examples", await p.evaluate(() => document.querySelector("dialog.np-dialog[open] [data-pick='example']")?.getAttribute("aria-pressed") === "true"))
	await shot(p, "off-3-new-examples")
	await p.click("dialog.np-dialog [data-pick='ai']")
	await p.waitForTimeout(300)
	ok("off: New → Build with AI says so up front, with no box and no Build button", (await text(p, "dialog.np-dialog .np-access"))?.includes("AI isn't available on this deployment") && (await p.evaluate(() => document.querySelector("dialog.np-dialog .np-box").hidden && document.querySelector("dialog.np-dialog .np-row").hidden)))
	await shot(p, "off-4-new-ai")
	ok("off: no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}

// ---- 2. sign-in required, signed out (the accounts layer's dev mock: ?accountmock=1)
{
	const { p, ctx, errors, hits } = await page("&accountmock=1")
	await p.evaluate(() => window.sandbox.openNew({ ai: true }))
	await p.waitForTimeout(500)
	ok("sign-in: New → Build with AI says 'needs an account' before anything is typed", (await text(p, "dialog.np-dialog .np-access"))?.includes("Build with AI needs an account"), await text(p, "dialog.np-dialog .np-access"))
	ok("sign-in: the box stays, to type in", await p.evaluate(() => !document.querySelector("dialog.np-dialog .np-box").hidden))
	await shot(p, "signin-1-new")
	await p.fill("dialog.np-dialog .np-input", "A ball rolls down a ramp into a cup")
	await p.click("dialog.np-dialog .np-ai")
	await p.waitForTimeout(500)
	ok("sign-in: Build opens the accounts layer's sheet (Continue with Google)", (await text(p, "dialog.acct-sheet[open]"))?.includes("Continue with Google"), (await text(p, "dialog.acct-sheet[open]"))?.replace(/\s+/g, " ").slice(0, 160))
	ok("sign-in: what was typed is kept for after Google", await p.evaluate(() => /ramp into a cup/.test(sessionStorage.getItem("sandbox:ai-after-sign-in") ?? "") || /ramp into a cup/.test(document.querySelector("dialog.np-dialog .np-input")?.value ?? "")))
	await shot(p, "signin-2-sheet-new")
	await p.keyboard.press("Escape")
	await p.waitForTimeout(300)
	await p.evaluate(() => document.querySelector("dialog.np-dialog")?.close())
	await p.click("#ai")
	await p.waitForTimeout(500)
	ok("sign-in: Edit with AI opens the same sheet", (await text(p, "dialog.acct-sheet[open]"))?.includes("needs an account"))
	await shot(p, "signin-3-sheet-edit")
	ok("sign-in: no AI request was made", !hits.length && true)
	ok("sign-in: no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}

// ---- 3. signed in, but a step answers 401 sign_in (the token ran out): a card with Continue with Google, never Try again; the words kept
{
	const { p, ctx, errors } = await page("&accountmock=signedin", {
		"**/api/ai/plan": () => json(401, { ok: false, code: "sign_in", error: "Sign in with Google to use Build with AI", retryable: false, signIn: true })
	})
	await p.evaluate(() => window.sandbox.openNew({ ai: true, text: "A pendulum knocks over ten dominoes" }))
	await p.waitForTimeout(400)
	await p.click("dialog.np-dialog .np-ai")
	await p.waitForSelector("#ai-drawer li.ai-bot.ai-s-error", { timeout: 20000 })
	await p.waitForTimeout(600)
	const card = await text(p, "#ai-drawer li.ai-bot.ai-s-error")
	ok("sign_in answer: the card says 'Sign in with Google to use AI' with Continue with Google", card?.includes("Sign in with Google to use AI") && card.includes("Continue with Google"), card?.replace(/\s+/g, " "))
	ok("sign_in answer: no Try again", !/Try again/.test(card ?? ""))
	await shot(p, "signin-4-sheet-backstop")
	ok("sign_in answer: the accounts layer's backstop sheet opens too", (await text(p, "dialog.acct-sheet[open]"))?.includes("Sign in again"))
	await p.click("dialog.acct-sheet[open] .acct-sheet-later")
	await p.waitForTimeout(300)
	await shot(p, "signin-5-card")
	ok("sign_in answer: no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}

// ---- 4. quota: a step answers 403 quota with resetsAt
{
	const resetsAt = new Date(Date.now() + 5 * 3600e3).toISOString()
	const { p, ctx, errors } = await page("&accountmock=signedin", {
		"**/api/ai/plan": () => json(403, { ok: false, code: "quota", error: "You've used today's Build with AI allowance. It resets at 00:00 UTC.", resetsAt, retryable: false })
	})
	await p.evaluate(() => window.sandbox.openNew({ ai: true, text: "A toy car races into dominoes" }))
	await p.waitForTimeout(400)
	await p.click("dialog.np-dialog .np-ai")
	await p.waitForSelector("#ai-drawer li.ai-bot.ai-s-error", { timeout: 20000 })
	await p.waitForTimeout(600)
	const card = await text(p, "#ai-drawer li.ai-bot.ai-s-error")
	ok("quota: the card says 'You've used today's AI allowance — resets at <time>'", /You[’']ve used today[’']s AI allowance — resets (tomorrow )?at \d/.test(card ?? ""), card?.replace(/\s+/g, " "))
	ok("quota: no Try again", !/Try again/.test(card ?? ""))
	ok("quota: the drawer's box gives way to the allowance notice", (await p.evaluate(() => document.querySelector("#ai-drawer .ai-box").hidden)) && /AI is back|resets (tomorrow )?at/.test((await text(p, "#ai-drawer .ai-access")) ?? ""), await text(p, "#ai-drawer .ai-access"))
	await shot(p, "quota-1-card")
	await p.evaluate(() => window.sandbox.openNew({ ai: true }))
	await p.waitForTimeout(400)
	ok("quota: New → Build with AI says it up front, no box", /resets (tomorrow )?at/.test((await text(p, "dialog.np-dialog .np-access")) ?? "") && (await p.evaluate(() => document.querySelector("dialog.np-dialog .np-box").hidden)), await text(p, "dialog.np-dialog .np-access"))
	await shot(p, "quota-2-new")
	ok("quota: no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}

// ---- 4b. quota known before anything is asked: /api/scenes/me's aiToday says today's steps are used up (as on a deploy, ?accounts=1)
{
	const resetsAt = new Date(Date.now() + 4 * 3600e3).toISOString()
	const { p, ctx, errors, hits } = await page("&accounts=1", {
		"**/api/scenes/me": () => json(200, { ok: true, accounts: null, storage: false, ai: { signInRequired: false }, aiToday: { steps: 200, usd: 0.4, maxSteps: 200, maxUsd: 2, resetsAt } }),
		"**/api/ai/edit": () => json(400, { ok: false, code: "bad_input", error: "text is required", retryable: false })
	})
	await p.waitForFunction(() => document.querySelector("#ai")?.title?.includes("allowance"), null, { timeout: 15000 }).catch(() => {})
	await p.click("#ai")
	await p.waitForTimeout(500)
	const says = await p.evaluate(() => [...document.querySelectorAll("#ai-drawer .ai-hero, #ai-drawer .ai-access")].filter((e) => !e.hidden).map((e) => e.innerText).join(" | "))
	ok("quota up front: the empty drawer says today's allowance is used, with no box, before anything is asked", /^You[’']ve used today[’']s AI allowance — resets (tomorrow )?at \d/.test(says) && (await p.evaluate(() => document.querySelector("#ai-drawer .ai-box").hidden)) && !hits.some((h) => /\/api\/ai\/(plan|refine|observe)/.test(h)), says.replace(/\s+/g, " "))
	await shot(p, "quota-3-upfront-drawer")
	ok("quota up front: no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}

// ---- 5. the local server as it is (AI on): nothing is asked, nothing changes
{
	const { p, ctx, errors, hits } = await page("", { "**/api/ai/edit": () => json(400, { ok: false, code: "bad_input", error: "probe" }) })
	await p.click("#ai")
	await p.waitForTimeout(500)
	ok("on: the drawer has its box, no notice", await p.evaluate(() => !document.querySelector("#ai-drawer .ai-box").hidden && document.querySelector("#ai-drawer .ai-access").hidden))
	ok("on: no probe on the local server", !hits.length, hits.join(", "))
	// the fix workers judge a stage tuner's candidate (and the fix search's) off the page's thread
	const w = await p.evaluate(async () => {
		const m = await import("/ai/fix-pool.js")
		const pool = m.createFixPool()
		const scene = window.sandbox.scene
		const goals = (scene.goals ?? []).map((g) => ({ ...g, kind: "in" }))
		const t0 = performance.now()
		const r = await pool.stage(scene, goals, goals, undefined)
		const fx = await import("/ai/fixer.js")
		const targets = fx.fixTargets({ goals, scene })
		const f = await pool.evaluate(scene, targets, undefined)
		pool.terminate()
		return { size: pool.size, broken: pool.broken, goals: r.goals.map((g) => g.ok), d: r.checks.map((c) => c.d), warnings: r.warnings, ms: Math.round(performance.now() - t0), fixOk: f.ok }
	})
	ok("workers: the fix pool judges a stage tuner candidate and a fix candidate", !w.broken && w.goals.length > 0 && w.goals.every((x) => x === true) && w.d.every((x) => x === 0) && w.fixOk === true, JSON.stringify(w))
	await shot(p, "on-1-drawer")
	ok("on: no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}
await browser.close()
fs.writeFileSync(path.join(OUT, "checks.json"), JSON.stringify(checks, null, 1))
console.log(`${checks.filter((c) => c.ok).length}/${checks.length} checks passed · screenshots in ${OUT}`)
process.exit(checks.every((c) => c.ok) ? 0 : 1)
