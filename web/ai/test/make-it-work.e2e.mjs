// "Looking for a fix…" on the real app, as a person uses it (headless Chromium against a running local server; it never starts or stops one):
// the user's breakfast edit with the edit step's answer stood in for by request routing (no model call; the physics, the fix search and the
// stage-by-stage search are the real ones, on the page's fix workers). ai/DESIGN.md §16.
//   1. what it is doing shows and changes while it looks ("· 42 physics runs");
//   2. its Stop stops it: "I stopped looking for a fix." with the button, and no unhandled rejection;
//   3. the card's Undo while it looks: the search stops, "You undid this change, so I stopped looking for a fix.", no offer for the gone scene;
//   4. the checked fix offered, clicked: the fix card lists each change (the closed laptop); its Undo puts the edit back and the edit card is the
//      live one again (its checked chip shows, the fix card offers Restore), and "yes" puts the fix back;
//   5. a double click on the checked fix applies it once; 6. no "Check it" beside a checked fix; 7. both undone: every card stale, "yes" asks
//      nothing (ai/DESIGN.md §16.2); 8–13 the paid button once, Undo while the AI works, a rename by hand, Look again; 14. a rework stopped
//      by its Cancel and asked again: no "Run again", no second paid button; 15. a search stopped by an Undo, its scene back by Redo: "Look
//      again" and the button, and "yes" spends nothing (§16.3).
//   node web/ai/test/make-it-work.e2e.mjs [--base http://localhost:8790] [outDir]
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { chromium } = require("/Users/ramsarma/.bun/install/cache/playwright-core@1.60.0@@@1")
const EXE = "/Users/ramsarma/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
const bi = process.argv.indexOf("--base")
const BASE = bi > 0 ? process.argv[bi + 1] : "http://localhost:8790"
const OUT = path.resolve(process.argv.filter((a, i) => i > 1 && a !== "--base" && process.argv[i - 1] !== "--base")[0] ?? path.join(os.tmpdir(), "ai-make-it-work-e2e"))
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] })
const checks = []
const ok = (name, cond, detail = "") => (checks.push({ name, ok: !!cond, detail }), console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`))

/** The edit step's answer to the user's request (a recorded live answer: six standing soda cans where the dominoes stood, full). */
const BREAKFAST = {
	kind: "change",
	mode: "patch",
	why: "They asked to swap, replace and add items on screen.",
	reply: "I swapped the red ball for an orange and the yellow ball for an egg, replaced the dominoes with six standing soda cans, and put a rubber duck in the box.",
	targets: [{ says: "the red ball", ids: ["ball1"] }, { says: "the yellow ball", ids: ["ball2"] }, { says: "the dominoes", ids: ["dominoes"] }, { says: "the box", ids: ["box"] }],
	patches: [
		{ op: "replace_type", id: "ball1", type: "orange", props: {} },
		{ op: "set_item", id: "ball1", name: "Orange" },
		{ op: "replace_type", id: "ball2", type: "egg", props: {} },
		{ op: "set_item", id: "ball2", name: "Egg" },
		{ op: "remove", id: "dominoes" },
		...Array.from({ length: 6 }, (_, k) => ({ op: "add", item: { id: `can${k + 1}`, type: "soda-can", name: `Soda can ${k + 1}`, props: {}, place: { on: "table", x: Math.round((1.86 + 0.1 * k) * 100) / 100 } } })),
		{ op: "add", item: { id: "duck", type: "rubber-duck", name: "Rubber duck", props: {}, place: { on: "box", inside: "box" } } },
		{ op: "set_scene", title: "Breakfast-table disaster" }
	],
	missing: [],
	suggestions: [{ label: "Add a falling cereal box", prompt: "Add a cereal box after the soda cans that topples onto the seesaw" }]
}
const USER = "Turn this into a breakfast-table disaster: swap the red ball for an orange and the yellow ball for an egg, replace the dominoes with a row of standing soda cans, and put a rubber duck in the box waiting for its egg."

async function page() {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const p = await ctx.newPage()
	const errors = []
	p.on("pageerror", (e) => errors.push(String(e?.message ?? e)))
	const edits = []
	// (the edit step answers at once; any other AI step (a background rework) is refused, so nothing is spent)
	await p.route("**/api/ai/edit", async (r) => {
		let body = {}
		try {
			body = JSON.parse(r.request().postData() ?? "{}")
		} catch {}
		edits.push(String(body.payload?.text ?? ""))
		const first = edits.length === 1 || body.payload?.text === USER
		return r.fulfill(first ? { status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, result: BREAKFAST, model: "mock/edit", ms: 5 }) } : { status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "error", error: "no AI in this test", retryable: false }) })
	})
	const profile = `mw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
	await p.goto(`${BASE}/?profile=${profile}`, { waitUntil: "domcontentloaded" })
	await p.waitForFunction(() => !document.querySelector("#new")?.disabled && window.sandbox?.scene && window.sandbox?.sim, null, { timeout: 90000 })
	await p.waitForTimeout(1500)
	await p.click("#ai")
	await p.waitForSelector(".ai-input", { state: "visible", timeout: 30000 })
	await p.evaluate(() => {
		window.__fixline = []
		new MutationObserver(() => {
			const t = document.querySelector(".ai-fixline")?.textContent?.replace(/\s+/g, " ").trim()
			if (t && window.__fixline.at(-1) !== t) window.__fixline.push(t)
		}).observe(document.querySelector(".ai-thread"), { subtree: true, childList: true, characterData: true })
	})
	return { p, ctx, errors, edits }
}
const send = async (p, text) => (await p.fill(".ai-input", text), await p.press(".ai-input", "Enter"))
const searching = (p) => p.waitForFunction(() => !!document.querySelector("li.ai-bot:last-of-type .ai-fixline"), null, { timeout: 60000 })
const lastLead = (p) => p.evaluate(() => [...document.querySelectorAll("li.ai-bot")].at(-1)?.querySelector(".ai-lead, .ai-reply > p")?.textContent.replace(/\s+/g, " ").trim() ?? null)
const shot = (p, name) => p.locator(".ai-thread").screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {})

// ---- 1 and 2: the line says what it does, and its Stop stops it
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => (window.__fixline ?? []).some((t) => /physics runs/.test(t)), null, { timeout: 20000 }).catch(() => {})
	const lines = await p.evaluate(() => window.__fixline)
	ok("1. 'Looking for a fix…' says what it is doing, and it changes", lines.some((t) => /· \d+ physics runs/.test(t)) && new Set(lines).size >= 2, lines.slice(0, 4).join(" | "))
	ok("2. the line has a Stop", await p.locator("li.ai-bot").last().locator(".ai-fixstop").isVisible())
	await p.locator("li.ai-bot").last().locator(".ai-fixstop").click()
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 5000 }).catch(() => {})
	const lead = await lastLead(p)
	ok("2. stopped: said so, with the button that asks the AI", /I stopped looking for a fix\./.test(lead ?? "") && (await p.locator("li.ai-bot").last().locator(".ai-offer-btn").first().isVisible()), lead)
	await p.waitForTimeout(1500)
	ok("2. no page errors (no unhandled 'Cancelled')", !errors.length, errors.join(" | "))
	await shot(p, "2-stopped")
	await ctx.close()
}
// ---- 3: the card's Undo while it looks
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.locator("li.ai-bot").last().locator(".ai-undo").click()
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 3000 }).catch(() => {})
	const gone = await p.evaluate(() => !document.querySelector(".ai-fixline"))
	const lead = await lastLead(p)
	ok("3. undo while it looks: the search stops at once", gone)
	ok("3. said so, with nothing offered for the undone scene", /You undid this change, so I stopped looking for a fix\./.test(lead ?? "") && !(await p.locator("li.ai-bot").last().locator(".ai-chips button.go, .ai-offer-btn").count()), lead)
	ok("3. the starter is back on the table", await p.evaluate(() => window.sandbox.scene.items.some((i) => i.type === "domino-row")))
	ok("3. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "3-undone")
	await ctx.close()
}
// ---- 4: the fix, its card, its Undo, and "yes"
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 })
	const editScene = await p.evaluate(() => JSON.stringify(window.sandbox.scene))
	const go = p.locator("li.ai-bot").last().locator(".ai-chips button.go")
	ok("4. a checked fix is offered", (await go.count()) === 1, await lastLead(p))
	if ((await go.count()) === 1) {
		await go.click()
		await p.waitForFunction((n) => document.querySelectorAll("li.ai-bot").length > n, 1, { timeout: 30000 })
		await p.waitForTimeout(1500)
		const delta = await p.evaluate(() => [...[...document.querySelectorAll("li.ai-bot")].at(-1).querySelectorAll(".ai-delta li")].map((li) => li.textContent.trim()))
		ok("4. the fix card lists each change (what it added among them)", delta.length >= 1 && delta.some((d) => /^Added|^Stood|laptop|cutting board/i.test(d)), delta.join(" | "))
		await p.locator("li.ai-bot").last().locator(".ai-undo").click()
		await p.waitForTimeout(1200)
		const back = await p.evaluate(() => JSON.stringify(window.sandbox.scene))
		ok("4. the fix card's Undo puts the edit's scene back", back === editScene)
		const st = await p.evaluate(() => [...document.querySelectorAll("li.ai-bot")].map((li) => ({ stale: li.classList.contains("ai-stale"), go: !!li.querySelector(".ai-chips button.go"), restore: !!li.querySelector(".ai-restore:not([hidden])"), undo: !!li.querySelector(".ai-undo:not([hidden])") })))
		ok("4. the edit card is the live one again, its checked chip there", st.length === 2 && !st[0].stale && st[0].go, JSON.stringify(st))
		ok("4. the fix card is stale and offers Restore; the edit card offers no Restore", st[1]?.stale && st[1]?.restore && !st[0].restore, JSON.stringify(st))
		await send(p, "yes")
		await p.waitForFunction((n) => document.querySelectorAll("li.ai-bot").length > n, 2, { timeout: 30000 }).catch(() => {})
		await p.waitForTimeout(1500)
		const lead = await lastLead(p)
		ok("4. 'yes' puts the checked fix back", /^Done — I /.test(lead ?? "") && (await p.evaluate(() => window.sandbox.scene.items.some((i) => /^standin/.test(i.id)))), lead)
	}
	ok("4. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "4-fix-undo-yes")
	await ctx.close()
}
// ---- 5: a double click on the checked fix puts it on the table once (the second click never lands on the Restore that slid under the pointer)
// ---- 6: "Check it" is not offered beside a checked fix
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 })
	const editScene = await p.evaluate(() => JSON.stringify(window.sandbox.scene))
	const foot = await p.evaluate(() => [...[...document.querySelectorAll("li.ai-bot")].at(-1).querySelectorAll(".ai-foot button")].filter((b) => !b.hidden && getComputedStyle(b).display !== "none").map((b) => b.textContent.trim()))
	ok("6. no 'Check it' beside a checked fix (V8817 s6: it threw the fix away)", !foot.some((t) => /Check/.test(t)), foot.join(" | "))
	const go = p.locator("li.ai-bot").last().locator(".ai-chips button.go")
	if ((await go.count()) === 1) {
		await go.dblclick()
		await p.waitForTimeout(3000)
		const st = await p.evaluate(() => ({ bots: [...document.querySelectorAll("li.ai-bot")].map((li) => li.classList.contains("ai-stale")), standin: window.sandbox.scene.items.some((i) => /^standin/.test(i.id)) }))
		const now = await p.evaluate(() => JSON.stringify(window.sandbox.scene))
		ok("5. a double click applies the fix once and keeps it (V8817 s5b)", st.standin && now !== editScene && st.bots.length === 2 && st.bots[1] === false, JSON.stringify(st))
		// ---- 7: the edit undone (the top bar's Undo twice: the fix, then the edit): no card is live, nothing offered, and "yes" asks nothing
		await p.click("#undo")
		await p.waitForTimeout(800)
		await p.click("#undo")
		await p.waitForTimeout(1500)
		const back = await p.evaluate(() => window.sandbox.scene.items.some((i) => i.type === "domino-row"))
		const cards = await p.evaluate(() => [...document.querySelectorAll("li.ai-bot")].map((li) => ({ stale: li.classList.contains("ai-stale"), goVisible: [...li.querySelectorAll(".ai-chips button")].some((b) => getComputedStyle(b).display !== "none" && b.getClientRects().length > 0) })))
		ok("7. back to the starter: every card is stale, no chip or offer shows for a scene that is gone (V8817 s3e / s1)", back && cards.every((c) => c.stale && !c.goVisible), JSON.stringify(cards))
		await send(p, "yes")
		await p.waitForTimeout(1500)
		const lead = await lastLead(p)
		ok("7. 'yes' then asks nothing and changes nothing", /nothing to say yes to/i.test(lead ?? "") && (await p.evaluate(() => window.sandbox.scene.items.some((i) => i.type === "domino-row"))), lead)
	} else ok("5. a checked fix is offered to double-click", false, await lastLead(p))
	ok("5–7. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "5-double-click")
	await ctx.close()
}
const p14 = { again: false }
// ---- 8–14 (the review of §16.2, r2-problems): the paid button once, Undo while the AI works, a rename by hand, Look again, the one-line search
/** A page whose edit step answers from `answer(payload, n)` (n: the edit call's number from 1; null: refused as "no AI in this test"); each
 *  call's start, whether it was stopped, and its words are kept. */
async function pageWith(answer, { delayMs = () => 0 } = {}) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const p = await ctx.newPage()
	const errors = []
	p.on("pageerror", (e) => errors.push(String(e?.message ?? e)))
	const calls = []
	await p.route("**/api/ai/edit", async (r) => {
		let body = {}
		try {
			body = JSON.parse(r.request().postData() ?? "{}")
		} catch {}
		const c = { n: calls.length + 1, at: Date.now(), text: String(body.payload?.text ?? ""), feedback: !!body.payload?.feedback }
		calls.push(c)
		const wait = delayMs(body.payload ?? {}, c.n)
		if (wait) await new Promise((res) => setTimeout(res, wait))
		const a = answer(body.payload ?? {}, c.n)
		return r.fulfill(a ? { status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, result: a, model: "mock/edit", ms: 5, usage: { costInUSD: 0 } }) } : { status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "error", error: "no AI in this test", retryable: false }) }).catch(() => {})
	})
	p.on("requestfailed", (req) => {
		if (!/\/api\/ai\/edit/.test(req.url())) return
		const c = [...calls].reverse().find((x) => !x.failed)
		if (c) c.failed = req.failure()?.errorText ?? "failed"
	})
	const profile = `mw${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
	await p.goto(`${BASE}/?profile=${profile}`, { waitUntil: "domcontentloaded" })
	await p.waitForFunction(() => !document.querySelector("#new")?.disabled && window.sandbox?.scene && window.sandbox?.sim, null, { timeout: 90000 })
	await p.waitForTimeout(1500)
	await p.click("#ai")
	await p.waitForSelector(".ai-input", { state: "visible", timeout: 30000 })
	return { p, ctx, errors, calls }
}
const cardsNow = (p) =>
	p.evaluate(() =>
		[...document.querySelectorAll("li.ai-bot")].map((li) => {
			const vis = (el) => !!el && !el.closest("[hidden]") && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none"
			return { stale: li.classList.contains("ai-stale"), lead: (li.querySelector(".ai-lead") ?? li.querySelector(".ai-reply > p"))?.textContent.replace(/\s+/g, " ").trim() ?? "", btn: [...li.querySelectorAll(".ai-offer-btn, .ai-again-btn")].filter(vis).map((b) => b.textContent.trim()), chips: [...li.querySelectorAll(".ai-chips button")].filter(vis).map((b) => b.textContent.trim()) }
		})
	)
const doneAfter = (p, n0, ms = 240000) => p.waitForFunction((n0) => { const lis = [...document.querySelectorAll("li.ai-bot")]; if (lis.length <= n0) return false; const li = lis.at(-1); return !!li.querySelector(".ai-card:not(.ai-progress)") && !li.querySelector(".ai-fixline") }, n0, { timeout: ms, polling: 250 })
/** "make the box twice as wide", as the edit step answered it live (VERIFY box-wider-answer.json): the box 52 cm wide, Ball 2 no longer lands. */
const WIDER = { kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", why: "They asked to resize one item.", reply: "I made the box twice as wide (26 cm → 52 cm).", patches: [{ op: "set_props", id: "box", props: { width: 0.52 } }], missing: [], suggestions: [{ label: "Swap in a bouncier ball", prompt: "Swap the yellow ball on the seesaw for a superball" }, { label: "Add more dominoes", prompt: "Add 3 more dominoes to the domino row" }] }
/** A rework that doesn't work (the box 9.7 cm right: Ball 2 still misses). */
const MISS = { kind: "fix", mode: "patch", targets: [{ says: "the box", ids: ["box"] }], why: "make it work", reply: "I moved the box 9.7 cm right.", patches: [{ op: "move", id: "box", dx: 0.097 }], missing: [], suggestions: [] }
// ---- 8: "Ask the AI to rework it" pressed once: it fails, and the older card shows no button or chips any more (VERIFY regress-r2: a second paid
// rework, two "didn't work either" cards)
{
	let open = false // (the background reworks are refused; the button's own calls get the rework that misses)
	const { p, ctx, errors, calls } = await pageWith((pl, n) => (n === 1 ? WIDER : open ? MISS : null))
	await send(p, "make the box twice as wide")
	await doneAfter(p, 0)
	await p.waitForTimeout(800)
	const btn = p.locator("li.ai-bot").last().locator(".ai-offer-btn")
	ok("8. the edit card offers the rework button", (await btn.count()) === 1, await lastLead(p))
	if ((await btn.count()) === 1) {
		open = true
		await btn.click()
		await doneAfter(p, 1)
		await p.waitForTimeout(1500)
		const cards = await cardsNow(p)
		const either = cards.filter((c) => /didn’t work either|didn't work either|still doesn’t work/.test(c.lead))
		ok("8. after the rework fails, no earlier card shows a button or chips", cards.slice(0, -1).every((c) => !c.btn.length && !c.chips.length) && cards[0].stale, JSON.stringify(cards))
		ok("8. one 'didn't work either' card, and it offers no paid button again", either.length === 1 && !cards.at(-1).btn.includes("Ask the AI to rework it"), JSON.stringify(cards.map((c) => [c.lead.slice(0, 80), c.btn])))
		const n = calls.length
		await p.locator("li.ai-bot").first().locator(".ai-offer-btn").click({ force: true, timeout: 2000 }).catch(() => {})
		await p.waitForTimeout(1500)
		ok("8. the older card's button can't send another rework", calls.length === n, `${n} → ${calls.length}`)
	}
	ok("8. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "8-rework-once")
	await ctx.close()
}
// ---- 9: the top bar's Undo while an edit is being worked on: it stops, and its result never puts the undone change back (V8820 x13)
{
	const MOVE = { kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", reply: "I moved the box 5 cm left.", patches: [{ op: "move", id: "box", dx: -0.05 }], missing: [], suggestions: [] }
	const WIDE2 = { kind: "change", targets: [{ says: "the box", ids: ["box"] }], mode: "patch", reply: "I made the box 2 cm wider.", patches: [{ op: "set_props", id: "box", props: { width: 0.28 } }], missing: [], suggestions: [] }
	const { p, ctx, errors, calls } = await pageWith((pl, n) => (n === 1 ? MOVE : n === 2 ? WIDE2 : null), { delayMs: (pl, n) => (n === 2 ? 4000 : 0) })
	const box0 = await p.evaluate(() => window.sandbox.scene.items.find((i) => i.id === "box").x)
	await send(p, "Move the box 5 cm left.")
	await doneAfter(p, 0, 60000)
	await p.waitForTimeout(1200)
	// (a change that works folds the drawer to its chip: opened again, as a person would)
	if (!(await p.locator(".ai-input").isVisible())) await p.locator(".ai-mini .ai-primary").click().catch(() => p.click("#ai"))
	await p.waitForSelector(".ai-input", { state: "visible", timeout: 10000 })
	await send(p, "Make the box 2 cm wider.")
	await p.waitForTimeout(1500)
	await p.click("#undo")
	await p.waitForTimeout(6000)
	const st = await p.evaluate(() => ({ box: window.sandbox.scene.items.find((i) => i.id === "box"), n: document.querySelectorAll("li.ai-bot").length }))
	const lead = await lastLead(p)
	ok("9. Undo while the AI works: it stops, and says so", /You undid the change while I worked, so I stopped/.test(lead ?? ""), lead)
	ok("9. nothing it made goes on the table: the box is back where it started, its width as it was", Math.abs(st.box.x - box0) < 1e-6 && !(st.box.props?.width > 0.27), JSON.stringify(st.box))
	ok("9. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "9-undo-while-working")
	await ctx.close()
}
// ---- 10: a rename by hand keeps the checked offer, and "yes" applies it, keeping the new name (V8820 x10)
{
	const { p, ctx, errors } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 })
	const go = p.locator("li.ai-bot").last().locator(".ai-chips button.go")
	if ((await go.count()) === 1) {
		await p.evaluate(() => window.sandboxApp.rename("Breakfast disaster"))
		await p.waitForTimeout(1500)
		const st = await cardsNow(p)
		ok("10. renamed by hand: the edit card is still the live one, its checked chip there", !st[0].stale && st[0].chips.length >= 1, JSON.stringify(st))
		await send(p, "yes")
		await p.waitForFunction((n) => document.querySelectorAll("li.ai-bot").length > n, 1, { timeout: 30000 }).catch(() => {})
		await p.waitForTimeout(1500)
		const lead = await lastLead(p)
		const sc = await p.evaluate(() => ({ name: window.sandbox.scene.name, standin: window.sandbox.scene.items.some((i) => /^standin/.test(i.id)) }))
		ok("10. 'yes' applies the checked fix, and the name given by hand stays", /^Done — I /.test(lead ?? "") && sc.standin && sc.name === "Breakfast disaster", `${lead} / ${JSON.stringify(sc)}`)
	} else ok("10. a checked fix is offered", false, await lastLead(p))
	ok("10. no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}
// ---- 11: the card's Undo while "Ask the AI to rework it" is being worked on: stopped, no second call, no "Try:" for the undone scene (V8820 x12)
{
	let open = false
	const { p, ctx, errors, calls } = await pageWith((pl, n) => (n === 1 ? WIDER : open ? MISS : null), { delayMs: () => (open ? 5000 : 0) })
	await send(p, "make the box twice as wide")
	await doneAfter(p, 0)
	await p.waitForTimeout(800)
	const btn = p.locator("li.ai-bot").last().locator(".ai-offer-btn")
	if ((await btn.count()) === 1) {
		open = true
		await btn.click()
		await p.waitForTimeout(1500)
		await p.click("#undo")
		await p.waitForTimeout(1500)
		const nAt = calls.length
		await p.waitForTimeout(8000)
		const cards = await cardsNow(p)
		const lead = cards.at(-1)?.lead ?? ""
		ok("11. Undo during the rework: stopped and said so", /undid the change while I worked/.test(lead), lead)
		ok("11. no call after the Undo, and nothing offered for the undone scene", calls.length === nAt && cards.every((c) => !c.chips.some((x) => /^Try:/.test(x))), `${nAt} → ${calls.length} / ${JSON.stringify(cards)}`)
		ok("11. the table is the starter's", await p.evaluate(() => Math.abs(window.sandbox.scene.items.find((i) => i.id === "box").props?.width ?? 0.26) < 0.3))
	} else ok("11. the edit card offers the rework button", false, await lastLead(p))
	ok("11. no page errors", !errors.length, errors.join(" | "))
	await ctx.close()
}
// ---- 12 and 13: after its Stop, "Look again" runs the physics search again (no AI) and finds the fix; the line is one row in the drawer
{
	const { p, ctx, errors, edits } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForTimeout(1500)
	const h = await p.evaluate(() => {
		const el = document.querySelector(".ai-fixline")
		const t = el?.querySelector(".ai-fixline-t")
		return { h: el?.getBoundingClientRect().height ?? 0, lh: parseFloat(getComputedStyle(el).lineHeight) || 20, stopTop: el?.querySelector(".ai-fixstop")?.getBoundingClientRect().top ?? 0, top: t?.getBoundingClientRect().top ?? 0, w: el?.getBoundingClientRect().width ?? 0 }
	})
	ok("13. 'Looking for a fix…' is one row, its Stop on it (V8820: three cramped columns)", h.h > 0 && h.h <= 2 * h.lh && Math.abs(h.stopTop - h.top) < 12, JSON.stringify(h))
	await p.locator("li.ai-bot").last().locator(".ai-fixstop").click()
	await p.waitForTimeout(800)
	const again = p.locator("li.ai-bot").last().locator(".ai-again-btn")
	ok("12. after its Stop, the card offers 'Look again'", (await again.count()) === 1, await lastLead(p))
	if ((await again.count()) === 1) {
		const n = edits.length
		await again.click()
		await searching(p).catch(() => {})
		await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 }).catch(() => {})
		const go = await p.locator("li.ai-bot").last().locator(".ai-chips button.go").count()
		ok("12. 'Look again' finds the checked fix with the physics, no AI call", go === 1 && edits.length === n, `${await lastLead(p)} / calls ${n} → ${edits.length}`)
	}
	ok("12. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "12-look-again")
	await ctx.close()
}
// ---- 14: "Ask the AI to rework it", stopped by its Cancel, then asked again from the card and failing: no card offers "Run again" or the paid
// button after it (V8832 y14 / y15: the cancelled card's "Run again" sent a third rework after the second failed, $0.13 more)
{
	let open = false
	const { p, ctx, errors, calls } = await pageWith((pl, n) => (n === 1 ? WIDER : open ? MISS : null), { delayMs: () => (open && !p14.again ? 6000 : 0) })
	await send(p, "make the box twice as wide")
	await doneAfter(p, 0)
	await p.waitForTimeout(800)
	const btn = () => p.locator("li.ai-bot").first().locator(".ai-offer-btn")
	if ((await btn().count()) === 1) {
		open = true
		await btn().click()
		await p.waitForTimeout(2500)
		await p.locator("li.ai-bot").last().locator(".ai-chip-btn", { hasText: "Cancel" }).click()
		await p.waitForTimeout(1500)
		const runAgain = await p.locator("li.ai-bot button", { hasText: "Run again" }).count()
		ok("14. a stopped rework offers no 'Run again' of its own; the edit card's button is back", runAgain === 0 && (await btn().isVisible()), `${runAgain} / ${JSON.stringify(await cardsNow(p))}`)
		p14.again = true
		const n0 = await p.locator("li.ai-bot").count()
		await btn().click()
		await doneAfter(p, n0)
		await p.waitForTimeout(1500)
		const cards = await cardsNow(p)
		const visRun = await p.evaluate(() => [...document.querySelectorAll("li.ai-bot button")].filter((b) => /Run again|Try again|Ask the AI to rework it/.test(b.textContent) && b.getClientRects().length > 0 && getComputedStyle(b).display !== "none" && !b.closest("[hidden]")).map((b) => b.textContent.trim()))
		ok("14. after the second rework fails, no card shows 'Run again' or the paid button", !visRun.length && /didn’t work either|didn't work either/.test(cards.at(-1)?.lead ?? ""), `${JSON.stringify(visRun)} / ${cards.at(-1)?.lead}`)
		const n = calls.length
		await p.locator("li.ai-bot button", { hasText: "Run again" }).first().click({ force: true, timeout: 2000 }).catch(() => {})
		await p.waitForTimeout(1500)
		ok("14. a hidden 'Run again' sends nothing", calls.length === n, `${n} → ${calls.length}`)
	} else ok("14. the edit card offers the rework button", false, await lastLead(p))
	ok("14. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "14-cancel-then-again")
	await ctx.close()
}
// ---- 15: the search stopped because another scene was opened, then the top bar's Undo back to the edit: its card offers "Look again" and
// the button again, and a "yes" spends nothing (V8832 y7: a dead end, and "yes" sent a paid rework)
{
	const { p, ctx, errors, edits } = await page()
	await send(p, USER)
	await searching(p)
	await p.waitForTimeout(1200)
	// (the edit undone by the top bar while it looks, then redone: the scene it was for is back)
	await p.click("#undo")
	await p.waitForTimeout(1500)
	await p.click("#redo")
	await p.waitForTimeout(1500)
	const c = (await cardsNow(p))[0]
	ok("15. back on the table: the card says it stopped, with 'Look again' and the button", !c.stale && c.btn.includes("Look again") && c.btn.includes("Ask the AI to rework it"), JSON.stringify(c))
	const n = edits.length
	await send(p, "yes")
	await p.waitForTimeout(1500)
	ok("15. 'yes' then looks again with the physics, no AI call", edits.length === n && (await p.evaluate(() => !!document.querySelector(".ai-fixline"))), `${n} → ${edits.length}`)
	await p.waitForFunction(() => !document.querySelector(".ai-fixline"), null, { timeout: 120000 }).catch(() => {})
	ok("15. no page errors", !errors.length, errors.join(" | "))
	await shot(p, "15-undo-redo-look-again")
	await ctx.close()
}
await browser.close()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} passed${failed.length ? `; failed: ${failed.map((c) => c.name).join("; ")}` : ""}`)
process.exit(failed.length ? 1 : 0)
